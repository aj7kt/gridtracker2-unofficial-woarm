// Recordings downloaded (tools/make_test_signals.js), kept in resources/test-signals/ as they are: real signals, as other programs sent
// them. Each converted to a mono 16 bit WAV at 12000 Hz (peak 0.7) from its original; only public domain or freely licensed files
// (sources and licenses in resources/test-signals/README.md)

const DOWNLOADED = [
  {
    file: "olivia-16-500-wikimedia.wav",
    modes: ["olivia"],
    signals: 1,
    rsid: false,
    sync: null,
    description: "Olivia 16/500 centred on 1500 Hz, sent with MixW: \"Welcome to Wikipedia, the free encyclopedia that anyone can edit.\" " +
      "By Geryones (English Wikipedia), public domain",
    source: "https://commons.wikimedia.org/wiki/File:OLIVIA_500_16_sample.ogg"
  },
  {
    file: "olivia-32-1000-wikimedia.wav",
    modes: ["olivia"],
    signals: 1,
    rsid: false,
    sync: null,
    description: "Olivia 32/1000 centred on 1000 Hz, sent with MixW: \"Welcome to Wikipedia, the free encyclopedia that anyone can edit.\" " +
      "By Geryones (English Wikipedia), public domain",
    source: "https://commons.wikimedia.org/wiki/File:OLIVIA_1000_32_sample.ogg"
  }
];

// Listed only: no samples, so the files are kept as they are
function build()
{
  return DOWNLOADED.map((d) => Object.assign({}, d));
}

module.exports = { build };
