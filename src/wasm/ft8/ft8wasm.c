// GridTracker Copyright Â© 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's FT8 mode: ft8_lib (MIT, Karlis Goba: ft8_lib/, unchanged) as a standalone WASM module, built to
// src/renderer/lib/mmd/ft8.wasm by tools/build_ft8_wasm.js and run by the viewer (mmDecoder.js) once each 15 s period has been heard. As
// ft8_lib's own decode_ft8.c demo does it.
//
//   ft8_init(fmin, fmax): the audio searched (Hz); true once ready
//   ft8_input():          where ft8_decode reads a period from (15 s at 12 kHz)
//   ft8_decode(n, more):  n samples of a period (from its start) decoded: how many messages; their lines in ft8_output(), one each
//                         (more: the same period again with more of it heard, only messages not given by the decode before):
//                         "snr\tdt\tfreq\ttext\thow\n" (snr in dB as WSJT-X gives it, signalSnr; dt in s; freq in Hz of audio;
//                         how: empty, or o, a1, a2, a3 as decodeLlr found it)
//   ft8_set_passes(n):    how many times the period is searched (1 to 4): after each, the signals decoded are taken out of it
//                         (subtractAudio), so the weaker ones under them can be found
//   ft8_set_focus(hz):    a frequency to search harder (the viewer's right-click; 0 none): the signals whose middle is within
//                         FOCUS_HALF_HZ of it, in one more pass (Normal too: FT4's)
//   ft8_set_period(p):    the period being decoded (start / 15 s), for the QSO guesses (a3): ft8_note keeps what was decoded
//   ft8_set_mycall(call): this station's call (written into ft8_mycall_buffer() first), for the a priori guess of a call to it
//   ft8_set_ft4(on):      FT4 instead of FT8 (the viewer's FT4 mode: a 7.5 s period, always decoded the Normal way)
//   ft8_set_plain(on):    Normal (the viewer's FT8 Decoder setting): ft8_lib as it comes, as its decode_ft8.c demo decodes, instead of
//                         Deep (all of what follows): one pass, ft8_lib's candidates and its own reading of each (g_plain)
//
// Decoding, taking out what was decoded, and decoding again is WSJT-X's way, with credit and thanks to Joe Taylor, K1JT, and the WSJT
// development team, whose work it comes from. This is written here for ft8_lib (none of WSJT-X's code is used): a signal decoded is
// rebuilt from its message and taken out of the audio (subtractAudio), and the waterfall ft8_lib searches made again from what is left.
// Each pass's candidates can be shared out between workers (ft8_begin and the functions after it; ft8Worker.js)

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <ft8/decode.h>
#include <ft8/constants.h>
#include <ft8/crc.h>
#include <ft8/ldpc.h>
#include <ft8/encode.h>
#include <ft8/message.h>
#include <common/monitor.h>

#define SAMPLE_RATE 12000
#define SLOT_SAMPLES (15 * SAMPLE_RATE)
// How hard each period is searched (as ft8_lib's demo; each can be set at build time to try another)
#ifndef MAX_CANDIDATES
#define MAX_CANDIDATES 140
#endif
#define MAX_DECODED 50
#ifndef LDPC_ITERATIONS
#define LDPC_ITERATIONS 25
#endif
// The lowest sync score a candidate is tried at: lower than ft8_lib's demo (10), since the fine reading decodes some of the weaker ones
#ifndef MIN_SCORE
#define MIN_SCORE 7
#endif

// Normal: ft8_lib as it comes (its demo's lowest sync score, 10), with none of the fine reading, OSD, a priori guesses, combining, taking
// out and searching again, or focus search below: one pass of ft8_lib's candidates, each read by ft8_lib (ftx_decode_candidate)
#define PLAIN_MIN_SCORE 10
static int g_plain = 0;
// The Depth set (Normal), and FT4 (ft8_set_ft4: always Normal); g_plain is either. The audio searched (ft8_init), kept for setting
// ft8_lib's monitor up again for the other protocol
static int g_plainSet = 0;
static int g_ft4 = 0;
static float g_fMin = 100.0f, g_fMax = 4000.0f;

void ft8_set_plain(int plain)
{
  g_plainSet = plain ? 1 : 0;
  g_plain = g_plainSet || g_ft4;
}

static float g_input[SLOT_SAMPLES];
static char g_output[MAX_DECODED * 128];
static monitor_t g_mon;
static int g_ready = 0;

// The callsigns heard, so a message that sends one as a hash shows it (kept across periods)
#define HASHTABLE_SIZE 256
static struct
{
  char callsign[12];
  uint32_t hash;
} g_calls[HASHTABLE_SIZE];

static void hashtable_add(const char* callsign, uint32_t hash)
{
  uint16_t hash10 = (hash >> 12) & 0x3FFu;
  int idx = (hash10 * 23) % HASHTABLE_SIZE;
  int tries = 0;
  while (g_calls[idx].callsign[0] != '\0')
  {
    if (((g_calls[idx].hash & 0x3FFFFFu) == hash) && strcmp(g_calls[idx].callsign, callsign) == 0)
    {
      g_calls[idx].hash &= 0x3FFFFFu;
      return;
    }
    idx = (idx + 1) % HASHTABLE_SIZE;
    // Full: the oldest guesses go (a table that only grows would never end this loop)
    if (++tries >= HASHTABLE_SIZE)
    {
      memset(g_calls, 0, sizeof(g_calls));
      break;
    }
  }
  strncpy(g_calls[idx].callsign, callsign, 11);
  g_calls[idx].callsign[11] = '\0';
  g_calls[idx].hash = hash;
}

static bool hashtable_lookup(ftx_callsign_hash_type_t type, uint32_t hash, char* callsign)
{
  uint8_t shift = (type == FTX_CALLSIGN_HASH_10_BITS) ? 12 : (type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0);
  uint16_t hash10 = (hash >> (12 - shift)) & 0x3FFu;
  int idx = (hash10 * 23) % HASHTABLE_SIZE;
  for (int tries = 0; g_calls[idx].callsign[0] != '\0' && tries < HASHTABLE_SIZE; tries++)
  {
    if (((g_calls[idx].hash & 0x3FFFFFu) >> shift) == hash)
    {
      strcpy(callsign, g_calls[idx].callsign);
      return true;
    }
    idx = (idx + 1) % HASHTABLE_SIZE;
  }
  callsign[0] = '\0';
  return false;
}

static ftx_callsign_hash_interface_t g_hash_if = { .lookup_hash = hashtable_lookup, .save_hash = hashtable_add };

float* ft8_input(void) { return g_input; }
char* ft8_output(void) { return g_output; }

static int g_passes = 1;

void ft8_set_passes(int passes) { g_passes = passes < 1 ? 1 : passes > 4 ? 4 : passes; }

// ---- The waterfall's cells (for a signal's SNR)

// A cell's power (linear), by its place in half symbols (tpos) and half tone steps (fpos); -1 outside the waterfall. *index: where it is
static float cellPower(const ftx_waterfall_t* wf, int tpos, int fpos, int* index)
{
  if (tpos < 0 || fpos < 0) return -1.0f;
  int block = tpos / wf->time_osr, ts = tpos % wf->time_osr;
  int bin = fpos / wf->freq_osr, fs = fpos % wf->freq_osr;
  if (block >= wf->num_blocks || bin >= wf->num_bins) return -1.0f;
  *index = block * wf->block_stride + (ts * wf->freq_osr + fs) * wf->num_bins + bin;
  return powf(10.0f, WF_ELEM_MAG(wf->mag[*index]) / 10.0f);
}

// The waterfall's noise: its median cell (linear)
static float waterfallNoise(const ftx_waterfall_t* wf)
{
  static int counts[256];
  memset(counts, 0, sizeof(counts));
  int n = wf->num_blocks * wf->block_stride;
  for (int i = 0; i < n; i++) counts[wf->mag[i]]++;
  int seen = 0, median = 0;
  while (median < 255 && seen + counts[median] < n / 2) seen += counts[median++];
  return powf(10.0f, WF_ELEM_MAG((WF_ELEM_T)median) / 10.0f);
}

// ---- Decoding a candidate
//
// Three tries, each only when the one before failed (the last two are also WSJT-X's, with credit and thanks to Joe Taylor, K1JT, and the WSJT
// development team, as published in "The FT4 and FT8 Communication Protocols", QEX July/August 2020; written here from that description and
// the coding literature, none of WSJT-X's code is used):
//   1. ft8_lib's own: belief propagation over the LDPC code (bp_decode)
//   2. Ordered statistics decoding (OSD: Fossorier and Lin, 1995): the 91 most reliable bits that fix a codeword taken as heard, and
//      each codeword they give with one of them flipped, or two of the least reliable of them, measured against what was heard; the
//      closest kept, if its CRC is right and it is close enough
//   3. A priori (AP): bits a message is likely to have taken as known (a CQ, or a call to this station's own call), and 1 and 2 tried again
// The bit likelihoods are taken from the waterfall as ft8_lib's decode.c does it (MIT, Karlis Goba: ft8_extract_likelihood,
// ftx_normalize_logl), as those are not exported from it

// OSD_MAX_HARD and AP_MAX_HARD keep false decodes out: OSD and a priori decoding will always find some codeword with a right CRC (1 in
// 16384 chance each), so one that is far from what was heard is taken for noise
#ifndef OSD_PAIRS
#define OSD_PAIRS 40 // two flips among the least reliable this many of the 91
#endif
#ifndef OSD_MAX_HARD
#define OSD_MAX_HARD 33 // an OSD codeword this many bits from what was heard, or more, is not taken (measured against WSJT-X: its
// decodes came out 18 to 32 bits away; the false ones from 31 up, all with calls whose prefixes don't exist or /R, /P calls not heard
// before, which messagePlausible and unlikelySuffix turn away)
#endif
#ifndef AP_MAX_HARD
#define AP_MAX_HARD 33  // the same for a priori decodes (a false a3 came at 34)
#endif

typedef struct
{
  uint64_t w[3];
} bits174_t;

static inline int bitGet(const bits174_t* b, int n) { return (int)((b->w[n >> 6] >> (n & 63)) & 1u); }
static inline void bitFlip(bits174_t* b, int n) { b->w[n >> 6] ^= (uint64_t)1 << (n & 63); }
static inline void bitsXor(bits174_t* a, const bits174_t* b)
{
  a->w[0] ^= b->w[0];
  a->w[1] ^= b->w[1];
  a->w[2] ^= b->w[2];
}

// ft8_lib's likelihood of each of the 174 bits (log(p(1) / p(0))), as decode.c's ft8_extract_likelihood and ftx_normalize_logl
static float maxOf4(float a, float b, float c, float d)
{
  float x = a > b ? a : b, y = c > d ? c : d;
  return x > y ? x : y;
}

static void bitLikelihoods(const ftx_waterfall_t* wf, const ftx_candidate_t* cand, float* llr)
{
  int offset = ((cand->time_offset * wf->time_osr + cand->time_sub) * wf->freq_osr + cand->freq_sub) * wf->num_bins + cand->freq_offset;
  const WF_ELEM_T* mag = wf->mag + offset;
  for (int k = 0; k < FT8_ND; k++)
  {
    int sym = k + (k < 29 ? 7 : 14), bit = 3 * k;
    int block = cand->time_offset + sym;
    if (block < 0 || block >= wf->num_blocks)
    {
      llr[bit] = llr[bit + 1] = llr[bit + 2] = 0.0f;
      continue;
    }
    const WF_ELEM_T* m = mag + sym * wf->block_stride;
    float s[8];
    for (int j = 0; j < 8; j++) s[j] = WF_ELEM_MAG(m[kFT8_Gray_map[j]]);
    llr[bit] = maxOf4(s[4], s[5], s[6], s[7]) - maxOf4(s[0], s[1], s[2], s[3]);
    llr[bit + 1] = maxOf4(s[2], s[3], s[6], s[7]) - maxOf4(s[0], s[1], s[4], s[5]);
    llr[bit + 2] = maxOf4(s[1], s[3], s[5], s[7]) - maxOf4(s[0], s[2], s[4], s[6]);
  }
  float sum = 0.0f, sum2 = 0.0f;
  for (int i = 0; i < FTX_LDPC_N; i++)
  {
    sum += llr[i];
    sum2 += llr[i] * llr[i];
  }
  float variance = (sum2 - sum * sum / FTX_LDPC_N) / FTX_LDPC_N;
  float norm = variance > 0.0f ? sqrtf(24.0f / variance) : 1.0f;
  for (int i = 0; i < FTX_LDPC_N; i++) llr[i] *= norm;
}

// A codeword's message: its first 91 bits (77 of message, 14 of CRC) packed MSB first; true if the CRC is right (and it isn't all zeros)
static bool codewordMessage(const bits174_t* cw, ftx_message_t* message)
{
  uint8_t a91[FTX_LDPC_K_BYTES];
  memset(a91, 0, sizeof(a91));
  int any = 0;
  for (int n = 0; n < FTX_LDPC_K; n++)
  {
    if (bitGet(cw, n))
    {
      a91[n >> 3] |= (uint8_t)(0x80u >> (n & 7));
      any = 1;
    }
  }
  if (!any) return false;
  uint16_t crc = ftx_extract_crc(a91);
  a91[9] &= 0xF8;
  a91[10] = 0;
  if (crc != ftx_compute_crc(a91, 96 - 14)) return false;
  message->hash = crc;
  memcpy(message->payload, a91, sizeof(message->payload));
  return true;
}

// The code's generator as 91 rows of 174 bits, each message bit and the parity bits it sets (kFTX_LDPC_generator: parity bit i is the
// sum of the message bits its row j has set)
static bits174_t g_generator[FTX_LDPC_K];
static bool g_generatorReady = false;

static void generatorRows(void)
{
  memset(g_generator, 0, sizeof(g_generator));
  for (int j = 0; j < FTX_LDPC_K; j++)
  {
    bitFlip(&g_generator[j], j);
    for (int i = 0; i < FTX_LDPC_M; i++)
    {
      if (kFTX_LDPC_generator[i][j >> 3] & (0x80u >> (j & 7))) bitFlip(&g_generator[j], FTX_LDPC_K + i);
    }
  }
  g_generatorReady = true;
}

