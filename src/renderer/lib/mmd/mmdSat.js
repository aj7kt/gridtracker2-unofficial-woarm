// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Multi-Mode Decoder's Sat Data mode (the Mode menu): satellite telemetry frames from the input's own samples (the worklet's raw
// stream) by satWorker.js: FUNcube's BPSK 1200, GomSpace AX.100 (Mode 5) over FSK, AMSAT-EA's GENESIS FSK (HADES). Here each frame is a
// line on top of the list: UTC, what it is and its baud, the satellite BirdWatch follows (heard through it), and what the frame says (a
// summary; its bytes as hex in the tooltip). With Follow BirdWatch, the transmitter followed picks which decoders listen. Each frame's
// bytes are kept as decoded (SAT.lines), so they could be passed on to SatNOGS later.
// SSDV pictures (a GENESIS satellite's SSDV packets, ssdv.js): above the list, newest first, each built up as its packets come (what is
// missing grey), its image number and packets under it; a right-click saves it as a JPEG

// Lines kept in the list
const SAT_ROWS_MAX = 1000;

const SAT = {
  worker: null,
  rate: 0,       // the sample rate the worker was set up for
  config: "",    // the decoders it was last told to run
  lines: [],     // the newest first: { utc, kind, baud, sat, summary, hex, bytes, fec }
  count: 0,      // frames decoded since the list was cleared
  ssdv: null,    // the SSDV pictures' packets (ssdvStore)
  pictures: []   // the newest first: { key, image, url (its JPEG's), card, sat, utc, at (ISO time first heard), timer }
};
// SSDV pictures kept
const SAT_PICTURES_MAX = 12;
// A picture drawn again at most this often while its packets come (ms)
const SAT_PICTURE_MS = 1000;

// The decoders to run, from the transmitter BirdWatch follows (Follow BirdWatch): its SatNOGS mode; all of them otherwise
function mmdSatConfig()
{
  const followed = GT.settings.MMD.followBirdWatch === true ? window.opener.mmDecoderBirdWatchMode() : null;
  const mode = String((followed && followed.satnogs) || "").toUpperCase();
  const baud = followed ? followed.baud : 0;
  if (/GENESIS/.test(mode)) return { kinds: ["genesis"], baud };
  if (/AX\.100/.test(mode)) return { kinds: ["ax100"], baud };
  if (/^BPSK/.test(mode) && (baud == 1200 || !baud)) return { kinds: ["funcube"], baud: 1200 };
  return { kinds: ["funcube", "ax100", "genesis"], baud: 0 };
}

// satWorker.js, set up for the input's rate, and told which decoders run whenever that changes
function mmdSatLoad(rate)
{
  if (!SAT.worker)
  {
    SAT.worker = new Worker("lib/mmd/satWorker.js");
    SAT.worker.onmessage = (event) => mmdSatMessage(event.data);
  }
  if (SAT.rate != rate)
  {
    SAT.rate = rate;
    SAT.config = "";
    SAT.worker.postMessage({ type: "init", rate });
  }
  const config = mmdSatConfig();
  const key = config.kinds.join(",") + "|" + config.baud;
  if (SAT.config != key)
  {
    SAT.config = key;
    SAT.worker.postMessage(Object.assign({ type: "config" }, config));
  }
  return SAT.worker;
}

// A tenth of a second of the input's samples from the worklet
function mmdSatAudio(data)
{
  mmdSatLoad(data.rate).postMessage({ type: "audio", samples: data.samples }, [data.samples.buffer]);
}

// Listening starts again (the mode chosen, a retune): a frame half heard is let go
function mmdSatReset()
{
  if (SAT.worker) SAT.worker.postMessage({ type: "reset" });
}

// Clear: the list emptied
function mmdSatClear()
{
  mmdSatReset();
  SAT.lines = [];
  SAT.count = 0;
  // The pictures too
  for (const pic of SAT.pictures)
  {
    nodeTimers.clearTimeout(pic.timer);
    URL.revokeObjectURL(pic.url);
  }
  SAT.pictures = [];
  SAT.ssdv = null;
  mmdSatPictures();
  mmdSatRender();
}

