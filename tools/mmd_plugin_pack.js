// Packs each Multi-Mode Decoder plugin (plugins/mmd/<id>/, its plugin.json at its top) into <id>.asar and signs it: <id>.asar.sig
// beside it, an Ed25519 signature over the .asar's bytes as base64, as services/mmdPlugins.js checks it. Written to plugins/out/
// (git leaves it out). Each plugin's manifest is checked first: its id the same as its folder's, every file it names there, its guide
// PDF (plugin.json's guide, built by node docs/pdf/build.js --plugin=<id>) newer than its docs/ (left out of the .asar).
// The signing key (Ed25519, private): the environment's MMD_FREE_SIGNING_KEY (CI: the GitLab variable; PEM, or the PEM or its DER as
// base64), else --key=<pem file>, else the repo's dev key (plugins/dev-key-private.txt). A dev key's pack loads on a dev run only: a
// dev run trusts plugins/dev-key-public.txt (its public half) as well as the free-plugin key, an installed GridTracker2 never does. Both halves
// are in the repo, so every developer can pack and try plugins; the free-plugin key's private half never is.
// To try a packed one: copy the .asar and .asar.sig into <data>\Ginternal\plugins\mmd\ (the dev run's own plugins/mmd/<id>/ folder wins
// over it: move that folder aside while trying it). --make-dev-key writes a new dev pair (plugins/dev-key-private.txt, dev-key-public.txt).
// --publish (or --publish=<app version>; else package.json's version): the download server's tree too, in <out>/site/plugins/, which
// CI's upload-gtserv copies to the server as it is (download2.gridtracker.org/plugins/):
//   mmd/<id>/<id>-<version>-<12 hex of its SHA-256>.asar + .sig   each plugin; a name that never stands for other bytes, so nothing
//                                                                 published is ever overwritten
//   mmd/<app version>/plugins.json + .sig                         the signed list that app version's Get More... reads (only it: an
//                                                                 older version never finds a newer one's plugins)
//   .htaccess                                                     Options -Indexes: plugins/ isn't listed
// Dry run (checks, lists what it would write) unless "write". Usage (repo root):
//   node tools/mmd_plugin_pack.js [write] [id ...] [--key=<pem file>] [--out=<folder>] [--publish[=<app version>]]
//   node tools/mmd_plugin_pack.js --make-dev-key
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const args = process.argv.slice(2);
const opt = (name) => (args.find((a) => a.startsWith("--" + name + "=")) || "").slice(name.length + 3);
const write = args.includes("write");
const root = path.join(__dirname, "..");
const devPrivate = path.join(root, "plugins", "dev-key-private.txt");
const devPublic = path.join(root, "plugins", "dev-key-public.txt");
const pluginsDir = path.join(root, "plugins", "mmd");
const outDir = path.resolve(opt("out") || path.join(root, "plugins", "out"));
const only = args.filter((a) => a != "write" && !a.startsWith("--"));
// The app version the published tree's list is for (--publish), else null
const publishFor = args.some((a) => a == "--publish" || a.startsWith("--publish=")) ? opt("publish") || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version : null;
if (publishFor !== null && !/^\d+\.\d+\.\d+$/.test(publishFor)) throw new Error("--publish: " + publishFor + " isn't an app version (2.YYMMDD.N)");
// The free-plugin key's public half, as services/mmdPlugins.js has it
const FREE_KEY = "MCowBQYDK2VwAyEAZRrWLnaNIEvMys2cT3ndbQHL5fM+unYNkWsAnepx9pI=";

