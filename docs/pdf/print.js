// Electron main script used by docs/pdf/build.js: loads the single-page HTML and prints it to PDF
//   electron docs/pdf/print.js --input=<index.html> --output=<file.pdf> --version=<x> [--title=<footer title>] [--contents=no]
//   (--contents=no: a plugin's one-page guide, no Contents page)
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const arg = (name) => (process.argv.find((a) => a.startsWith("--" + name + "=")) || "").slice(name.length + 3);
const input = arg("input");
const output = arg("output");
const version = arg("version");
const title = arg("title") || "GridTracker2 User Guide";
const contents = arg("contents") != "no";

// Keep this run's profile out of the way of any other Electron app data
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "gt-docs-pdf-")));

// Runs in the page: marks parts and chapters, and builds the linked Contents page after the cover.
// index.rst holds one captioned toctree per part; every document included by it is a chapter.
function buildContents()
{
  const body = document.querySelector("div.body");
  const guideTitle = body.querySelector("section > h1");
  if (guideTitle) guideTitle.remove();
  const toc = document.createElement("nav");
  toc.className = "gt-toc";
  toc.innerHTML = "<h1 class='gt-toc-title'>Contents</h1>";
  let list = null;
  let n = 0;
  const ensureId = (el) =>
  {
    if (!el.id) el.id = "gt-auto-" + (++n);
    return el.id;
  };
  const textOf = (h) => Array.from(h.childNodes).filter((c) => !(c.classList && c.classList.contains("headerlink"))).map((c) => c.textContent).join("").trim();
  const nodes = body.querySelectorAll("div.toctree-wrapper > p.caption, span[id^='document-'] + section");
  for (const node of nodes)
  {
    if (node.matches("p.caption"))
    {
      node.classList.add("gt-part");
      const part = document.createElement("div");
      part.className = "gt-toc-part";
      part.innerHTML = `<a href="#${ensureId(node)}">${node.textContent.trim()}</a>`;
      toc.appendChild(part);
      list = document.createElement("ul");
      toc.appendChild(list);
      continue;
    }
    node.classList.add("gt-chapter");
    const h = node.querySelector(":scope > h1, :scope > h2, :scope > h3");
    if (!h || !list) continue;
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${ensureId(node)}">${textOf(h)}</a>`;
    const subs = node.querySelectorAll(":scope > section");
    if (subs.length)
    {
      const ul = document.createElement("ul");
      for (const s of subs)
      {
        const sh = s.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");
        if (sh) ul.insertAdjacentHTML("beforeend", `<li><a href="#${ensureId(s)}">${textOf(sh)}</a></li>`);
      }
      li.appendChild(ul);
    }
    list.appendChild(li);
  }
  const cover = body.querySelector(".gt-cover");
  if (cover) cover.after(toc);
  else body.prepend(toc);
  return true;
}

app.whenReady().then(async () =>
{
  const win = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { offscreen: false } });
  await win.loadFile(input);
  if (contents) await win.webContents.executeJavaScript(`(${buildContents.toString()})()`);
  // Let web fonts and late images settle
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await new Promise((r) => setTimeout(r, 500));
  const footer = `<div style="font-family: Segoe UI, Helvetica, Arial, sans-serif; font-size: 8px; color: #666; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between;">
    <span>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")} &middot; v${version}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const pdf = await win.webContents.printToPDF({
    pageSize: "Letter",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footer,
    margins: { top: 0.6, bottom: 0.7, left: 0.6, right: 0.6 },
    generateDocumentOutline: true,
    generateTaggedPDF: true
  });
  fs.writeFileSync(output, pdf);
  app.quit();
}).catch((e) =>
{
  console.error(e);
  app.exit(1);
});