const SAT_KIND_NAMES = { funcube: "FUNcube", ax100: "AX.100", genesis: "GENESIS" };

function mmdSatMessage(m)
{
  if (m.type != "frame" || DEC.mode != "sat") return;
  const line = {
    utc: new Date().toISOString().slice(11, 19),
    kind: SAT_KIND_NAMES[m.kind] || m.kind,
    baud: m.baud,
    sat: window.opener.mmDecoderSatellite(),
    summary: mmdPacketPrintable(m.summary || ""),
    hex: m.hex || "",
    bytes: m.bytes,
    fec: m.fec || ""
  };
  SAT.lines.unshift(line);
  if (SAT.lines.length > SAT_ROWS_MAX) SAT.lines.length = SAT_ROWS_MAX;
  SAT.count++;
  // Scrolled down the list, the view is moved down by a line, so the lines being read stay put
  if (satList.scrollTop > 0) satList.scrollTop += satRows.rows[0] ? satRows.rows[0].getBoundingClientRect().height : 18;
  satRows.insertAdjacentHTML("afterbegin", mmdSatLine(line));
  while (satRows.rows.length > SAT_ROWS_MAX) satRows.deleteRow(-1);
  satEmpty.style.display = "none";
  mmdStatus(I18N("cwViewer.sat.status").replace("{count}", SAT.count).replace("{utc}", line.utc));
  // A GENESIS SSDV packet: into its picture
  if (m.kind == "genesis" && /SSDV/.test(m.fec || "") && m.bytes) mmdSatSsdv(m, line);
}

// An SSDV packet (the whole SSDV packet satWorker.js rebuilt; else made here from the GENESIS frame's bytes): added to its picture. A
// packet already held changes nothing; else the picture is drawn again (its JPEG made afresh from all its packets so far), at most every
// SAT_PICTURE_MS while its packets come
function mmdSatSsdv(m, line)
{
  const packet = m.ssdv ? Uint8Array.from(m.ssdv) : ssdvGenesisPacket(Uint8Array.from(m.bytes));
  if (!packet) return;
  if (!SAT.ssdv) SAT.ssdv = ssdvStore();
  const added = ssdvAdd(SAT.ssdv, packet);
  if (!added || added.held) return;
  // A late packet of a picture let go (more than SAT_PICTURES_MAX newer): not brought back
  if (added.image.dropped)
  {
    added.image.packets.clear();
    return;
  }
  let pic = SAT.pictures.find((p) => p.key == added.key);
  if (!pic)
  {
    pic = { key: added.key, image: added.image, url: null, card: null, sat: line.sat, utc: line.utc, at: new Date().toISOString(), timer: null };
    SAT.pictures.unshift(pic);
    // The oldest let go: its JPEG and its packets (the store keeps only that it was)
    while (SAT.pictures.length > SAT_PICTURES_MAX)
    {
      const old = SAT.pictures.pop();
      nodeTimers.clearTimeout(old.timer);
      URL.revokeObjectURL(old.url);
      old.image.packets.clear();
      old.image.dropped = true;
    }
    pic.image = added.image;
    mmdSatPictureDraw(pic);
    mmdSatPictures();
    return;
  }
  pic.image = added.image;
  if (!pic.timer) pic.timer = nodeTimers.setTimeout(() => mmdSatPictureDraw(pic), SAT_PICTURE_MS);
}

// A picture's JPEG made afresh, and its card shown with it (when on the row)
function mmdSatPictureDraw(pic)
{
  pic.timer = null;
  if (!SAT.pictures.includes(pic)) return;
  if (pic.url) URL.revokeObjectURL(pic.url);
  pic.url = URL.createObjectURL(new Blob([ssdvJpeg(pic.image)], { type: "image/jpeg" }));
  if (pic.card) mmdSatCard(pic);
}