// How far a codeword is from what was heard: the bits that differ from the hard decisions, and the sum of their reliabilities
static float codewordCost(const bits174_t* cw, const bits174_t* hard, const float* reliability, int* differ)
{
  float cost = 0.0f;
  int count = 0;
  for (int w = 0; w < 3; w++)
  {
    uint64_t d = cw->w[w] ^ hard->w[w];
    while (d)
    {
      int b = __builtin_ctzll(d);
      d &= d - 1;
      cost += reliability[w * 64 + b];
      count++;
    }
  }
  *differ = count;
  return cost;
}

static int g_order[FTX_LDPC_N];
static const float* g_sortReliability;

static int byReliability(const void* a, const void* b)
{
  float x = g_sortReliability[*(const int*)a], y = g_sortReliability[*(const int*)b];
  return x < y ? 1 : x > y ? -1 : 0;
}

// Ordered statistics decoding of llr: the closest codeword found (*cw), and its distance (soft); false if none of them had a right CRC
static bool osdDecode(const float* llr, bits174_t* best, int* bestDiffer)
{
  if (!g_generatorReady) generatorRows();
  float reliability[FTX_LDPC_N];
  bits174_t hard;
  memset(&hard, 0, sizeof(hard));
  for (int n = 0; n < FTX_LDPC_N; n++)
  {
    reliability[n] = fabsf(llr[n]);
    if (llr[n] > 0.0f) bitFlip(&hard, n);
    g_order[n] = n;
  }
  g_sortReliability = reliability;
  qsort(g_order, FTX_LDPC_N, sizeof(int), byReliability);

  // The rows reduced (over GF(2)) so each has one of the most reliable bits to itself: the first 91 bits, in order of reliability, that
  // are independent of those before them
  static bits174_t rows[FTX_LDPC_K];
  int pivot[FTX_LDPC_K];
  memcpy(rows, g_generator, sizeof(rows));
  int rank = 0;
  for (int o = 0; o < FTX_LDPC_N && rank < FTX_LDPC_K; o++)
  {
    int col = g_order[o], r = rank;
    while (r < FTX_LDPC_K && !bitGet(&rows[r], col)) r++;
    if (r == FTX_LDPC_K) continue;
    bits174_t t = rows[r];
    rows[r] = rows[rank];
    rows[rank] = t;
    for (int i = 0; i < FTX_LDPC_K; i++)
    {
      if (i != rank && bitGet(&rows[i], col)) bitsXor(&rows[i], &rows[rank]);
    }
    pivot[rank++] = col;
  }
  if (rank < FTX_LDPC_K) return false;

  // The codeword those bits give as heard, then with one of them flipped, then two of the least reliable
  bits174_t base;
  memset(&base, 0, sizeof(base));
  for (int k = 0; k < FTX_LDPC_K; k++)
  {
    if (bitGet(&hard, pivot[k])) bitsXor(&base, &rows[k]);
  }
  float bestCost = 1e30f;
  bool found = false;
  bits174_t cw;
  int differ;
#define OSD_TRY()                                                       \
  {                                                                     \
    float cost = codewordCost(&cw, &hard, reliability, &differ);        \
    if (cost < bestCost)                                                \
    {                                                                   \
      ftx_message_t m;                                                  \
      if (codewordMessage(&cw, &m))                                     \
      {                                                                 \
        bestCost = cost;                                                \
        *best = cw;                                                     \
        *bestDiffer = differ;                                           \
        found = true;                                                   \
      }                                                                 \
    }                                                                   \
  }
  cw = base;
  OSD_TRY();
  for (int k = 0; k < FTX_LDPC_K; k++)
  {
    cw = base;
    bitsXor(&cw, &rows[k]);
    OSD_TRY();
  }
  for (int a = FTX_LDPC_K - OSD_PAIRS; a < FTX_LDPC_K; a++)
  {
    for (int b = a + 1; b < FTX_LDPC_K; b++)
    {
      cw = base;
      bitsXor(&cw, &rows[a]);
      bitsXor(&cw, &rows[b]);
      OSD_TRY();
    }
  }
#undef OSD_TRY
  return found;
}

// The a priori guesses: bits a message likely has, and their values. CQ: the first call is CQ (29 bits) and the message is a standard one
// (i3 = 1, its last 3 bits). A call to this station: its own call first (set by ft8_set_mycall)
#define AP_KINDS 2
static struct
{
  bool on;
  uint8_t payload[10];
} g_ap[AP_KINDS];

static bool noLookup(ftx_callsign_hash_type_t type, uint32_t hash, char* callsign)
{
  callsign[0] = '\0';
  return false;
}
static void noSave(const char* callsign, uint32_t hash) {}
static ftx_callsign_hash_interface_t g_noHash = { .lookup_hash = noLookup, .save_hash = noSave };

static bool apMessage(int kind, const char* first)
{
  ftx_message_t m;
  g_ap[kind].on = false;
  if (ftx_message_encode_std(&m, &g_noHash, first, "K1ABC", "FN42") != FTX_MESSAGE_RC_OK) return false;
  if (ftx_message_get_i3(&m) != 1) return false;
  memcpy(g_ap[kind].payload, m.payload, 10);
  g_ap[kind].on = true;
  return true;
}

static inline int payloadBit(const uint8_t* payload, int n) { return (payload[n >> 3] >> (7 - (n & 7))) & 1; }

// A guess for one candidate: the message bits from..to (and i3, bits 74 to 76) taken as known, from payload; how it is told (2 + kind)
typedef struct
{
  uint8_t payload[10];
  int from, to, how;
} ApGuess;

static inline bool guessKnown(const ApGuess* g, int n) { return (n >= g->from && n < g->to) || (n >= 74 && n < 77); }

// ---- The messages decoded lately, for guessing a QSO's next message (a3)
//
// A station sends every other period, mostly on the same audio frequency, and its next message mostly has the same two calls ("K1ABC
// W9XYZ EN37" then "K1ABC W9XYZ R-12"; after its CQ, its call second). So a candidate within QSO_HZ of a station decoded two periods
// before is also tried with that QSO's calls as known (58 bits; after a CQ, the station's own call: 29)
#define HISTORY_MAX 256
#ifndef QSO_HZ
#define QSO_HZ 15.0f
#endif
static struct
{
  int period;
  float hz;
  uint8_t payload[10];
} g_history[HISTORY_MAX];
static int g_historyCount = 0;
static int g_period = 0;
// Set while copies of a message are being added together (combineDecode): no repeat check (a4) then
static int g_combining = 0;
// How hard decodeLlr tries: 2 all of it, 1 no a priori guesses, 0 belief propagation only (the 2- and 3-symbol readings: MULTI_DEPTH)
static int g_depth = 2;
#ifndef MULTI_DEPTH
#define MULTI_DEPTH 1  // no a priori guesses on the 2- and 3-symbol readings: they found nothing more there, at a tenth of the time
#endif
// The same for ft8_lib's own reading (the fine reading comes after it)
#ifndef LIB_DEPTH
#define LIB_DEPTH 2
#endif

// The period being decoded (its start in 15 s periods since 1970)
void ft8_set_period(int period) { g_period = period; }

// Whether a call (the 28 bits from 'at' of a payload) is one decoded lately (either call of a message kept in the history)
static bool callHeard(const uint8_t* payload, int at)
{
  for (int i = 0; i < g_historyCount; i++)
  {
    for (int other = 0; other <= 29; other += 29)
    {
      bool same = true;
      for (int b = 0; b < 28 && same; b++) same = payloadBit(g_history[i].payload, other + b) == payloadBit(payload, at + b);
      if (same) return true;
    }
  }
  return false;
}

// ---- Callsign prefixes (GridTracker's own table: GT.prefixToDXCC's keys, passed in by the viewer), for telling a real call from noise
// in a decode found the harder ways: a call whose prefix resolves to none (by its longest match, as GridTracker's lookupPrefix does)
// can't be on the air
static char* g_prefixText = 0;
static char** g_prefixes = 0;
static int g_prefixCount = 0;

static int prefixCompare(const void* a, const void* b) { return strcmp(*(char* const*)a, *(char* const*)b); }

// The prefixes, one a line (len bytes at text); how many
int ft8_set_prefixes(const char* text, int len)
{
  free(g_prefixText);
  free(g_prefixes);
  g_prefixText = (char*)malloc(len + 1);
  memcpy(g_prefixText, text, len);
  g_prefixText[len] = 0;
  int lines = 1;
  for (int i = 0; i < len; i++) lines += g_prefixText[i] == '\n';
  g_prefixes = (char**)malloc(sizeof(char*) * lines);
  g_prefixCount = 0;
  for (char* p = g_prefixText; *p;)
  {
    char* end = strchr(p, '\n');
    if (end) *end = 0;
    if (*p) g_prefixes[g_prefixCount++] = p;
    if (!end) break;
    p = end + 1;
  }
  qsort(g_prefixes, g_prefixCount, sizeof(char*), prefixCompare);
  return g_prefixCount;
}

// Space for the viewer to write the prefixes into
char* ft8_prefix_buffer(int len) { return (char*)malloc(len + 1); }

static bool prefixKnown(const char* p, int len)
{
  char key[16];
  for (int x = len < 15 ? len : 15; x > 0; x--)
  {
    memcpy(key, p, x);
    key[x] = 0;
    const char* k = key;
    if (bsearch(&k, g_prefixes, g_prefixCount, sizeof(char*), prefixCompare)) return true;
  }
  return false;
}

// A call as text: shaped like one (a prefix with a letter in it, or a digit and a letter; a digit; 1 to 4 letters), its longest part
// when it has a / (K1ABC/P, DL/K1ABC), and its prefix (up to its last digit) known
static bool callPlausible(const char* w, int len)
{
  int best = 0, bestLen = 0, from = 0;
  for (int i = 0; i <= len; i++)
  {
    if (i == len || w[i] == '/')
    {
      if (i - from > bestLen)
      {
        best = from;
        bestLen = i - from;
      }
      from = i + 1;
    }
  }
  const char* b = w + best;
  if (bestLen < 3 || bestLen > 11) return false;
  int digit = -1, letters = 0;
  for (int i = 0; i < bestLen; i++)
  {
    if (b[i] >= '0' && b[i] <= '9') digit = i;
    else if (b[i] >= 'A' && b[i] <= 'Z') letters++;
    else return false;
  }
  if (digit < 1 || digit == bestLen - 1 || letters < 2) return false;
  for (int i = digit + 1; i < bestLen; i++) if (b[i] < 'A' || b[i] > 'Z') return false;
  return prefixKnown(b, digit + 1);
}

// A message's calls all plausible (hashed ones, <...>, aren't checked: there is nothing to check). True too if no prefixes were given
static bool messagePlausible(const ftx_message_t* message)
{
  if (!g_prefixCount) return true;
  char text[FTX_MAX_MESSAGE_LENGTH];
  ftx_message_offsets_t offsets;
  if (ftx_message_decode(message, &g_noHash, text, &offsets) != FTX_MESSAGE_RC_OK) return false;
  char* words[8];
  int n = 0;
  for (char* p = strtok(text, " "); p && n < 8; p = strtok(0, " ")) words[n++] = p;
  if (n < 2) return false;
  // CQ [modifier] CALL [grid]: the call is the word after CQ and any modifier (DX, POTA, NA, a number ...)
  int first = 0, count = 2;
  if (strcmp(words[0], "CQ") == 0)
  {
    first = n >= 4 ? 2 : 1;
    count = 1;
  }
  for (int i = first; i < first + count && i < n; i++)
  {
    if (words[i][0] == '<') continue;
    if (!callPlausible(words[i], (int)strlen(words[i]))) return false;
  }
  return true;
}

// A standard message with a /R or /P call (its flag after either call set) that wasn't decoded lately: few real messages have one (2 in
// 1000 of WSJT-X's decodes in a day's log), while a decode found the harder ways out of noise has one 3 times in 4 (each flag is one bit
// of the message), so such a decode is not taken
static bool unlikelySuffix(const ftx_message_t* message)
{
  if (ftx_message_get_i3(message) != 1 && ftx_message_get_i3(message) != 2) return false;
  if (payloadBit(message->payload, 28) && !callHeard(message->payload, 0)) return true;
  if (payloadBit(message->payload, 57) && !callHeard(message->payload, 29)) return true;
  return false;
}

static char g_myCall[16];

// This station's call, for the a priori guess of a call to it (empty: none). True if it could be used
int ft8_set_mycall(const char* call)
{
  // (Passed in from JS in g_myCall itself: ft8_mycall_buffer)
  if (call != g_myCall) strncpy(g_myCall, call ? call : "", sizeof(g_myCall) - 1);
  g_myCall[sizeof(g_myCall) - 1] = '\0';
  if (!g_myCall[0])
  {
    g_ap[1].on = false;
    return 0;
  }
  return apMessage(1, g_myCall) ? 1 : 0;
}

// For passing the call in from JS
char* ft8_mycall_buffer(void) { return g_myCall; }

// ---- A station's next message (a4)
//
// The idea is WSJT-X's (its a7 decodes; with thanks to Joe Taylor, K1JT, and the WSJT development team: its approach read in its
// source, written here for this): a station heard two periods before on about this frequency (QSO_HZ) most likely sends one of a few
// dozen whole messages next, its own two calls with a grid, RRR, RR73, 73 or a signal report (after a CQ: its CQ again). Each of those
// messages' codewords is compared with what was heard (the bits it would have that weren't heard so, each counted by how sure it was);
// the closest is taken if it is clearly closer than the next closest (DICT_RATIO), and no more than DICT_MAX_HARD bits off
#define DICT_ENTRIES 80
#define DICT_FORMS 130
#ifndef DICT_RATIO
#define DICT_RATIO 1.3f
#endif
#ifndef DICT_MAX_HARD
#define DICT_MAX_HARD 50  // measured: 116 in WSJT-X's list under 50 bits off against 10 not, most of those the QSO's natural next step;
                          // over 50, mostly false
#endif
typedef struct
{
  float hz;
  int count;
  uint8_t payload[DICT_FORMS][10];
  bits174_t cw[DICT_FORMS];
} DictEntry;
static DictEntry g_dict[DICT_ENTRIES];
static int g_dictCount = 0, g_dictPeriod = -1;