if (args.some((a) => a == "--make-dev-key" || a.startsWith("--make-dev-key=")))
{
  if (fs.existsSync(devPrivate) || fs.existsSync(devPublic)) throw new Error("a dev key is there already (plugins/dev-key-private.txt, dev-key-public.txt): delete both first");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(devPrivate, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(devPublic, publicKey.export({ type: "spki", format: "pem" }));
  console.log("dev key: plugins/dev-key-private.txt (private) and plugins/dev-key-public.txt (public; a dev run trusts it)");
  process.exit(0);
}

// The private key, or null; whose it is (for the log)
let keyFrom = "";
function signingKey()
{
  let text = process.env.MMD_FREE_SIGNING_KEY || "";
  keyFrom = "MMD_FREE_SIGNING_KEY";
  if (!text && opt("key"))
  {
    text = fs.readFileSync(path.resolve(opt("key")), "utf8");
    keyFrom = opt("key");
  }
  if (!text && fs.existsSync(devPrivate))
  {
    text = fs.readFileSync(devPrivate, "utf8");
    keyFrom = "the repo's dev key (loads on a dev run only)";
  }
  text = text.trim();
  if (!text) return null;
  if (text.includes("BEGIN")) return crypto.createPrivateKey(text);
  const bytes = Buffer.from(text, "base64");
  const decoded = bytes.toString("utf8");
  if (decoded.includes("BEGIN")) return crypto.createPrivateKey(decoded);
  return crypto.createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
}

// Problems with a plugin's folder (its manifest and the files it names), none: []
function check(id, dir)
{
  const problems = [];
  let m;
  try
  {
    m = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
  }
  catch (e)
  {
    return ["plugin.json: " + e.message];
  }
  if (m.id != id) problems.push("its id " + m.id + " isn't its folder's " + id);
  if (!/^[a-z][a-z0-9]*$/.test(id)) problems.push("id: lower case letters and digits only");
  if (!Number.isInteger(m.api)) problems.push("api: a whole number");
  if (!m.version) problems.push("no version");
  const files = [].concat(m.scripts || [], m.workers || [], m.ui || [], m.css || [], (m.bands && m.bands.file) || [], m.testSignals || [], m.guide || []);
  for (const f of files) if (!fs.existsSync(path.join(dir, f))) problems.push("missing " + f);
  if (m.i18n && !fs.existsSync(path.join(dir, m.i18n, "en.json"))) problems.push("missing " + m.i18n + "/en.json");
  // Its guide built from its docs/ (node docs/pdf/build.js --plugin=<id>): not older than them
  if (m.guide && fs.existsSync(path.join(dir, m.guide)) && fs.existsSync(path.join(dir, "docs")))
  {
    const built = fs.statSync(path.join(dir, m.guide)).mtimeMs;
    const newest = Math.max(...fs.readdirSync(path.join(dir, "docs"), { recursive: true }).map((f) => fs.statSync(path.join(dir, "docs", f)).mtimeMs));
    if (newest > built) problems.push(m.guide + " is older than docs/: node docs/pdf/build.js --plugin=" + id);
  }
  if (m.testSignals && fs.existsSync(path.join(dir, m.testSignals)))
  {
    const tdir = path.dirname(path.join(dir, m.testSignals));
    for (const t of JSON.parse(fs.readFileSync(path.join(dir, m.testSignals), "utf8")).signals || []) if (!fs.existsSync(path.join(tdir, t.file))) problems.push("missing test signal " + t.file);
  }
  return problems;
}

async function main()
{
  const key = signingKey();
  if (key)
  {
    const pub = crypto.createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    console.log("signing key: " + keyFrom + ": " + (pub == FREE_KEY ? "the free-plugin key" : "not the free-plugin key, " + pub));
    // In CI only the free-plugin key: anything else would publish plugins no installed GridTracker2 loads
    if (process.env.CI && pub != FREE_KEY) throw new Error("CI: the signing key isn't the free-plugin key (MMD_FREE_SIGNING_KEY's public half must be " + FREE_KEY + ")");
  }
  else console.log("no signing key: packed but NOT signed");
  const ids = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(pluginsDir, e.name, "plugin.json"))).map((e) => e.name).filter((id) => !only.length || only.includes(id));
  let bad = 0;
  for (const id of ids)
  {
    const problems = check(id, path.join(pluginsDir, id));
    console.log(id + ": " + (problems.length ? problems.join("; ") : "ok"));
    bad += problems.length;
  }
  if (bad) throw new Error(bad + " problem(s): nothing written");
  // (the list is signed, or it is worthless)
  if (publishFor && !key) throw new Error("--publish needs a signing key");
  if (!write)
  {
    console.log("dry run: would write " + ids.map((id) => path.join(outDir, id + ".asar") + (key ? " + .sig" : "")).join(", "));
    if (publishFor) console.log("dry run: and " + path.join(outDir, "site", "plugins") + ": each plugin, mmd/" + publishFor + "/plugins.json + .sig, .htaccess");
    return;
  }
  // (required here: a dry run needs no node_modules)
  const asar = require("@electron/asar");
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of ids)
  {
    const file = path.join(outDir, id + ".asar");
    // Packed from a copy in a temp folder, so nothing beside the folder's own files gets in; its guide's source (docs/) left out, the
    // PDF built from it goes in
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "gt-plugin-"));
    try
    {
      const src = path.join(pluginsDir, id);
      fs.cpSync(src, staging, { recursive: true, filter: (f) => path.relative(src, f).split(path.sep)[0] != "docs" });
      await asar.createPackage(staging, file);
    }
    finally
    {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    const bytes = fs.readFileSync(file);
    let line = file + " " + (bytes.length / 1024).toFixed(0) + " KB";
    fs.rmSync(file + ".sig", { force: true });
    if (key)
    {
      const sig = crypto.sign(null, bytes, key);
      if (!crypto.verify(null, bytes, crypto.createPublicKey(key), sig)) throw new Error(id + ": its signature doesn't verify");
      fs.writeFileSync(file + ".sig", sig.toString("base64") + "\n");
      line += ", signed";
    }
    console.log(line);
  }
  if (publishFor) publish(ids, key);
}

