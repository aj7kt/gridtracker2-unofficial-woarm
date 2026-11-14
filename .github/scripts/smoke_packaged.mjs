// CI smoke test of a packaged build: launches it with the debug port, waits for the main window, checks the process
// architecture and native serial (where the app has it), runs tools/smoke_main.js in the main window, then stops it. Exits 1 on any failure.
//   node .github/scripts/smoke_packaged.mjs <path to the app's exe> <expected arch, e.g. arm64>
// Run from the repo root (it uses tools/cdp.mjs). Only for CI: anything local can drive the app while the port is open.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [exe, wantArch] = process.argv.slice(2);
if (!exe || !wantArch)
{
  console.log("usage: node .github/scripts/smoke_packaged.mjs <exe> <arch>");
  process.exit(2);
}
const port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (...args) => execFileSync(process.execPath, ["tools/cdp.mjs", ...args], { encoding: "utf8", timeout: 180000, env: { ...process.env, CDP_PORT: String(port) } }).trim();
// cdp.mjs prints the JSON of the page's result; the checks below return JSON text, so it is parsed twice
const cdpJson = (...args) => JSON.parse(JSON.parse(cdp(...args)));

const child = spawn(exe, ["--remote-debugging-port=" + port, "--disable-auto-updates"], { stdio: "ignore" });
const problems = [];
try
{
  let up = false;
  for (let i = 0; i < 120 && !up; i++)
  {
    await sleep(1000);
    try
    {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      up = list.some((p) => p.type === "page" && p.url.endsWith("/GridTracker2.html"));
    }
    catch
    {
      // not listening yet
    }
  }
  if (!up) throw new Error("the main window never came up");
  // Shortly after launch the main UI isn't laid out yet
  await sleep(15000);

  // Native serial is checked only where the app has it (serialport in package.json: v2.261108.4 and older have none)
  const wantSerial = Boolean(JSON.parse(readFileSync("package.json", "utf8")).dependencies?.serialport);
  const info = cdpJson("GridTracker2.html", "eval",
    "(async () => JSON.stringify({ arch: process.arch, electron: process.versions.electron, userData: require('electron').ipcRenderer.sendSync('getPath', 'userData')" +
    (wantSerial ? ", serial: await require('electron').ipcRenderer.invoke('serialAvailable')" : "") + " }))()");
  console.log("app:", JSON.stringify(info));
  if (info.arch !== wantArch) problems.push(`runs as ${info.arch}, expected ${wantArch}`);
  if (wantSerial && info.serial !== true) problems.push("native serial (serialport) isn't available");

  const smoke = cdpJson("GridTracker2.html", "evalfile", "tools/smoke_main.js");
  for (const s of smoke.steps) console.log("  " + s);
  for (const s of smoke.steps) if (!/: ok( |$)/.test(s)) problems.push("step " + s);
  for (const e of smoke.pageErrors) problems.push("page error: " + e);
}
catch (e)
{
  problems.push(e.message);
}
finally
{
  try
  {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
  catch
  {
    child.kill();
  }
}
if (problems.length)
{
  console.log("SMOKE FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("SMOKE PASSED");