static void dictAdd(DictEntry* e, const char* to, const char* de, const char* extra)
{
  if (e->count >= DICT_FORMS) return;
  ftx_message_t m;
  if (ftx_message_encode_std(&m, &g_noHash, to, de, extra) != FTX_MESSAGE_RC_OK) return;
  memcpy(e->payload[e->count], m.payload, 10);
  uint8_t a91[FTX_LDPC_K_BYTES];
  ftx_add_crc(m.payload, a91);
  bits174_t* cw = &e->cw[e->count];
  memset(cw, 0, sizeof(*cw));
  for (int n = 0; n < FTX_LDPC_K; n++)
  {
    if (a91[n >> 3] & (0x80u >> (n & 7))) bitsXor(cw, &g_generator[n]);
  }
  e->count++;
}

static bool isGrid4(const char* s) { return strlen(s) == 4 && s[0] >= 'A' && s[0] <= 'R' && s[1] >= 'A' && s[1] <= 'R' && s[2] >= '0' && s[2] <= '9' && s[3] >= '0' && s[3] <= '9'; }

// The messages each station heard two periods before might send now (once a period)
static void dictionaryBuild(void)
{
  if (g_dictPeriod == g_period) return;
  g_dictPeriod = g_period;
  g_dictCount = 0;
  if (!g_generatorReady) generatorRows();
  for (int i = 0; i < g_historyCount && g_dictCount < DICT_ENTRIES; i++)
  {
    if (g_history[i].period != g_period - 2) continue;
    ftx_message_t m;
    memcpy(m.payload, g_history[i].payload, 10);
    if (ftx_message_get_i3(&m) != 1) continue;
    char to[32], de[32], extra[32];
    ftx_field_t fields[FTX_MAX_MESSAGE_FIELDS];
    if (ftx_message_decode_std(&m, &g_noHash, to, de, extra, fields) != FTX_MESSAGE_RC_OK) continue;
    if (strchr(to, '<') || strchr(de, '<') || strchr(to, '/') || strchr(de, '/')) continue;
    DictEntry* e = &g_dict[g_dictCount];
    e->hz = g_history[i].hz;
    e->count = 0;
    if (strncmp(to, "CQ", 2) == 0) dictAdd(e, to, de, extra);
    else
    {
      dictAdd(e, to, de, "");
      dictAdd(e, to, de, "RRR");
      dictAdd(e, to, de, "RR73");
      dictAdd(e, to, de, "73");
      if (isGrid4(extra)) dictAdd(e, to, de, extra);
      char report[8];
      for (int r = -30; r <= 30; r++)
      {
        snprintf(report, sizeof(report), "%c%02d", r < 0 ? '-' : '+', r < 0 ? -r : r);
        dictAdd(e, to, de, report);
        snprintf(report, sizeof(report), "R%c%02d", r < 0 ? '-' : '+', r < 0 ? -r : r);
        dictAdd(e, to, de, report);
      }
    }
    if (e->count) g_dictCount++;
  }
}

static bool dictionaryDecode(const float* llr, float hz, ftx_message_t* message, int* differ)
{
  dictionaryBuild();
  bits174_t heard;
  float sureness[FTX_LDPC_N];
  memset(&heard, 0, sizeof(heard));
  for (int n = 0; n < FTX_LDPC_N; n++)
  {
    sureness[n] = fabsf(llr[n]);
    if (llr[n] > 0.0f) bitFlip(&heard, n);
  }
  float best = 1e30f, second = 1e30f;
  int bestCount = 0;
  const uint8_t* bestPayload = 0;
  for (int i = 0; i < g_dictCount; i++)
  {
    if (fabsf(g_dict[i].hz - hz) > QSO_HZ) continue;
    for (int k = 0; k < g_dict[i].count; k++)
    {
      int count;
      float cost = codewordCost(&g_dict[i].cw[k], &heard, sureness, &count);
      if (cost < best)
      {
        second = best;
        best = cost;
        bestCount = count;
        bestPayload = g_dict[i].payload[k];
      }
      else if (cost < second) second = cost;
    }
  }
  if (!bestPayload || second < DICT_RATIO * best || bestCount >= DICT_MAX_HARD) return false;
  uint8_t a91[FTX_LDPC_K_BYTES];
  ftx_add_crc(bestPayload, a91);
  memcpy(message->payload, bestPayload, 10);
  message->hash = ftx_extract_crc(a91);
  *differ = bestCount;
  return true;
}

// How a message was decoded: 0 belief propagation, 1 OSD, 2 + kind for a priori (2 a1, 3 a2, 4 a3), 5 a station's next message (a4)
static bool decodeLlr(float* llr, float hz, ftx_message_t* message, int* how, int* differ);
#ifdef FT8_STATS
// Test builds: OSD and a priori tries by belief propagation's unsatisfied parity checks before them, failed [0] or taken [1]
static int g_osdBp[2][84], g_apBp[2][84];
int* ft8_osd_bp(void) { return &g_osdBp[0][0]; }
int* ft8_ap_bp(void) { return &g_apBp[0][0]; }
#endif