// The download server's tree (--publish): each plugin under its content's name, and this app version's signed list of them
function publish(ids, key)
{
  const site = path.join(outDir, "site", "plugins");
  fs.rmSync(path.join(outDir, "site"), { recursive: true, force: true });
  fs.mkdirSync(path.join(site, "mmd", publishFor), { recursive: true });
  // (CRLF, as every text file here)
  fs.writeFileSync(path.join(site, ".htaccess"), "Options -Indexes\r\n");
  const plugins = [];
  for (const id of ids)
  {
    const m = JSON.parse(fs.readFileSync(path.join(pluginsDir, id, "plugin.json"), "utf8"));
    const bytes = fs.readFileSync(path.join(outDir, id + ".asar"));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const file = id + "/" + id + "-" + m.version + "-" + sha256.slice(0, 12) + ".asar";
    fs.mkdirSync(path.join(site, "mmd", id), { recursive: true });
    fs.writeFileSync(path.join(site, "mmd", file), bytes);
    fs.copyFileSync(path.join(outDir, id + ".asar.sig"), path.join(site, "mmd", file + ".sig"));
    const modes = Array.isArray(m.modes) && m.modes.length ? m.modes.map((d) => String((d.menu && d.menu.label) || d.id)) : [String((m.menu && m.menu.label) || m.name || id)];
    plugins.push({ id, name: String(m.name || id), version: String(m.version), kind: m.kind == "commercial" ? "commercial" : "free", api: m.api, minAppVersion: String(m.minAppVersion || ""), modes, file, size: bytes.length, sha256 });
  }
  const list = Buffer.from(JSON.stringify({ format: 1, app: publishFor, built: new Date().toISOString(), plugins }, null, 2).replace(/\n/g, "\r\n") + "\r\n", "utf8");
  const listFile = path.join(site, "mmd", publishFor, "plugins.json");
  fs.writeFileSync(listFile, list);
  const sig = crypto.sign(null, list, key);
  if (!crypto.verify(null, list, crypto.createPublicKey(key), sig)) throw new Error("plugins.json: its signature doesn't verify");
  fs.writeFileSync(listFile + ".sig", sig.toString("base64") + "\n");
  console.log("published tree: " + site + " (" + plugins.length + " plugins, list for " + publishFor + ")");
}

main().catch((e) =>
{
  console.error(e.message);
  process.exit(1);
});