// The pictures' row above the list (hidden with none): each its image, and its number and packets under it
function mmdSatPictures()
{
  satPictures.innerHTML = "";
  satPictures.style.display = SAT.pictures.length ? "" : "none";
  for (const pic of SAT.pictures)
  {
    if (!pic.card)
    {
      pic.card = document.createElement("div");
      pic.card.className = "satPicture";
      pic.card.appendChild(document.createElement("img"));
      pic.card.appendChild(document.createElement("div"));
      pic.card.addEventListener("contextmenu", (event) => mmdSatPictureMenu(event, pic));
      mmdSatCard(pic);
    }
    satPictures.appendChild(pic.card);
  }
}

// A picture's card: its JPEG, its number and packets under it, and its tooltip
function mmdSatCard(pic)
{
  const info = ssdvInfo(pic.image);
  const [img, caption] = pic.card.children;
  if (img.src != pic.url) img.src = pic.url;
  caption.textContent = I18N("cwViewer.ssdv.caption").replace("{image}", info.imageId).replace("{packets}", info.packets).replace("{missing}", info.missing);
  pic.card.title = (pic.sat ? pic.sat + "  ·  " : "") + pic.utc + "  ·  " + info.width + "×" + info.height + "\n" + I18N("cwViewer.ssdv.hover");
}

// The right-click on a picture: Save Picture... (as a JPEG, where SSTV's pictures go)
function mmdSatPictureMenu(event, pic)
{
  event.preventDefault();
  event.stopPropagation();
  const remote = window.require("@electron/remote");
  const menu = remote.Menu.buildFromTemplate([
    { label: I18N("cwViewer.sstv.save.label"), click: () => mmdSatPictureSave(pic) },
    { label: I18N("cwViewer.picture.copy.label"), click: () => mmdSatPictureCopy(pic) },
    { type: "separator" },
    { label: I18N("cwViewer.picture.delete.label"), click: () => mmdSatPictureDelete(pic) }
  ]);
  menu.popup({ window: remote.getCurrentWindow() });
}

// The picture so far onto the clipboard as an image (its JPEG)
function mmdSatPictureCopy(pic)
{
  const electron = window.require("electron");
  electron.clipboard.writeImage(electron.nativeImage.createFromBuffer(window.require("buffer").Buffer.from(ssdvJpeg(pic.image))));
}

// Off the row, let go as one pushed out by newer ones is (a late packet of it doesn't bring it back). A file saved stays
function mmdSatPictureDelete(pic)
{
  SAT.pictures = SAT.pictures.filter((p) => p != pic);
  nodeTimers.clearTimeout(pic.timer);
  URL.revokeObjectURL(pic.url);
  pic.image.packets.clear();
  pic.image.dropped = true;
  mmdSatPictures();
}

function mmdSatPictureSave(pic)
{
  const remote = window.require("@electron/remote");
  const name = ("SSDV " + pic.at.slice(0, 10) + " " + pic.at.slice(11, 19).replace(/:/g, "") + " " + (pic.sat || "") + " image " + ssdvInfo(pic.image).imageId).replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() + ".jpg";
  const file = remote.dialog.showSaveDialogSync(remote.getCurrentWindow(), {
    defaultPath: path.join(window.opener.mmDecoderSstvFolder(), name),
    filters: [{ name: "JPEG", extensions: ["jpg"] }]
  });
  if (!file) return;
  try
  {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, window.require("buffer").Buffer.from(ssdvJpeg(pic.image)));
  }
  catch (e)
  {
    mmdStatus(e.message, true);
  }
}

function mmdSatLine(line)
{
  const tip = (line.fec ? line.fec + "\n" : "") + line.hex;
  return "<tr><td class='ft8Num'>" + line.utc + "</td><td class='packetKind'>" + mmdEscape(line.kind) + "</td><td class='ft8Num'>" + line.baud +
    "</td><td class='packetSat'>" + mmdEscape(line.sat || "") + "</td><td title=\"" + mmdEscape(tip).replace(/"/g, "&quot;") + "\">" + mmdEscape(line.summary) + "</td></tr>";
}

// The whole list drawn again (after a Clear)
function mmdSatRender()
{
  satRows.innerHTML = SAT.lines.map(mmdSatLine).join("");
  satEmpty.style.display = SAT.lines.length ? "none" : "";
}