static bool decodeCandidate(const ftx_waterfall_t* wf, const ftx_candidate_t* cand, ftx_message_t* message, int* how, int* differ)
{
  float llr[FTX_LDPC_N];
  bitLikelihoods(wf, cand, llr);
  float hz = (g_mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / g_mon.symbol_period;
  return decodeLlr(llr, hz, message, how, differ);
}

// The guesses for a candidate at hz: a CQ, a call to this station, and the next message of a QSO heard there two periods before
static int apGuesses(float hz, ApGuess* guesses, int room)
{
  int n = 0;
  for (int kind = 0; kind < AP_KINDS && n < room; kind++)
  {
    if (!g_ap[kind].on) continue;
    memcpy(guesses[n].payload, g_ap[kind].payload, 10);
    guesses[n].from = 0;
    guesses[n].to = 29;
    guesses[n].how = 2 + kind;
    n++;
  }
  for (int i = 0; i < g_historyCount && n < room; i++)
  {
    if (g_history[i].period != g_period - 2 || fabsf(g_history[i].hz - hz) > QSO_HZ) continue;
    ftx_message_t m;
    memcpy(m.payload, g_history[i].payload, 10);
    if (ftx_message_get_i3(&m) != 1) continue;
    // After its CQ (its first 29 bits a CQ's), its own call is the second
    bool cq = true;
    for (int b = 0; b < 29 && cq; b++) cq = payloadBit(m.payload, b) == payloadBit(g_ap[0].payload, b);
    memcpy(guesses[n].payload, m.payload, 10);
    guesses[n].from = cq ? 29 : 0;
    guesses[n].to = 58;
    guesses[n].how = 4;
    n++;
#ifndef NO_QSO_OWN
    // And its own call only (it may have called CQ again, or answered another), if it wasn't a CQ (that guess is this one already)
    if (!cq && n < room)
    {
      memcpy(guesses[n].payload, m.payload, 10);
      guesses[n].from = 29;
      guesses[n].to = 58;
      guesses[n].how = 4;
      n++;
    }
#endif
  }
  return n;
}

// The messages decoded this period at their frequency (recs, as ft8_try gives them; each once), for later periods' guesses; those over
// 4 periods old let go
int ft8_note(const float* recs, int n)
{
  int kept = 0;
  for (int i = 0; i < g_historyCount; i++)
  {
    if (g_history[i].period >= g_period - 4) g_history[kept++] = g_history[i];
  }
  g_historyCount = kept;
  for (int i = 0; i < n && g_historyCount < HISTORY_MAX; i++)
  {
    const float* r = &recs[i * 22];
    uint8_t payload[10];
    for (int b = 0; b < 10; b++) payload[b] = (uint8_t)r[b];
    bool known = false;
    for (int k = 0; k < g_historyCount && !known; k++) known = g_history[k].period == g_period && memcmp(g_history[k].payload, payload, 10) == 0;
    if (known) continue;
    g_history[g_historyCount].period = g_period;
    g_history[g_historyCount].hz = r[13];
    memcpy(g_history[g_historyCount].payload, payload, 10);
    g_historyCount++;
  }
  return g_historyCount;
}

// The bit likelihoods (as bitLikelihoods gives them) of a candidate at hz decoded: belief propagation, then OSD, then a priori
static bool decodeLlr(float* llr, float hz, ftx_message_t* message, int* how, int* differ)
{
  uint8_t plain[FTX_LDPC_N];
  int errors;
  bits174_t cw;
  bp_decode(llr, LDPC_ITERATIONS, plain, &errors);
  if (errors == 0)
  {
    memset(&cw, 0, sizeof(cw));
    for (int n = 0; n < FTX_LDPC_N; n++)
    {
      if (plain[n]) bitFlip(&cw, n);
    }
    if (codewordMessage(&cw, message))
    {
      *how = 0;
      *differ = 0;
      return true;
    }
  }
  if (g_depth < 1) return false;
#ifndef NO_OSD
  bool osdOk = osdDecode(llr, &cw, differ) && *differ < OSD_MAX_HARD && codewordMessage(&cw, message);
#ifdef FT8_STATS
  g_osdBp[osdOk ? 1 : 0][errors < 0 ? 0 : errors > 83 ? 83 : errors]++;
#endif
  if (osdOk)
  {
    *how = 1;
    return true;
  }
#endif
  if (g_depth < 2) return false;
#ifndef NO_AP
  // The known bits as sure as the surest heard
  float sure = 0.0f;
  for (int n = 0; n < FTX_LDPC_N; n++) sure = fabsf(llr[n]) > sure ? fabsf(llr[n]) : sure;
  ApGuess guesses[AP_KINDS + 4];
  int numGuesses = apGuesses(hz, guesses, AP_KINDS + 4);
  for (int g = 0; g < numGuesses; g++)
  {
    const ApGuess* guess = &guesses[g];
    float apLlr[FTX_LDPC_N];
    memcpy(apLlr, llr, sizeof(apLlr));
    for (int n = 0; n < FTX_LDPC_K; n++)
    {
      if (guessKnown(guess, n)) apLlr[n] = payloadBit(guess->payload, n) ? sure * 1.1f : -sure * 1.1f;
    }
    bool ok = false;
    bp_decode(apLlr, LDPC_ITERATIONS, plain, &errors);
    if (errors == 0)
    {
      memset(&cw, 0, sizeof(cw));
      for (int n = 0; n < FTX_LDPC_N; n++)
      {
        if (plain[n]) bitFlip(&cw, n);
      }
      ok = codewordMessage(&cw, message);
    }
    int apErrors = errors;
    if (!ok) ok = osdDecode(apLlr, &cw, differ) && codewordMessage(&cw, message);
    if (!ok)
    {
#ifdef FT8_STATS
      g_apBp[0][apErrors < 0 ? 0 : apErrors > 83 ? 83 : apErrors]++;
#endif
      continue;
    }
    // Its distance from what was heard (the known bits as heard, too), and the guess's bits really in it
    float reliability[FTX_LDPC_N];
    bits174_t hard;
    memset(&hard, 0, sizeof(hard));
    for (int n = 0; n < FTX_LDPC_N; n++)
    {
      reliability[n] = fabsf(llr[n]);
      if (llr[n] > 0.0f) bitFlip(&hard, n);
    }
    codewordCost(&cw, &hard, reliability, differ);
    bool matches = true;
    for (int n = 0; n < 77 && matches; n++)
    {
      if (guessKnown(guess, n) && payloadBit(message->payload, n) != payloadBit(guess->payload, n)) matches = false;
    }
#ifdef FT8_STATS
    g_apBp[matches && *differ < AP_MAX_HARD ? 1 : 0][apErrors < 0 ? 0 : apErrors > 83 ? 83 : apErrors]++;
#endif
    if (!matches || *differ >= AP_MAX_HARD) continue;
    *how = guess->how;
    return true;
  }
#endif
#ifndef NO_REPEAT
  // Last, a station's next message (a4), from those it could send (dictionary). Not when copies have been added together: that assumes a
  // repeat already, and a report changed between them would be taken as the earlier one
  if (!g_combining && dictionaryDecode(llr, hz, message, differ))
  {
    *how = 5;
    return true;
  }
#endif
  return false;
}

// ---- Fine demodulation: a signal taken down to its own baseband and its symbols read one by one
//
// ft8_lib reads tone powers off a waterfall of 2-symbol frames in 0.5 dB steps, at the nearest half symbol and half tone step. Here
// each signal is instead shifted down to 0 Hz and its band (Â±100 Hz) brought down to 200 samples a second (fast convolution: the period's
// spectrum, its bins about the signal, inverse transformed), so a symbol is 32 samples and each tone a bin of a 32-point transform over
// exactly that symbol. Its time (5 ms) and frequency (0.5 Hz steps) are set where its Costas sync tones stand out most, and its bit
// likelihoods made from the tones' linear power. Textbook non-coherent FSK, written here for this
#include <fft/kiss_fft.h>
#include <fft/kiss_fftr.h>

#define FINE_N 192000      // the period's transform: 16 s at 12 kHz (the 15 s heard, zeros after)
#define BB_RATE 200
#define BB_N 3200          // 16 s at 200 Hz
#define BB_SYMBOL 32
#define FINE_DF_STEPS 5    // either side, in 0.5 Hz
#ifndef FINE_MIN_SYNC
#define FINE_MIN_SYNC 0.27f // a fine reading whose sync tones stand out less than this isn't decoded (none under 0.30 ever did, on
                            // three recordings: about two in three of those tried are under it)
#endif
#ifdef FT8_STATS
static int g_fineSync[2][20];
int* ft8_fine_sync(void) { return &g_fineSync[0][0]; }
#endif
#ifndef FINE_RANGE
#define FINE_RANGE 0.12f   // either side of a candidate's time (s)
#endif

static kiss_fftr_cfg g_periodFft = 0;
static kiss_fft_cfg g_bbIfft = 0;
static kiss_fft_cpx g_periodSpectrum[FINE_N / 2 + 1];
static int g_spectrumReady = 0;
static float g_tw[8][BB_SYMBOL][2];  // a tone's 32-point transform kernel (cos, -sin)

// The period's spectrum, from the samples in g_input (num_samples of them)
static void fineSpectrum(int num_samples)
{
  static float padded[FINE_N];
  if (!g_periodFft)
  {
    g_periodFft = kiss_fftr_alloc(FINE_N, 0, 0, 0);
    g_bbIfft = kiss_fft_alloc(BB_N, 1, 0, 0);
    for (int m = 0; m < 8; m++)
    {
      for (int n = 0; n < BB_SYMBOL; n++)
      {
        g_tw[m][n][0] = cosf(2.0f * (float)M_PI * m * n / BB_SYMBOL);
        g_tw[m][n][1] = -sinf(2.0f * (float)M_PI * m * n / BB_SYMBOL);
      }
    }
  }
  int n = num_samples < FINE_N ? num_samples : FINE_N;
  memcpy(padded, g_input, n * sizeof(float));
  memset(padded + n, 0, (FINE_N - n) * sizeof(float));
  kiss_fftr(g_periodFft, padded, g_periodSpectrum);
  g_spectrumReady = 1;
}

// The band about f0 (Hz) at 200 Hz, f0 at 0 Hz: bb[BB_N]
static void fineBaseband(float f0, kiss_fft_cpx* bb)
{
  static kiss_fft_cpx in[BB_N];
  const float binHz = 12000.0f / FINE_N;
  int k0 = (int)lroundf(f0 / binHz);
  for (int j = -BB_N / 2; j < BB_N / 2; j++)
  {
    int k = k0 + j;
    float hz = fabsf(j * binHz);
    // Flat to 75 Hz either side, a cosine taper to 100
    float w = hz <= 75.0f ? 1.0f : hz >= 100.0f ? 0.0f : 0.5f + 0.5f * cosf((float)M_PI * (hz - 75.0f) / 25.0f);
    kiss_fft_cpx v = { 0.0f, 0.0f };
    if (k >= 0 && k <= FINE_N / 2 && w > 0.0f)
    {
      v.r = g_periodSpectrum[k].r * w;
      v.i = g_periodSpectrum[k].i * w;
    }
    in[(j + BB_N) % BB_N] = v;
  }
  kiss_fft(g_bbIfft, in, bb);
}

// The 8 tones' power in the symbol starting at sample s of a baseband: p[8]
static void symbolPowers(const kiss_fft_cpx* bb, int s, float* p)
{
  float re[8] = { 0 }, im[8] = { 0 };
  for (int n = 0; n < BB_SYMBOL; n++)
  {
    int at = s + n;
    if (at < 0 || at >= BB_N) continue;
    float xr = bb[at].r, xi = bb[at].i;
    for (int m = 0; m < 8; m++)
    {
      re[m] += xr * g_tw[m][n][0] - xi * g_tw[m][n][1];
      im[m] += xr * g_tw[m][n][1] + xi * g_tw[m][n][0];
    }
  }
  for (int m = 0; m < 8; m++) p[m] = re[m] * re[m] + im[m] * im[m];
}

// Each tone's power in a symbol starting at every sample (lo to hi) of the baseband shifted by each frequency step: a sliding 32-point
// transform, each start's from the one before (worked out afresh every 128, so it doesn't drift). g_tonePower[step][tone][sample]
static float g_tonePower[2 * FINE_DF_STEPS + 1][8][BB_N];
static float g_allPower[2 * FINE_DF_STEPS + 1][BB_N];
static int g_powerLo, g_powerHi;

static void tonePowers(const kiss_fft_cpx* x, int d)
{
  float (*P)[BB_N] = g_tonePower[d];
  float* all = g_allPower[d];
  float wr[8], wi[8];
  for (int m = 0; m < 8; m++)
  {
    wr[m] = cosf(2.0f * (float)M_PI * m / BB_SYMBOL);
    wi[m] = sinf(2.0f * (float)M_PI * m / BB_SYMBOL);
  }
  double re[8], im[8];
  for (int s = g_powerLo; s <= g_powerHi; s++)
  {
    if ((s - g_powerLo) % 128 == 0)
    {
      for (int m = 0; m < 8; m++) re[m] = im[m] = 0.0;
      for (int n = 0; n < BB_SYMBOL; n++)
      {
        int at = s + n;
        if (at >= BB_N) break;
        for (int m = 0; m < 8; m++)
        {
          re[m] += x[at].r * g_tw[m][n][0] - x[at].i * g_tw[m][n][1];
          im[m] += x[at].r * g_tw[m][n][1] + x[at].i * g_tw[m][n][0];
        }
      }
    }
    else
    {
      // X(s) = e^(j 2 pi m / 32) (X(s - 1) - x[s - 1] + x[s + 31])
      int out = s - 1, in = s + BB_SYMBOL - 1;
      double dr = -x[out].r + (in < BB_N ? x[in].r : 0.0f), di = -x[out].i + (in < BB_N ? x[in].i : 0.0f);
      for (int m = 0; m < 8; m++)
      {
        double r = re[m] + dr, i = im[m] + di;
        re[m] = r * wr[m] - i * wi[m];
        im[m] = r * wi[m] + i * wr[m];
      }
    }
    float total = 0.0f;
    for (int m = 0; m < 8; m++)
    {
      P[m][s] = (float)(re[m] * re[m] + im[m] * im[m]);
      total += P[m][s];
    }
    all[s] = total;
  }
}

static inline float tonePower(int d, int m, int s) { return s < g_powerLo || s > g_powerHi ? 0.0f : g_tonePower[d][m][s]; }
static inline float allPower(int d, int s) { return s < g_powerLo || s > g_powerHi ? 0.0f : g_allPower[d][s]; }

// How far a signal's Costas sync tones stand out at a start sample and frequency step: their share of the power in their symbols
static float fineSync(int d, int s)
{
  float on = 0.0f, all = 0.0f;
  for (int b = 0; b < 3; b++)
  {
    for (int k = 0; k < 7; k++)
    {
      int at = s + (b * 36 + k) * BB_SYMBOL;
      on += tonePower(d, kFT8_Costas_pattern[k], at);
      all += allPower(d, at);
    }
  }
  return all > 0.0f ? on / all : 0.0f;
}

// A signal at about f0 Hz starting about t0 s into the period (within range s either way): its time and frequency set by its sync tones
// (10 ms steps, then 5), and its bit likelihoods (llr, as bitLikelihoods gives them). *syncOut: fineSync where it was set
static float g_symRe[FT8_NN][8], g_symIm[FT8_NN][8];
// The weight of a tone's amplitude in the last fine reading (2 A / noise: fineLikelihoods), for the multi-symbol readings too
static double g_lseGain = 0.0;

static int floatAscending(const void* a, const void* b)
{
  float x = *(const float*)a, y = *(const float*)b;
  return x < y ? -1 : x > y ? 1 : 0;
}

// The fine reading's bit likelihoods scaled to this variance (ft8_lib's own: 24, found for its dB metric)
#ifndef FINE_LLR_VAR
#define FINE_LLR_VAR 24.0f
#endif

static void normalizeLlr(float* llr)
{
  float sum = 0.0f, sum2 = 0.0f;
  for (int i = 0; i < FTX_LDPC_N; i++)
  {
    sum += llr[i];
    sum2 += llr[i] * llr[i];
  }
  float variance = (sum2 - sum * sum / FTX_LDPC_N) / FTX_LDPC_N;
  float norm = variance > 0.0f ? sqrtf(FINE_LLR_VAR / variance) : 1.0f;
  for (int i = 0; i < FTX_LDPC_N; i++) llr[i] *= norm;
}

// The bit likelihoods of the signal fineLikelihoods last read, its data symbols taken nsym (2 or 3) at a time: FT8's tones are a whole
// number of cycles a symbol apart (6.25 Hz, 0.16 s) and its phase runs on from symbol to symbol, so the transforms of symbols next to
// each other add up coherently. Each bit: the strongest sum of a run of tones with it set, less the strongest without (the textbook
// multi-symbol non-coherent detector; the QEX paper on FT8 describes reading bits this way)
static void fineMultiLikelihoods(int nsym, float* llr)
{
  for (int block = 0; block < 2; block++)
  {
    // The 29 data symbols of each half, in runs of nsym (the last run shorter if they don't divide)
    for (int first = 0; first < 29; first += nsym)
    {
      int g = 29 - first < nsym ? 29 - first : nsym;
      int combos = 1 << (3 * g);
      float bestOne[9], bestZero[9];
      for (int b = 0; b < 3 * g; b++) bestOne[b] = bestZero[b] = -1.0f;
#ifndef NO_MULTI_LSE
      // Every run of tones weighed by how likely it is (e^(2 A |sum| / noise)), summed with and without each bit
      static double mags[512];
      double top = -1e30;
#endif
      for (int c = 0; c < combos; c++)
      {
        float sr = 0.0f, si = 0.0f;
        for (int j = 0; j < g; j++)
        {
          int bits = (c >> (3 * (g - 1 - j))) & 7;
          int k = block * 29 + first + j, sym = k + (k < 29 ? 7 : 14);
          int tone = kFT8_Gray_map[bits];
          sr += g_symRe[sym][tone];
          si += g_symIm[sym][tone];
        }
        float mag = sqrtf(sr * sr + si * si);
#ifndef NO_MULTI_LSE
        mags[c] = g_lseGain * mag;
        if (mags[c] > top) top = mags[c];
#endif
        for (int b = 0; b < 3 * g; b++)
        {
          if ((c >> (3 * g - 1 - b)) & 1) { if (mag > bestOne[b]) bestOne[b] = mag; }
          else if (mag > bestZero[b]) bestZero[b] = mag;
        }
      }
      for (int b = 0; b < 3 * g; b++) llr[3 * (block * 29 + first) + b] = bestOne[b] - bestZero[b];
#ifndef NO_MULTI_LSE
      if (g_lseGain > 0.0)
      {
        for (int b = 0; b < 3 * g; b++)
        {
          double one = 0.0, zero = 0.0;
          for (int c = 0; c < combos; c++)
          {
            double w = exp(mags[c] - top);
            if ((c >> (3 * g - 1 - b)) & 1) one += w;
            else zero += w;
          }
          llr[3 * (block * 29 + first) + b] = (float)(log(one + 1e-300) - log(zero + 1e-300));
        }
      }
#endif
    }
  }
  normalizeLlr(llr);
}

// The bit likelihoods of the signal fineLikelihoods last read, one symbol at a time, each the difference between the strongest tone with
// the bit and the strongest without, as a share of the stronger of the two (so a symbol a burst of noise or a neighbour lifted counts no
// more than any other). A fourth reading, after WSJT-X's (its fourth bit metric)
static void fineRatioLikelihoods(float* llr)
{
  for (int k = 0; k < FT8_ND; k++)
  {
    int sym = k + (k < 29 ? 7 : 14), bit = 3 * k;
    float s[8];
    for (int j = 0; j < 8; j++)
    {
      int tone = kFT8_Gray_map[j];
      s[j] = sqrtf(g_symRe[sym][tone] * g_symRe[sym][tone] + g_symIm[sym][tone] * g_symIm[sym][tone]);
    }
    for (int b = 0; b < 3; b++)
    {
      float one = 0.0f, zero = 0.0f;
      for (int j = 0; j < 8; j++)
      {
        if ((j >> (2 - b)) & 1) one = s[j] > one ? s[j] : one;
        else zero = s[j] > zero ? s[j] : zero;
      }
      float top = one > zero ? one : zero;
      llr[bit + b] = top > 0.0f ? (one - zero) / top : 0.0f;
    }
  }
  normalizeLlr(llr);
}

static void fineLikelihoods(float f0, float t0, float range, float* llr, float* syncOut, float* fOut, float* tOut)
{
  static kiss_fft_cpx bb[BB_N];
  static kiss_fft_cpx x[BB_N];
  fineBaseband(f0, bb);
  int s0 = (int)lroundf(t0 * BB_RATE), reach = (int)lroundf(range * BB_RATE) + 1;
  // The symbol starts that can be asked for: the earliest sync symbol to the last symbol, either side of the time searched
  g_powerLo = s0 - reach;
  g_powerHi = s0 + reach + 78 * BB_SYMBOL;
  if (g_powerLo < 0) g_powerLo = 0;
  if (g_powerHi > BB_N - 1) g_powerHi = BB_N - 1;
  int lo = g_powerLo, hi = g_powerHi + BB_SYMBOL < BB_N ? g_powerHi + BB_SYMBOL : BB_N;
  for (int d = -FINE_DF_STEPS; d <= FINE_DF_STEPS; d++)
  {
    // Shifted by d half hertz: e^(-j 2 pi df n / rate), stepped from n = lo (put right every 64 steps, so it doesn't drift)
    double step = -2.0 * M_PI * 0.5 * d / BB_RATE;
    double c = cos(step * lo), sn = sin(step * lo), dc = cos(step), ds = sin(step);
    for (int n = lo; n < hi; n++)
    {
      x[n].r = (float)(bb[n].r * c - bb[n].i * sn);
      x[n].i = (float)(bb[n].r * sn + bb[n].i * c);
      double nc = c * dc - sn * ds;
      sn = c * ds + sn * dc;
      c = nc;
      if (((n - lo) & 63) == 63)
      {
        c = cos(step * (n + 1));
        sn = sin(step * (n + 1));
      }
    }
    tonePowers(x, d + FINE_DF_STEPS);
  }
  float best = -1.0f, bestDf = 0.0f;
  int bestS = s0, bestD = 0;
  for (int d = -FINE_DF_STEPS; d <= FINE_DF_STEPS; d++)
  {
    for (int ds = -reach + 1; ds <= reach - 1; ds++)
    {
      float sync = fineSync(d + FINE_DF_STEPS, s0 + ds);
      if (sync > best)
      {
        best = sync;
        bestDf = 0.5f * d;
        bestD = d;
        bestS = s0 + ds;
      }
    }
  }
  *syncOut = best;
  *fOut = f0 + bestDf;
  *tOut = (float)bestS / BB_RATE;
  // Each symbol's 8 tones as complex values where it was set (for reading 2 or 3 symbols together: fineMultiLikelihoods)
  {
    double step = -2.0 * M_PI * bestDf / BB_RATE;
    for (int k = 0; k < FT8_NN; k++)
    {
      float re[8] = { 0 }, im[8] = { 0 };
      for (int n = 0; n < BB_SYMBOL; n++)
      {
        int at = bestS + k * BB_SYMBOL + n;
        if (at < 0 || at >= BB_N) continue;
        float c = (float)cos(step * at), sn = (float)sin(step * at);
        float xr = bb[at].r * c - bb[at].i * sn, xi = bb[at].r * sn + bb[at].i * c;
        for (int m = 0; m < 8; m++)
        {
          re[m] += xr * g_tw[m][n][0] - xi * g_tw[m][n][1];
          im[m] += xr * g_tw[m][n][1] + xi * g_tw[m][n][0];
        }
      }
      for (int m = 0; m < 8; m++)
      {
        g_symRe[k][m] = re[m];
        g_symIm[k][m] = im[m];
      }
    }
  }
#ifdef FINE_TONE_NORM
  // Each tone's typical amplitude over the message (its median over the 79 symbols: the signal is on any one tone about one symbol in
  // eight), so a tone a neighbour spills into counts for less; the symbols' values divided by it
  {
    for (int m = 0; m < 8; m++)
    {
      float a[FT8_NN];
      for (int k = 0; k < FT8_NN; k++) a[k] = sqrtf(g_symRe[k][m] * g_symRe[k][m] + g_symIm[k][m] * g_symIm[k][m]);
      qsort(a, FT8_NN, sizeof(float), floatAscending);
      float level = a[FT8_NN / 2] > 0.0f ? a[FT8_NN / 2] : 1.0f;
      for (int k = 0; k < FT8_NN; k++)
      {
        g_symRe[k][m] /= level;
        g_symIm[k][m] /= level;
      }
    }
  }
#endif
  for (int k = 0; k < FT8_ND; k++)
  {
    int sym = k + (k < 29 ? 7 : 14), bit = 3 * k;
    float s[8];
    for (int j = 0; j < 8; j++)
    {
#ifdef FINE_TONE_NORM
      int tone = kFT8_Gray_map[j];
      s[j] = sqrtf(g_symRe[sym][tone] * g_symRe[sym][tone] + g_symIm[sym][tone] * g_symIm[sym][tone]);
#else
      float v = tonePower(bestD + FINE_DF_STEPS, kFT8_Gray_map[j], bestS + sym * BB_SYMBOL);
      // Amplitude (tried: power, amplitude and dB; amplitude decoded the most)
      s[j] = sqrtf(v);
#endif
    }
    llr[bit] = maxOf4(s[4], s[5], s[6], s[7]) - maxOf4(s[0], s[1], s[2], s[3]);
    llr[bit + 1] = maxOf4(s[2], s[3], s[6], s[7]) - maxOf4(s[0], s[1], s[4], s[5]);
    llr[bit + 2] = maxOf4(s[1], s[3], s[5], s[7]) - maxOf4(s[0], s[2], s[4], s[6]);
  }
#ifndef NO_LSE
  // Each bit from all the tones weighed by how likely each is to be the one sent (non-coherent FSK: a tone's amplitude a
  // counts as e^(2 A a / noise), A the signal's amplitude and noise the power of a tone it isn't on), summed with and without the bit
  {
    double noise = 0.0, amp = 0.0;
    int nn = 0;
    for (int k = 0; k < FT8_NN; k++)
    {
      int top = 0;
      float p[8];
      for (int m = 0; m < 8; m++)
      {
        p[m] = g_symRe[k][m] * g_symRe[k][m] + g_symIm[k][m] * g_symIm[k][m];
        if (p[m] > p[top]) top = m;
      }
      amp += sqrtf(p[top]);
      for (int m = 0; m < 8; m++) if (m != top) { noise += p[m]; nn++; }
    }
    noise = nn ? noise / nn : 1.0;
    amp /= FT8_NN;
    double gain = noise > 0.0 ? 2.0 * amp / noise : 0.0;
    g_lseGain = gain;
    for (int k = 0; k < FT8_ND; k++)
    {
      int sym = k + (k < 29 ? 7 : 14), bit = 3 * k;
      double e[8], top = -1e30;
      for (int j = 0; j < 8; j++)
      {
        int tone = kFT8_Gray_map[j];
        e[j] = gain * sqrt(g_symRe[sym][tone] * g_symRe[sym][tone] + g_symIm[sym][tone] * g_symIm[sym][tone]);
        if (e[j] > top) top = e[j];
      }
      for (int b = 0; b < 3; b++)
      {
        double one = 0.0, zero = 0.0;
        for (int j = 0; j < 8; j++)
        {
          double w = exp(e[j] - top);
          if ((j >> (2 - b)) & 1) one += w;
          else zero += w;
        }
        llr[bit + b] = (float)(log(one + 1e-300) - log(zero + 1e-300));
      }
    }
  }
#endif
  normalizeLlr(llr);
}

#ifdef FT8_STATS
// Test builds: decode at a given place (Hz of the lowest tone, s from the start of g_input) both ways, the period's g_input already
// decoded or not: "fine\tsync\tfreq\tt\ttext" then "lib\ttext" (empty text: no decode) in ft8_output
int ft8_probe(float freq, float t0, int num_samples, float range)
{
  fineSpectrum(num_samples);
  char* out = g_output;
  out[0] = 0;
  float llr[FTX_LDPC_N], sync, fF, fT;
  ftx_message_t message;
  int how, differ;
  char text[FTX_MAX_MESSAGE_LENGTH];
  ftx_message_offsets_t offsets;
  fineLikelihoods(freq, t0, range, llr, &sync, &fF, &fT);
  text[0] = 0;
  if (decodeLlr(llr, fF, &message, &how, &differ) && ftx_message_decode(&message, &g_hash_if, text, &offsets) != FTX_MESSAGE_RC_OK) text[0] = 0;
  out += sprintf(out, "fine\t%.3f\t%.1f\t%.3f\t%s\n", sync, fF, fT, text);
  // ft8_lib's way, at the nearest candidates about the place
  monitor_reset(&g_mon);
  for (int pos = 0; pos + g_mon.block_size <= num_samples; pos += g_mon.block_size) monitor_process(&g_mon, g_input + pos);
  ftx_waterfall_t* wf = &g_mon.wf;
  text[0] = 0;
  float fpos = (freq * g_mon.symbol_period - g_mon.min_bin) * wf->freq_osr, tpos = t0 / g_mon.symbol_period * wf->time_osr;
  int reach = (int)ceilf(range / g_mon.symbol_period * wf->time_osr);
  for (int dt = -reach; dt <= reach && !text[0]; dt++)
  {
    for (int df = -2; df <= 2 && !text[0]; df++)
    {
      int ft = (int)lroundf(fpos) + df, tt = (int)lroundf(tpos) + dt;
      if (ft < 0) continue;
      ftx_candidate_t cand = { 0 };
      cand.freq_offset = ft / wf->freq_osr;
      cand.freq_sub = ft % wf->freq_osr;
      cand.time_offset = (int)floorf((float)tt / wf->time_osr);
      cand.time_sub = tt - cand.time_offset * wf->time_osr;
      if (decodeCandidate(wf, &cand, &message, &how, &differ) && ftx_message_decode(&message, &g_hash_if, text, &offsets) != FTX_MESSAGE_RC_OK) text[0] = 0;
    }
  }
  out += sprintf(out, "lib\t%s\n", text);
  return 1;
}
#endif

// ---- Taking a decoded signal out of the audio
//
// Its waveform rebuilt from its tones as FT8 sends them (8-FSK, tones 6.25 Hz apart, 0.16 s symbols, each change of frequency smoothed by
// a Gaussian filter with BT = 2, as the protocol is published), at the frequency and time the fine reading set; its amplitude and phase
// along it measured by mixing the audio down with the rebuilt carrier and averaging over SUB_WINDOW symbols (a fade or a slight frequency
// error just turns it slowly); that taken off the audio, so the next pass hears what was under it
#ifndef SUB_ROUNDS
#define SUB_ROUNDS 2
#endif
// The raised cosine the amplitude is averaged through, samples either side (0: SUB_WINDOW symbols, flat). Measured on four recordings:
// 1300 took off 17 to 18 dB (the flat 1 symbol 15 to 16) and decoded the most (750: deeper, but fewer decodes; 2000: shallower)
#ifndef SUB_COSINE
#define SUB_COSINE 1300
#endif
#ifndef SUB_WINDOW
#define SUB_WINDOW 1.0f
#endif
#define SPS 1920  // samples a symbol at 12 kHz

#ifdef FT8_STATS
static double g_subStats[3];
double* ft8_sub_stats(void) { return g_subStats; }
static double g_phaseBest = 0.0;
static double g_tauSum = 0.0, g_tauCount = 0.0;
double ft8_tau(void) { return g_tauCount ? g_tauSum / g_tauCount : 0.0; }
static char g_phaseText[4000];
char* ft8_phase_text(void) { g_phaseBest = 0.0; return g_phaseText; }
#endif

static float gfskPulse(float t)
{
  // A symbol's frequency pulse, t in symbols from its middle: (erf(k b (t + 1/2)) - erf(k b (t - 1/2))) / 2, k = pi sqrt(2 / ln 2), b = BT
  const float k = (float)M_PI * sqrtf(2.0f / logf(2.0f)), b = 2.0f;
  return 0.5f * (erff(k * b * (t + 0.5f)) - erff(k * b * (t - 0.5f)));
}

// The rebuilt carrier's tone pattern, sample by sample: e^(-j 2 pi 6.25 Hz (the tone steps so far, summed)), each symbol's frequency
// pulse spread a symbol either side, the first and last tones held past the ends. The carrier's own frequency is turned in later
static void subPattern(const uint8_t* tones, const float* pulse, float* pr, float* pi)
{
  // Within symbol k, at u samples into it, its own pulse and its two neighbours' are always all three there (the ends' tones held), so
  // no sample needs a test. Stepped by its small turn (under 0.025 rad: cos and sin to their third terms), worked out afresh each symbol
  double ph = 0.0;
  for (int k = 0; k < FT8_NN; k++)
  {
    float before = tones[k > 0 ? k - 1 : 0], own = tones[k], after = tones[k < FT8_NN - 1 ? k + 1 : FT8_NN - 1];
    const float* pBefore = pulse + 2 * SPS;
    const float* pOwn = pulse + SPS;
    const float* pAfter = pulse;
    float c = (float)cos(ph), s = (float)sin(ph);
    const float scale = (float)(2.0 * M_PI * 6.25 / SAMPLE_RATE);
    double turned = 0.0;
    float* outR = pr + k * SPS;
    float* outI = pi + k * SPS;
    for (int u = 0; u < SPS; u++)
    {
      float d = scale * (before * pBefore[u] + own * pOwn[u] + after * pAfter[u]), d2 = d * d;
      outR[u] = c;
      outI[u] = -s;
      float dc = 1.0f - d2 * 0.5f, ds = d - d * d2 * (1.0f / 6.0f);
      float nc = c * dc - s * ds;
      s = c * ds + s * dc;
      c = nc;
      turned += d;
    }
    ph += turned;
  }
}

// The carrier e^(-j 2 pi f i / rate) for a block of samples from i0 (n of them), stepped in single precision from an exact start
static void subCarrier(double f, int i0, int n, float* cr, float* ci)
{
  double step = -2.0 * M_PI * f / SAMPLE_RATE;
  float c = (float)cos(step * i0), s = (float)sin(step * i0), dc = (float)cos(step), ds = (float)sin(step);
  for (int i = 0; i < n; i++)
  {
    cr[i] = c;
    ci[i] = s;
    float nc = c * dc - s * ds;
    s = c * ds + s * dc;
    c = nc;
  }
}

// The audio from start mixed down by the carrier at f (Hz) with the tone pattern: zr, zi (the carrier's conjugate, cr + j ci, kept for
// putting the signal back together), and each symbol's sum (sr, si)
static void subMix(int start, double f, const float* pr, const float* pi, int num_samples, float* zr, float* zi, float* cr, float* ci,
                   double* sr, double* si)
{
  float kc[256], ks[256];
  for (int k = 0; k < FT8_NN; k++)
  {
    float a = 0.0f, b = 0.0f;
    for (int i0 = k * SPS; i0 < (k + 1) * SPS; i0 += 256)
    {
      int len = (k + 1) * SPS - i0 < 256 ? (k + 1) * SPS - i0 : 256;
      subCarrier(f, i0, len, kc, ks);
      for (int u = 0; u < len; u++)
      {
        int i = i0 + u;
        // The whole conjugate carrier: (c + j s)(pr + j pi)
        float r = kc[u] * pr[i] - ks[u] * pi[i], q = kc[u] * pi[i] + ks[u] * pr[i];
        cr[i] = r;
        ci[i] = q;
        int n = start + i;
        float x = n >= 0 && n < num_samples ? g_input[n] : 0.0f;
        zr[i] = x * r;
        zi[i] = x * q;
        a += zr[i];
        b += zi[i];
      }
    }
    sr[k] = a;
    si[k] = b;
  }
}

// Each symbol's sum only (as subMix gives them), for setting the frequency and timing: nothing kept but the sums
static void subSums(int start, double f, const float* pr, const float* pi, int num_samples, double* sr, double* si)
{
  float kc[256], ks[256];
  for (int k = 0; k < FT8_NN; k++)
  {
    float a = 0.0f, b = 0.0f;
    for (int i0 = k * SPS; i0 < (k + 1) * SPS; i0 += 256)
    {
      int len = (k + 1) * SPS - i0 < 256 ? (k + 1) * SPS - i0 : 256;
      subCarrier(f, i0, len, kc, ks);
      for (int u = 0; u < len; u++)
      {
        int i = i0 + u, n = start + i;
        if (n < 0 || n >= num_samples) continue;
        float x = g_input[n];
        a += x * (kc[u] * pr[i] - ks[u] * pi[i]);
        b += x * (kc[u] * pi[i] + ks[u] * pr[i]);
      }
    }
    sr[k] = a;
    si[k] = b;
  }
}

static void subtractAudio(const uint8_t* tones, float f0, float t0, int num_samples)
{
  static float pulse[3 * SPS];
  static int pulseReady = 0;
  static float pr[FT8_NN * SPS], pi[FT8_NN * SPS], cr[FT8_NN * SPS], ci[FT8_NN * SPS];
  static float zr[FT8_NN * SPS], zi[FT8_NN * SPS];
  double sr[FT8_NN], si[FT8_NN];
  if (!pulseReady)
  {
    for (int i = 0; i < 3 * SPS; i++) pulse[i] = gfskPulse(((float)i - 1.5f * SPS) / SPS);
    pulseReady = 1;
  }
  const int total = FT8_NN * SPS;
  int start = (int)lroundf(t0 * SAMPLE_RATE);
  double f = f0;
  subPattern(tones, pulse, pr, pi);
  // Its frequency and timing set finer than the fine reading's (which, from tone powers, can be a couple of hertz and some tens of
  // milliseconds out), from the phase of each symbol along the rebuilt carrier: between two symbols on the same tone it steps by what is
  // left of the frequency; at a change of tone by one step it jumps by 2 pi 6.25 Hz times how far the rebuilt symbols are out
  for (int round = 0; round < SUB_ROUNDS; round++)
  {
    subSums(start, f, pr, pi, num_samples, sr, si);
    double qr = 0.0, qi = 0.0;
    for (int k = 1; k < FT8_NN; k++)
    {
      if (tones[k] != tones[k - 1]) continue;
      qr += sr[k] * sr[k - 1] + si[k] * si[k - 1];
      qi += si[k] * sr[k - 1] - sr[k] * si[k - 1];
    }
    if (qr != 0.0 || qi != 0.0) f += atan2(qi, qr) / (2.0 * M_PI * FT8_SYMBOL_PERIOD);
    subSums(start, f, pr, pi, num_samples, sr, si);
    double tr = 0.0, ti = 0.0;
    for (int k = 1; k < FT8_NN; k++)
    {
      int dTone = tones[k] - tones[k - 1];
      if (dTone != 1 && dTone != -1) continue;
      // (this) times the conjugate of (last), a step down turned to one up
      tr += sr[k] * sr[k - 1] + si[k] * si[k - 1];
      ti += dTone * (si[k] * sr[k - 1] - sr[k] * si[k - 1]);
    }
    // s: how far the real symbols come before the rebuilt ones (the real tone already up while the rebuilt one isn't puts the phase
    // ahead: a jump up at a step up)
    double tau = (tr != 0.0 || ti != 0.0) ? atan2(ti, tr) / (2.0 * M_PI * 6.25) : 0.0;
#ifdef FT8_STATS
    if (round == 0)
    {
      g_tauSum += tau;
      g_tauCount++;
    }
#endif
    start -= (int)lround(tau * SAMPLE_RATE);
  }
  subMix(start, f, pr, pi, num_samples, zr, zi, cr, ci, sr, si);
#ifdef FT8_STATS
  double before = 0.0;
  for (int k = 0; k < FT8_NN; k++) before += sr[k] * sr[k] + si[k] * si[k];
  // The strongest signal's phase symbol by symbol (degrees) against the rebuilt carrier, and its tones
  if (before > g_phaseBest)
  {
    g_phaseBest = before;
    char* o = g_phaseText;
    o += sprintf(o, "f %.2f -> %.2f t %.3f -> %.3f tones/phase:", f0, f, t0, (double)start / SAMPLE_RATE);
    for (int k = 0; k < FT8_NN; k++) o += sprintf(o, " %d/%.0f", tones[k], atan2(si[k], sr[k]) * 180.0 / M_PI);
  }
#endif
#if SUB_COSINE > 0
  // Averaged through a raised cosine SUB_COSINE samples either side (as WSJT-X does it): its weight 1/2 + cos(pi k / L) / 2 at k samples
  // off splits into running sums of z, of z cos(pi i / L) and of z sin(pi i / L); the weights' own sum the same way, for the ends
  {
    const int L = SUB_COSINE;
    // cos and sin of pi i / L for every sample of a signal, worked out once
    static float cosTable[FT8_NN * SPS], sinTable[FT8_NN * SPS];
    static int tableReady = 0;
    if (!tableReady)
    {
      for (int i = 0; i < total; i++)
      {
        cosTable[i] = (float)cos(M_PI * i / L);
        sinTable[i] = (float)sin(M_PI * i / L);
      }
      tableReady = 1;
    }
    double s0r = 0, s0i = 0, scr = 0, sci = 0, ssr = 0, ssi = 0, n0 = 0, nc = 0, ns = 0;
    int lo = 0, hi = 0;  // the sums cover [lo, hi)
    for (int i = 0; i < total; i++)
    {
      int wantLo = i - L < 0 ? 0 : i - L, wantHi = i + L + 1 > total ? total : i + L + 1;
      while (hi < wantHi)
      {
        double c = cosTable[hi], s = sinTable[hi];
        s0r += zr[hi]; s0i += zi[hi]; scr += zr[hi] * c; sci += zi[hi] * c; ssr += zr[hi] * s; ssi += zi[hi] * s;
        n0 += 1; nc += c; ns += s;
        hi++;
      }
      while (lo < wantLo)
      {
        double c = cosTable[lo], s = sinTable[lo];
        s0r -= zr[lo]; s0i -= zi[lo]; scr -= zr[lo] * c; sci -= zi[lo] * c; ssr -= zr[lo] * s; ssi -= zi[lo] * s;
        n0 -= 1; nc -= c; ns -= s;
        lo++;
      }
      int n = start + i;
      if (n < 0 || n >= num_samples) continue;
      double ci0 = cosTable[i], si0 = sinTable[i];
      double weight = 0.5 * n0 + 0.5 * (ci0 * nc + si0 * ns);
      if (weight <= 0.0) continue;
      double mr = (0.5 * s0r + 0.5 * (ci0 * scr + si0 * ssr)) / weight, mi = (0.5 * s0i + 0.5 * (ci0 * sci + si0 * ssi)) / weight;
      g_input[n] -= (float)(2.0 * (mr * cr[i] + mi * ci[i]));
    }
  }
#else
  // Averaged over SUB_WINDOW symbols (a running sum), and twice that, times the carrier, taken off: the carrier is the conjugate of
  // (cr + j ci), so the signal is 2 Re(m (cr - j ci))
  int half = (int)(SUB_WINDOW * SPS / 2);
  double ar = 0.0, ai = 0.0;
  int lo = 0, hi = 0;  // the sum covers [lo, hi)
  for (int i = 0; i < total; i++)
  {
    int wantLo = i - half < 0 ? 0 : i - half, wantHi = i + half + 1 > total ? total : i + half + 1;
    while (hi < wantHi) { ar += zr[hi]; ai += zi[hi]; hi++; }
    while (lo < wantLo) { ar -= zr[lo]; ai -= zi[lo]; lo++; }
    int n = start + i;
    if (n < 0 || n >= num_samples) continue;
    double mr = ar / (hi - lo), mi = ai / (hi - lo);
    g_input[n] -= (float)(2.0 * (mr * cr[i] + mi * ci[i]));
  }
#endif
#ifdef FT8_STATS
  // Test builds: the signal's power along its waveform before and after (g_subStats: before, after, count, in dB summed)
  subMix(start, f, pr, pi, num_samples, zr, zi, cr, ci, sr, si);
  double after = 0.0;
  for (int k = 0; k < FT8_NN; k++) after += sr[k] * sr[k] + si[k] * si[k];
  g_subStats[0] += 10.0 * log10(before + 1e-30);
  g_subStats[1] += 10.0 * log10(after + 1e-30);
  g_subStats[2] += 1.0;
#endif
}

// A decoded signal's SNR as WSJT-X shows it (its published definition: the signal's power over the noise's in 2500 Hz): its tones'
// average power over the cells' noise (each cell 1/symbol period wide, 6.25 Hz), less 10 log10(2500 / 6.25); SNR_OFFSET what was left
// between this and WSJT-X's own figures on the same signals
#ifndef SNR_OFFSET
#define SNR_OFFSET -5.0f // on two recordings: 5 dB under, at every level, within 2 dB of WSJT-X's (one standard deviation)
#endif
// (count tones: FT8's 79, FT4's 105; a cell is one tone step wide, 1 / the symbol period: FT8 6.25 Hz, FT4 20.8 Hz)
static float signalSnr(const ftx_waterfall_t* wf, const ftx_candidate_t* cand, const uint8_t* tones, int count, float noise)
{
  int t0 = cand->time_offset * wf->time_osr + cand->time_sub;
  int f0 = cand->freq_offset * wf->freq_osr + cand->freq_sub;
  double sum = 0.0;
  int n = 0, index;
  for (int k = 0; k < count; k++)
  {
    float p = cellPower(wf, t0 + k * wf->time_osr, f0 + tones[k] * wf->freq_osr, &index);
    if (p < 0.0f) continue;
    sum += p;
    n++;
  }
  float signal = n ? (float)(sum / n) - noise : 0.0f;
  if (signal < noise * 0.001f) signal = noise * 0.001f;
  float snr = 10.0f * log10f(signal / noise) - 10.0f * log10f(2500.0f * g_mon.symbol_period) + SNR_OFFSET;
  return snr < -30.0f ? -30.0f : snr;
}

int ft8_init(float f_min, float f_max)
{
  g_fMin = f_min;
  g_fMax = f_max;
  monitor_config_t cfg = { .f_min = f_min, .f_max = f_max, .sample_rate = SAMPLE_RATE, .time_osr = 2, .freq_osr = 2, .protocol = g_ft4 ? FTX_PROTOCOL_FT4 : FTX_PROTOCOL_FT8 };
  if (g_ready) monitor_free(&g_mon);
  monitor_init(&g_mon, &cfg);
  memset(g_calls, 0, sizeof(g_calls));
  apMessage(0, "CQ");
  g_ready = 1;
  return 1;
}

// FT4 (the viewer's FT4 mode) or FT8: ft8_lib's monitor set up again for it. FT4 is decoded the Normal way only (ft8_lib as it comes:
// the Deep reading here is written for FT8's tones and timing), its period 7.5 s
int ft8_set_ft4(int on)
{
  on = on ? 1 : 0;
  if (on != g_ft4)
  {
    g_ft4 = on;
    if (g_ready) ft8_init(g_fMin, g_fMax);
  }
  g_plain = g_plainSet || g_ft4;
  return 1;
}

// The messages already given this period (an early decode's, for the one after it with more of the period: more = 1), so they aren't
// given again
static ftx_message_t g_given[MAX_DECODED];
static int g_givenCount = 0;

static bool alreadyGiven(const ftx_message_t* message)
{
  for (int i = 0; i < g_givenCount; i++)
  {
    if (g_given[i].hash == message->hash && memcmp(g_given[i].payload, message->payload, sizeof(message->payload)) == 0) return true;
  }
  return false;
}

// The frequency right-clicked in the viewer (Hz of audio, 0 none): after the usual passes, the waterfall is searched once more there only,
// harder (more candidates, a lower sync score); what is found there is taken only as anything else is (decodeCandidate's limits). There:
// the signals whose middle is within FOCUS_HALF_HZ of it (the viewer's focus, 50 Hz wide)
#ifndef FOCUS_CANDIDATES
#define FOCUS_CANDIDATES 600
#endif
#ifndef FOCUS_MIN_SCORE
#define FOCUS_MIN_SCORE 5
#endif
#ifndef FOCUS_HALF_HZ
#define FOCUS_HALF_HZ 25.0f
#endif
static float g_focusHz = 0.0f;

void ft8_set_focus(float hz) { g_focusHz = hz > 0.0f ? hz : 0.0f; }

// ---- A period's decode, in steps (so its candidates can be shared out between workers: ft8Worker.js)
//
//   ft8_begin(n, more):       n samples of a period in ft8_input() (more: as ft8_decode); the waterfall and spectrum made from them;
//                             the number of passes planned (the usual ones, and the focus's)
//   ft8_pass_candidates(p):   pass p's candidates found (the same in every worker, from the same audio); how many
//   ft8_try(from, step):      candidates from, from + step, ... tried; each decoded one a record (REC_FIELDS floats) in ft8_records();
//                             how many
//   ft8_accept(recs, n):      (one worker: the coordinator) records from all, in candidate order: each message new to this decode taken
//                             (its line out, unless an early decode gave it), and kept for taking out (ft8_subtract_records()); how many
//   ft8_subtract(recs, n):    (every worker) those signals taken out of the audio, the waterfall and spectrum made again
//   ft8_given():              the lines given so far this decode
// ft8_decode does all of them in one.
#define REC_FIELDS 22
#define REC_HOW 10
#define REC_DIFFER 11
#define REC_FINE 12
#define REC_HZ 13
#define REC_T 14
#define REC_CAND 15  // time_offset, time_sub, freq_offset, freq_sub, score
#define REC_INDEX 20
#define REC_HASH 21
#define CANDIDATES_MAX (MAX_CANDIDATES > FOCUS_CANDIDATES ? MAX_CANDIDATES : FOCUS_CANDIDATES)

static int g_numSamples = 0;
static ftx_candidate_t g_cands[CANDIDATES_MAX];
static int g_numCands = 0;
static float g_heardNoise = 0.0f;
static float g_recs[CANDIDATES_MAX * REC_FIELDS];
static float g_subRecs[MAX_DECODED * REC_FIELDS];
static ftx_message_t g_taken[MAX_DECODED];
static int g_takenCount = 0, g_givenLines = 0;
static char* g_out = g_output;

float* ft8_records(void) { return g_recs; }

// ---- The time a decode may take: candidates are tried strongest first (ft8_pass_candidates sorts them), and when the time is up the
// rest of them are left (the weakest)
static double g_deadline = 0.0;

static double nowMs(void)
{
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

// ms from now this decode (or this share of a pass) may take; 0 or less: no limit
void ft8_set_budget(float ms) { g_deadline = ms > 0.0f ? nowMs() + ms : 0.0; }

int ft8_time_up(void) { return g_deadline > 0.0 && nowMs() > g_deadline; }

// Strongest first (then by place, so every worker has the same order)
static int candidateOrder(const void* a, const void* b)
{
  const ftx_candidate_t* x = (const ftx_candidate_t*)a;
  const ftx_candidate_t* y = (const ftx_candidate_t*)b;
  if (x->score != y->score) return y->score - x->score;
  if (x->time_offset != y->time_offset) return x->time_offset - y->time_offset;
  if (x->freq_offset != y->freq_offset) return x->freq_offset - y->freq_offset;
  if (x->time_sub != y->time_sub) return x->time_sub - y->time_sub;
  return x->freq_sub - y->freq_sub;
}

// ---- Copies of a repeated message added together (c)
//
// Stations often send the very same message again two periods later (a CQ, or calling a station until it answers). A candidate the fine
// reading fails on is remembered (its bit likelihoods, frequency and time in the period); a failed candidate two periods later at the
// same place (COMBINE_HZ, COMBINE_S) has its likelihoods added to the earlier copy's (and to one four periods before, if there is one),
// and that is decoded: the same message twice is up to twice as sure. Each worker remembers every worker's failures (ft8_remember)
#define FAIL_FIELDS (3 + FTX_LDPC_N)  // hz, t (s into the period), sync, the likelihoods
#define MEMORY_MAX 4000
#ifndef COMBINE_HZ
#define COMBINE_HZ 2.0f
#endif
#ifndef COMBINE_OWN_MAX
#define COMBINE_OWN_MAX 62  // measured: real combined decodes 36 to 55 bits from the copy alone; a changed message's at 71
#endif
#ifndef COMBINE_OWN_MAX_HARD
#define COMBINE_OWN_MAX_HARD 50  // measured on five recordings: those found by OSD real to 49 bits, a false one at 55
#endif
#ifndef COMBINE_S
#define COMBINE_S 0.08f
#endif
static float g_fails[CANDIDATES_MAX * FAIL_FIELDS];
static int g_failCount = 0;
static struct
{
  int period;
  float hz, t;
  float llr[FTX_LDPC_N];
} g_memory[MEMORY_MAX];
static int g_memoryCount = 0;

float* ft8_failures(void) { return g_fails; }
int ft8_failure_count(void) { return g_failCount; }

// Failed readings (fails, n of them, as ft8_failures gives them) of the period being decoded remembered, in place of any remembered for
// it before (an early decode's); those over 4 periods old let go
int ft8_remember(const float* fails, int n)
{
  int kept = 0;
  for (int i = 0; i < g_memoryCount; i++)
  {
    if (g_memory[i].period != g_period && g_memory[i].period >= g_period - 4) g_memory[kept++] = g_memory[i];
  }
  g_memoryCount = kept;
  for (int i = 0; i < n && g_memoryCount < MEMORY_MAX; i++)
  {
    const float* r = &fails[i * FAIL_FIELDS];
    g_memory[g_memoryCount].period = g_period;
    g_memory[g_memoryCount].hz = r[0];
    g_memory[g_memoryCount].t = r[1];
    memcpy(g_memory[g_memoryCount].llr, r + 3, sizeof(float) * FTX_LDPC_N);
    g_memoryCount++;
  }
  return g_memoryCount;
}

// The remembered reading from period p nearest hz, t (within COMBINE_HZ and COMBINE_S), or -1
static int remembered(int p, float hz, float t)
{
  int best = -1;
  float bestOff = 1e9f;
  for (int i = 0; i < g_memoryCount; i++)
  {
    if (g_memory[i].period != p) continue;
    float dh = fabsf(g_memory[i].hz - hz), dt = fabsf(g_memory[i].t - t);
    if (dh > COMBINE_HZ || dt > COMBINE_S) continue;
    float off = dh / COMBINE_HZ + dt / COMBINE_S;
    if (off < bestOff)
    {
      bestOff = off;
      best = i;
    }
  }
  return best;
}

// A failed fine reading (llr, at hz, t) added to its copies two (and four) periods before and decoded; true if that decoded it
static bool combineDecodeCopies(const float* llr, float hz, float t, ftx_message_t* message, int* how, int* differ);

static bool combineDecode(const float* llr, float hz, float t, ftx_message_t* message, int* how, int* differ)
{
  g_combining = 1;
  bool ok = combineDecodeCopies(llr, hz, t, message, how, differ);
  g_combining = 0;
  if (!ok) return false;
  // The message found must be this copy's too, not only the earlier one's (a station that changed its message between them would have
  // the earlier message found in the sum): the codeword no more than COMBINE_OWN_MAX of its bits from this copy as heard
  if (!g_generatorReady) generatorRows();
  uint8_t a91[FTX_LDPC_K_BYTES];
  ftx_add_crc(message->payload, a91);
  bits174_t cw, heard;
  memset(&cw, 0, sizeof(cw));
  memset(&heard, 0, sizeof(heard));
  for (int n = 0; n < FTX_LDPC_K; n++)
  {
    if (a91[n >> 3] & (0x80u >> (n & 7))) bitsXor(&cw, &g_generator[n]);
  }
  float sureness[FTX_LDPC_N];
  for (int n = 0; n < FTX_LDPC_N; n++)
  {
    sureness[n] = fabsf(llr[n]);
    if (llr[n] > 0.0f) bitFlip(&heard, n);
  }
  int own;
  codewordCost(&cw, &heard, sureness, &own);
#ifdef FT8_STATS
  // Test builds: told as the distance (a combined decode's own one isn't otherwise shown)
  *differ = own;
#endif
  // Found by belief propagation, COMBINE_OWN_MAX; by OSD or a guess (the less sure ways), COMBINE_OWN_MAX_HARD
  return own < (*how == 0 ? COMBINE_OWN_MAX : COMBINE_OWN_MAX_HARD);
}

static bool combineDecodeCopies(const float* llr, float hz, float t, ftx_message_t* message, int* how, int* differ)
{
  int a = remembered(g_period - 2, hz, t);
  if (a < 0) return false;
  float sum[FTX_LDPC_N];
  for (int i = 0; i < FTX_LDPC_N; i++) sum[i] = llr[i] + g_memory[a].llr[i];
  normalizeLlr(sum);
  if (decodeLlr(sum, hz, message, how, differ)) return true;
  int b = remembered(g_period - 4, g_memory[a].hz, g_memory[a].t);
  if (b < 0) return false;
  for (int i = 0; i < FTX_LDPC_N; i++) sum[i] = llr[i] + g_memory[a].llr[i] + g_memory[b].llr[i];
  normalizeLlr(sum);
  return decodeLlr(sum, hz, message, how, differ);
}
float* ft8_subtract_records(void) { return g_subRecs; }
int ft8_given(void) { return g_givenLines; }

static void ft8Waterfall(void)
{
  monitor_reset(&g_mon);
  for (int pos = 0; pos + g_mon.block_size <= g_numSamples; pos += g_mon.block_size) monitor_process(&g_mon, g_input + pos);
  // The period's spectrum, for reading a candidate finely when ft8_lib's reading of it fails (and placing a signal to take it out); not
  // for Normal, which does neither
  if (!g_plain) fineSpectrum(g_numSamples);
}

// The usual passes (Normal: one)
static int usualPasses(void)
{
  return g_plain ? 1 : g_passes;
}

int ft8_begin(int num_samples, int more)
{
  if (!g_ready) return -1;
  if (!more) g_givenCount = 0;
  g_numSamples = num_samples > SLOT_SAMPLES ? SLOT_SAMPLES : num_samples;
  ft8Waterfall();
  // The noise as heard, before any signal is taken out (for each one's SNR)
  g_heardNoise = waterfallNoise(&g_mon.wf);
  g_takenCount = 0;
  g_givenLines = 0;
  g_failCount = 0;
  g_out = g_output;
  g_out[0] = 0;
  // The passes, then the focus's
  return usualPasses() + (g_focusHz > 0.0f ? 1 : 0);
}

static float candidateHz(const ftx_candidate_t* cand)
{
  return (g_mon.min_bin + cand->freq_offset + (float)cand->freq_sub / g_mon.wf.freq_osr) / g_mon.symbol_period;
}

static float candidateT(const ftx_candidate_t* cand)
{
  return (cand->time_offset + (float)cand->time_sub / g_mon.wf.time_osr) * g_mon.symbol_period;
}

// ---- Finding candidates in a spectrogram of quarter-symbol steps (the way WSJT-X finds them: its approach read in its source, written
// here for this; with thanks to Joe Taylor, K1JT, and the WSJT development team)
//
// A power spectrum every quarter symbol (480 samples) of a symbol's audio (1920 samples, 3.125 Hz bins). At each bin (taken as tone 0)
// and each start time 2.5 s either side of the usual one, in 40 ms steps: the Costas tones' power over the average of the other six tones
// in their symbols, over all three Costas arrays or the last two (the first may not have been heard); each bin's best within 0.4 s of the
// usual start, and its best anywhere, over the band's typical (40th percentile) best; those over SYNC_MIN kept, the strongest of any within
// 4 Hz and 40 ms of each other, at most CANDIDATES8 of them
#define SPEC_NFFT 3840
#define SPEC_STEP 480
#define SPEC_STEPS (SLOT_SAMPLES / SPEC_STEP)
#define SPEC_BINS (SPEC_NFFT / 2)
#ifndef SYNC_MIN
#define SYNC_MIN 1.6f  // (1.3 found 2 more in two recordings, at 40% more time)
#endif
#ifndef CANDIDATES8
#define CANDIDATES8 300
#endif
#ifndef EXTRA_LIB
#define EXTRA_LIB 0  // (ft8_lib's reading of these found 1 more in two recordings, at half again the time)
#endif
#ifndef CAND8_PASSES
#define CAND8_PASSES 3  // the passes these are searched in (from the first)
#endif
#ifndef CAND_MODE
#define CAND_MODE 2  // 0 ft8_lib's candidates, 1 these, 2 both (measured on four recordings: both decoded 12 to 29 more than ft8_lib's alone)
#endif
static float g_spec[SPEC_STEPS][SPEC_BINS / 2];
static kiss_fftr_cfg g_specFft = 0;

static int candidates8(ftx_candidate_t* out, int room)
{
  static float frame[SPEC_NFFT];
  static kiss_fft_cpx spectrum[SPEC_NFFT / 2 + 1];
  if (!g_specFft) g_specFft = kiss_fftr_alloc(SPEC_NFFT, 0, 0, 0);
  int binLo = (int)(g_mon.min_bin * 2), binHi = (int)(g_mon.max_bin * 2);
  if (binHi > SPEC_BINS / 2 - 16) binHi = SPEC_BINS / 2 - 16;
  int steps = 0;
  for (int m = 0; m < SPEC_STEPS; m++)
  {
    int at = m * SPEC_STEP;
    if (at + SPS > g_numSamples) break;
    memcpy(frame, g_input + at, SPS * sizeof(float));
    memset(frame + SPS, 0, (SPEC_NFFT - SPS) * sizeof(float));
    kiss_fftr(g_specFft, frame, spectrum);
    for (int i = binLo; i < binHi + 16; i++) g_spec[m][i] = spectrum[i].r * spectrum[i].r + spectrum[i].i * spectrum[i].i;
    steps++;
  }
  // Each bin's best within 0.4 s of the usual start (lag 0: 0.5 s, step 12) and anywhere
  static float localBest[SPEC_BINS / 2], globalBest[SPEC_BINS / 2];
  static int localLag[SPEC_BINS / 2], globalLag[SPEC_BINS / 2];
  const int zero = 12;
  for (int i = binLo; i < binHi; i++)
  {
    localBest[i] = globalBest[i] = 0.0f;
    localLag[i] = globalLag[i] = 0;
    for (int j = -62; j <= 62; j++)
    {
      float t[3] = { 0 }, t0[3] = { 0 };
      bool have[3] = { false, false, false };
      for (int b = 0; b < 3; b++)
      {
        for (int k = 0; k < 7; k++)
        {
          int m = zero + j + 4 * (k + 36 * b);
          if (m < 0 || m >= steps) continue;
          have[b] = true;
          t[b] += g_spec[m][i + 2 * kFT8_Costas_pattern[k]];
          for (int tone = 0; tone < 7; tone++) t0[b] += g_spec[m][i + 2 * tone];
        }
      }
      float abc = 0.0f, bc = 0.0f;
      float ta = t[0] + t[1] + t[2], t0a = t0[0] + t0[1] + t0[2];
      if (t0a - ta > 0.0f) abc = ta / ((t0a - ta) / 6.0f);
      float tb = t[1] + t[2], t0b = t0[1] + t0[2];
      if (have[1] && have[2] && t0b - tb > 0.0f) bc = tb / ((t0b - tb) / 6.0f);
      float sync = abc > bc ? abc : bc;
      if (sync > globalBest[i])
      {
        globalBest[i] = sync;
        globalLag[i] = j;
      }
      if (j >= -10 && j <= 10 && sync > localBest[i])
      {
        localBest[i] = sync;
        localLag[i] = j;
      }
    }
  }
  // Over the band's typical best (40th percentile)
  int nb = binHi - binLo;
  if (nb <= 0) return 0;
  static float sorted[SPEC_BINS / 2];
  memcpy(sorted, localBest + binLo, nb * sizeof(float));
  qsort(sorted, nb, sizeof(float), floatAscending);
  float baseLocal = sorted[(int)(0.4f * nb)] > 0.0f ? sorted[(int)(0.4f * nb)] : 1.0f;
  memcpy(sorted, globalBest + binLo, nb * sizeof(float));
  qsort(sorted, nb, sizeof(float), floatAscending);
  float baseGlobal = sorted[(int)(0.4f * nb)] > 0.0f ? sorted[(int)(0.4f * nb)] : 1.0f;
  // Candidates (bin, lag, score)
  static float cs[2 * SPEC_BINS / 2];
  static int cb[2 * SPEC_BINS / 2], cl[2 * SPEC_BINS / 2];
  int n = 0;
  for (int i = binLo; i < binHi; i++)
  {
    float a = localBest[i] / baseLocal, g = globalBest[i] / baseGlobal;
    if (a >= SYNC_MIN) { cs[n] = a; cb[n] = i; cl[n] = localLag[i]; n++; }
    if (g >= SYNC_MIN && globalLag[i] != localLag[i]) { cs[n] = g; cb[n] = i; cl[n] = globalLag[i]; n++; }
  }
  // The strongest of any within 4 Hz and 40 ms
  for (int a = 0; a < n; a++)
  {
    for (int b = 0; b < n; b++)
    {
      if (a == b || cs[a] <= 0.0f || cs[b] <= 0.0f) continue;
      if (abs(cb[a] - cb[b]) * 3.125f <= 4.0f && abs(cl[a] - cl[b]) <= 1 && cs[b] < cs[a]) cs[b] = 0.0f;
    }
  }
  // Out as ft8_lib's candidates (half symbols and half tone steps), strongest first
  int count = 0;
  while (count < room)
  {
    int best = -1;
    for (int a = 0; a < n; a++) if (cs[a] > 0.0f && (best < 0 || cs[a] > cs[best])) best = a;
    if (best < 0) break;
    ftx_candidate_t c = { 0 };
    int fpos = cb[best] - g_mon.min_bin * 2;
    if (fpos >= 0)
    {
      c.freq_offset = fpos / 2;
      c.freq_sub = fpos % 2;
      int tpos = (int)lroundf((zero + cl[best]) * 0.04f / 0.08f);
      c.time_offset = (int16_t)floorf(tpos / 2.0f);
      c.time_sub = tpos - c.time_offset * 2;
      c.score = (int16_t)(cs[best] * 10.0f);
      out[count++] = c;
    }
    cs[best] = 0.0f;
  }
  return count;
}

int ft8_pass_candidates(int pass)
{
  ftx_waterfall_t* wf = &g_mon.wf;
  if (pass == usualPasses())
  {
    // The focus's: only those whose middle is in it (a candidate's place is its lowest tone; FT8's 8 tones and FT4's 4, a tone step apart)
    int n = ftx_find_candidates(wf, FOCUS_CANDIDATES, g_cands, FOCUS_MIN_SCORE), kept = 0;
    float half = (g_ft4 ? 4.0f : 8.0f) / g_mon.symbol_period / 2.0f;
    for (int i = 0; i < n; i++)
    {
      float mid = candidateHz(&g_cands[i]) + half;
      if (mid >= g_focusHz - FOCUS_HALF_HZ && mid <= g_focusHz + FOCUS_HALF_HZ) g_cands[kept++] = g_cands[i];
    }
    g_numCands = kept;
  }
  else if (g_plain) g_numCands = ftx_find_candidates(wf, MAX_CANDIDATES, g_cands, PLAIN_MIN_SCORE);
  else
  {
#if CAND_MODE == 1
    g_numCands = candidates8(g_cands, CANDIDATES_MAX);
#else
    g_numCands = ftx_find_candidates(wf, MAX_CANDIDATES, g_cands, MIN_SCORE);
#if CAND_MODE == 2
    // And these, those not at a place ft8_lib's already has (the same half symbol and half tone step, or next to it)
    static ftx_candidate_t extra[CANDIDATES_MAX];
    int n = CAND8_PASSES > pass ? candidates8(extra, CANDIDATES_MAX) : 0;
    for (int k = 0; k < n && g_numCands < CANDIDATES_MAX; k++)
    {
      int ek = (extra[k].time_offset * 2 + extra[k].time_sub), ef = (extra[k].freq_offset * 2 + extra[k].freq_sub);
      bool near = false;
      for (int i = 0; i < g_numCands && !near; i++)
      {
        int ti = g_cands[i].time_offset * 2 + g_cands[i].time_sub, fi = g_cands[i].freq_offset * 2 + g_cands[i].freq_sub;
        near = abs(ti - ek) <= 1 && abs(fi - ef) <= 1;
      }
      if (!near)
      {
        // Below ft8_lib's own scores, so they come after them
        extra[k].score = -1000 + extra[k].score;
        g_cands[g_numCands++] = extra[k];
      }
    }
#endif
#endif
  }
  qsort(g_cands, g_numCands, sizeof(ftx_candidate_t), candidateOrder);
  return g_numCands;
}

int ft8_try(int from, int step)
{
  ftx_waterfall_t* wf = &g_mon.wf;
  int n = 0;
  for (int i = from; i < g_numCands; i += step)
  {
    if (ft8_time_up()) break;
    const ftx_candidate_t* cand = &g_cands[i];
    ftx_message_t message;
    int how = 0, differ = 0, fine = 0;
    float fineHz = 0.0f, fineT = 0.0f, sync = 0.0f;
    bool ok;
    if (g_plain)
    {
      // Normal: ft8_lib's own reading, and nothing more (where it is as ft8_lib places it, for what ft8_note keeps)
      ftx_decode_status_t status;
      ok = ftx_decode_candidate(wf, cand, LDPC_ITERATIONS, &message, &status);
      fineHz = candidateHz(cand);
      fineT = candidateT(cand);
    }
    else
    {
      // ft8_lib's reading first (not for a candidate only the spectrogram search found: EXTRA_LIB 0; its place is the fine reading's to set)
      g_depth = LIB_DEPTH;
      ok = (EXTRA_LIB || cand->score > -500) && decodeCandidate(wf, cand, &message, &how, &differ);
      g_depth = 2;
    }
    if (!ok && !g_plain)
    {
      // Read finely about where ft8_lib put it (its time is to half a symbol, its frequency to half a tone step)
      float llr[FTX_LDPC_N];
      fineLikelihoods(candidateHz(cand), candidateT(cand), FINE_RANGE, llr, &sync, &fineHz, &fineT);
      float single[FTX_LDPC_N];
      memcpy(single, llr, sizeof(single));
      ok = sync >= FINE_MIN_SYNC && decodeLlr(llr, candidateHz(cand), &message, &how, &differ);
#ifndef NO_NSYM
      // Then 2 symbols at a time, and 3
      for (int nsym = 2; nsym <= 3 && !ok && sync >= FINE_MIN_SYNC; nsym++)
      {
        fineMultiLikelihoods(nsym, llr);
        g_depth = MULTI_DEPTH;
        ok = decodeLlr(llr, candidateHz(cand), &message, &how, &differ);
        g_depth = 2;
      }
#ifdef RATIO_READING
      // (A test option: it found one more decode in four recordings)
      if (!ok && sync >= FINE_MIN_SYNC)
      {
        fineRatioLikelihoods(llr);
        g_depth = MULTI_DEPTH;
        ok = decodeLlr(llr, candidateHz(cand), &message, &how, &differ);
        g_depth = 2;
      }
#endif
#endif
      fine = ok;
#ifndef NO_COMBINE
      if (!ok && sync >= FINE_MIN_SYNC)
      {
        ok = combineDecode(single, fineHz, fineT, &message, &how, &differ);
        // Combined: told apart (fine 2)
        fine = ok ? 2 : 0;
        if (!ok && g_failCount < CANDIDATES_MAX)
        {
          float* r = &g_fails[g_failCount * FAIL_FIELDS];
          r[0] = fineHz;
          r[1] = fineT;
          r[2] = sync;
          memcpy(r + 3, single, sizeof(single));
          g_failCount++;
        }
      }
#endif
#ifdef FT8_STATS
      // Test builds: the sync of fine readings tried, by how they went (20 bins of 0.05)
      int bin = (int)(sync * 20.0f);
      g_fineSync[ok ? 1 : 0][bin < 0 ? 0 : bin > 19 ? 19 : bin]++;
#endif
    }
    if (!ok) continue;
    // Found the harder ways, only a standard message is taken (every one measured was; the false ones were often free text or odd types),
    // and not one with a /R or /P call not heard lately
    if ((how > 0 || fine == 2) && ftx_message_get_type(&message) != FTX_MESSAGE_TYPE_STANDARD) continue;
    if ((how > 0 || fine == 2) && (unlikelySuffix(&message) || !messagePlausible(&message))) continue;
    // Already found at an earlier candidate of this share: not again (the coordinator keeps each message once over all shares)
    bool again = false;
    for (int k = 0; k < n && !again; k++)
    {
      again = g_recs[k * REC_FIELDS + REC_HASH] == message.hash;
      for (int b = 0; b < 10 && again; b++) again = g_recs[k * REC_FIELDS + b] == message.payload[b];
    }
    if (again) continue;
    // Where it is to the fine reading's precision, for taking it out of the audio (read now, if ft8_lib's reading decoded it; Normal takes
    // nothing out)
    if (!fine && !g_plain)
    {
      float llr[FTX_LDPC_N];
      fineLikelihoods(candidateHz(cand), candidateT(cand), FINE_RANGE, llr, &sync, &fineHz, &fineT);
    }
    float* r = &g_recs[n * REC_FIELDS];
    for (int b = 0; b < 10; b++) r[b] = message.payload[b];
    r[REC_HOW] = how;
    r[REC_DIFFER] = differ;
    r[REC_FINE] = fine;
    r[REC_HZ] = fineHz;
    r[REC_T] = fineT;
    r[REC_CAND] = cand->time_offset;
    r[REC_CAND + 1] = cand->time_sub;
    r[REC_CAND + 2] = cand->freq_offset;
    r[REC_CAND + 3] = cand->freq_sub;
    r[REC_CAND + 4] = cand->score;
    r[REC_INDEX] = i;
    r[REC_HASH] = message.hash;
    n++;
  }
  return n;
}

int ft8_accept(const float* recs, int n)
{
  ftx_waterfall_t* wf = &g_mon.wf;
  int found = 0;
  for (int i = 0; i < n && g_takenCount < MAX_DECODED; i++)
  {
    const float* r = &recs[i * REC_FIELDS];
    ftx_message_t message;
    for (int b = 0; b < 10; b++) message.payload[b] = (uint8_t)r[b];
    message.hash = (uint16_t)r[REC_HASH];
    // Each message once in this decode (it is often found at more than one candidate, and again in a later pass)
    bool taken = false;
    for (int k = 0; k < g_takenCount && !taken; k++) taken = g_taken[k].hash == message.hash && memcmp(g_taken[k].payload, message.payload, 10) == 0;
    if (taken) continue;
    g_taken[g_takenCount++] = message;
    memcpy(&g_subRecs[found * REC_FIELDS], r, REC_FIELDS * sizeof(float));
    found++;
    // Given by the early decode: taken out of the audio again, but not given twice
    if (alreadyGiven(&message) || g_givenCount >= MAX_DECODED) continue;
    g_given[g_givenCount++] = message;
    char text[FTX_MAX_MESSAGE_LENGTH];
    ftx_message_offsets_t offsets;
    if (ftx_message_decode(&message, &g_hash_if, text, &offsets) != FTX_MESSAGE_RC_OK) continue;
    ftx_candidate_t cand = { 0 };
    cand.time_offset = (int16_t)r[REC_CAND];
    cand.time_sub = (uint8_t)r[REC_CAND + 1];
    cand.freq_offset = (int16_t)r[REC_CAND + 2];
    cand.freq_sub = (uint8_t)r[REC_CAND + 3];
    cand.score = (int16_t)r[REC_CAND + 4];
    uint8_t tones[FT4_NN > FT8_NN ? FT4_NN : FT8_NN];
    if (g_ft4) ft4_encode(message.payload, tones);
    else ft8_encode(message.payload, tones);
    float snr = signalSnr(wf, &cand, tones, g_ft4 ? FT4_NN : FT8_NN, g_heardNoise);
    static const char* tags[] = { "", "o", "a1", "a2", "a3", "a4" };
    int how = (int)r[REC_HOW];
#ifdef FT8_STATS
    // Test builds: a combined decode told with how it was found too (cbp, co, ca3 ...)
    static char combinedTag[8];
    snprintf(combinedTag, sizeof(combinedTag), "c%s", how ? tags[how] : "bp");
    const char* tag = r[REC_FINE] == 2 ? combinedTag : tags[how];
#else
    const char* tag = r[REC_FINE] == 2 ? "c" : tags[how];
#endif
#ifdef FT8_STATS
    g_out += snprintf(g_out, 120, "%.0f\t%.1f\t%.0f\t%s\t%s%s\t%d\t%d\n", snr, candidateT(&cand), candidateHz(&cand), text, r[REC_FINE] == 1 ? "f" : "", tag, (int)r[REC_DIFFER], cand.score);
#else
    g_out += snprintf(g_out, 100, "%.0f\t%.1f\t%.0f\t%s\t%s\n", snr, candidateT(&cand), candidateHz(&cand), text, tag);
#endif
    g_givenLines++;
  }
  return found;
}

int ft8_subtract(const float* recs, int n)
{
  // Out of the audio, and the waterfall and the spectrum made again from what is left (not in Normal: its focus pass searches the audio
  // as heard, what it finds again already taken)
  if (g_plain) return n;
  for (int i = 0; i < n; i++)
  {
    const float* r = &recs[i * REC_FIELDS];
    uint8_t payload[10], tones[FT8_NN];
    for (int b = 0; b < 10; b++) payload[b] = (uint8_t)r[b];
    ft8_encode(payload, tones);
    subtractAudio(tones, r[REC_HZ], r[REC_T], g_numSamples);
  }
  ft8Waterfall();
  return n;
}

// The passes after the first one: a pass that found nothing new means no later usual pass would find more (the focus's still runs).
// The pass to run after pass (given what it found and how many are planned), or -1 when done
int ft8_next_pass(int pass, int found, int passes)
{
  int usual = usualPasses();
  if (g_takenCount >= MAX_DECODED || pass == passes - 1) return -1;
  if (found == 0) return passes > usual && pass < usual ? usual : -1;
  return pass + 1;
}

int ft8_decode(int num_samples, int more)
{
  int passes = ft8_begin(num_samples, more);
  if (passes < 0) return -1;
  for (int pass = 0; pass >= 0;)
  {
    ft8_pass_candidates(pass);
    int found = ft8_accept(g_recs, ft8_try(0, 1));
    ft8_note(g_subRecs, found);
    int next = ft8_time_up() ? -1 : ft8_next_pass(pass, found, passes);
    // Taken out before the next pass (none after the last; the focus's pass after an empty one needs none either)
    if (next >= 0 && found > 0) ft8_subtract(g_subRecs, found);
    pass = next;
  }
  ft8_remember(g_fails, g_failCount);
  return g_givenLines;
}
