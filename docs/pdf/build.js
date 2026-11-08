// Builds the User Guide PDF: Sphinx single-page HTML, then Electron prints it (no LaTeX needed)
//   node docs/pdf/build.js                    writes resources/data/help-en.pdf (shipped with the app)
//   node docs/pdf/build.js out.pdf            writes to the given path instead
// Needs Python with Sphinx and myst-parser (pip install -r docs/requirements.txt), and npm ci for Electron.
// PYTHON picks the Python executable (default: python, or py -3 on Windows if python isn't found).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const docsDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(docsDir, "..");
const htmlDir = path.join(docsDir, "_build", "pdf-html");
const outFile = path.resolve(process.argv[2] || path.join(repoDir, "resources", "data", "help-en.pdf"));
const version = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8")).version;

function run(cmd, args, opts = {})
{
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + " exited with " + r.status);
}

function findPython()
{
  if (process.env.PYTHON) return [process.env.PYTHON];
  for (const c of [["python"], ["python3"], ["py", "-3"]])
  {
    const r = spawnSync(c[0], [...c.slice(1), "-c", "import sphinx, myst_parser"], { stdio: "ignore" });
    if (r.status === 0) return c;
  }
  throw new Error("No Python with sphinx and myst-parser found (pip install -r docs/requirements.txt, or set PYTHON)");
}

// 1. Sphinx single-page HTML
const py = findPython();
fs.rmSync(htmlDir, { recursive: true, force: true });
run(py[0], [...py.slice(1), "-m", "sphinx", "-q", "-b", "singlehtml", "-D", "html_theme=basic", "-D", "html_title=GridTracker2 User Guide", docsDir, htmlDir]);

// 2. Cover page and print stylesheet
const indexFile = path.join(htmlDir, "index.html");
let html = fs.readFileSync(indexFile, "utf8");
fs.copyFileSync(path.join(__dirname, "print.css"), path.join(htmlDir, "_static", "print.css"));
const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const cover = `<div class="gt-cover">
<img src="_images/GridTracker_logo.png" alt="GridTracker2 logo">
<h1 class="gt-cover-title">GridTracker2 User Guide</h1>
<p class="gt-cover-version">Version ${version}</p>
<p class="gt-cover-date">${date}</p>
<p class="gt-cover-site">gridtracker.org</p>
</div>`;
html = html.replace("</head>", `<link rel="stylesheet" href="_static/print.css" type="text/css">\n</head>`);
// The single-page builder drops toctree captions; put each part's caption (from index.rst) back into its toctree
const captions = [...fs.readFileSync(path.join(docsDir, "index.rst"), "utf8").matchAll(/^\s*:caption:\s*(.+?)\s*$/gm)].map((m) => m[1]);
const wrapper = `<div class="toctree-wrapper compound">`;
const wrappers = html.split(wrapper).length - 1;
if (wrappers !== captions.length) throw new Error(`index.rst has ${captions.length} captions but the HTML has ${wrappers} toctrees`);
let part = 0;
html = html.replaceAll(wrapper, () => `${wrapper}\n<p class="caption">${captions[part++].replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`);
const bodyStart = html.indexOf(`<div class="body" role="main">`);
if (bodyStart < 0) throw new Error("Sphinx output changed: main body div not found");
html = html.replace(`<div class="body" role="main">`, `<div class="body" role="main">\n${cover}`);
if (!fs.existsSync(path.join(htmlDir, "_images", "GridTracker_logo.png")))
  fs.copyFileSync(path.join(docsDir, "img", "GridTracker_logo.png"), path.join(htmlDir, "_images", "GridTracker_logo.png"));
fs.writeFileSync(indexFile, html);

// 3. Print with Electron (ELECTRON_RUN_AS_NODE would make it act as Node, so drop it)
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const electron = require(path.join(repoDir, "node_modules", "electron"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
run(electron, [path.join(__dirname, "print.js"), "--no-sandbox", "--input=" + indexFile, "--output=" + outFile, "--version=" + version], { env });
console.log("PDF written: " + outFile);
