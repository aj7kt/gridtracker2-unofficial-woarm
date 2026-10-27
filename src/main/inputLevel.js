// An audio input's own recording level, as the system's sound settings set it (before the sound card's converter, so a loud rig can be
// kept from clipping there): the Multi-Mode Decoder's Input Device level (its window, mmdLevel). The device comes as the page knows it,
// its label (device ids in a page are hashed, so a label is all there is to go by) and whether it is the system's default input.
//   Windows: Core Audio's endpoint volume of the capture endpoint whose friendly name the label is (the page adds " (vid:pid)" to a USB
//            one's), through one PowerShell kept running for it.
//   Linux:   PulseAudio / PipeWire, pactl: the source whose description the label is.
//   macOS:   only the default input's, osascript (others have no level a script can reach); null for any other.
// get: the level 0..1, or null when it can't be had. set: the level set, read back, or null.
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WIN_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GtInputLevel
{
  [StructLayout(LayoutKind.Sequential)] public struct PropKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Sequential)] public struct PropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator
  {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection
  {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice
  {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore store);
  }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore
  {
    int GetCount(out int count);
    int GetAt(int index, out PropKey key);
    int GetValue(ref PropKey key, out PropVariant value);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume
  {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out int count);
    int SetMasterVolumeLevel(float db, ref Guid context);
    int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float level);
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);

  static string Name(IMMDevice device)
  {
    IPropertyStore store;
    device.OpenPropertyStore(0, out store);
    PropKey key = new PropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    PropVariant v;
    store.GetValue(ref key, out v);
    string name = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    PropVariantClear(ref v);
    return name;
  }

  // The capture endpoint the page's label is: "Default - " and "Communications - " are those roles' endpoints; else the active one whose
  // friendly name the label is, or starts (" (vid:pid)" after it), the longest such name
  static IAudioEndpointVolume Find(string label)
  {
    IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice found = null;
    if (label.StartsWith("Default - ")) e.GetDefaultAudioEndpoint(1, 0, out found);
    else if (label.StartsWith("Communications - ")) e.GetDefaultAudioEndpoint(1, 2, out found);
    else
    {
      IMMDeviceCollection all;
      e.EnumAudioEndpoints(1, 1, out all);
      int count;
      all.GetCount(out count);
      int best = -1;
      for (int i = 0; i < count; i++)
      {
        IMMDevice d;
        all.Item(i, out d);
        string name = Name(d);
        if (name.Length > best && (label == name || label.StartsWith(name + " (")))
        {
          found = d;
          best = name.Length;
        }
      }
    }
    if (found == null) return null;
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    found.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }

  public static float Get(string label)
  {
    IAudioEndpointVolume v = Find(label);
    if (v == null) return -1;
    float level;
    v.GetMasterVolumeLevelScalar(out level);
    return level;
  }

  public static float Set(string label, float level)
  {
    IAudioEndpointVolume v = Find(label);
    if (v == null) return -1;
    Guid context = Guid.Empty;
    v.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref context);
    v.GetMasterVolumeLevelScalar(out level);
    return level;
  }
}
"@
[Console]::Out.WriteLine("ready")
while ($null -ne ($line = [Console]::In.ReadLine()))
{
  try
  {
    $q = $line | ConvertFrom-Json
    if ($q.op -eq "set") { $r = [GtInputLevel]::Set($q.label, [float]$q.level) } else { $r = [GtInputLevel]::Get($q.label) }
    [Console]::Out.WriteLine([string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0}", $r))
  }
  catch
  {
    [Console]::Out.WriteLine("-1")
  }
}
`;

// Windows: the PowerShell, started at the first ask; asks answered one at a time, in order (a line each way). Its script is written out
// as a plain file (Ginternal\inputLevel.ps1, readable by anyone wondering what it is) and run from there, not passed encoded
let win = null;
let scriptFolder = null;

function winStart()
{
  const file = path.join(scriptFolder || os.tmpdir(), "inputLevel.ps1");
  try
  {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") != WIN_SCRIPT) fs.writeFileSync(file, WIN_SCRIPT);
  }
  catch (e)
  {
    // Not written: the asks come back null (the PowerShell fails to start the script)
  }
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
  const W = { child: child, queue: [], buffer: "", ready: false };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) =>
  {
    W.buffer += data;
    let at;
    while ((at = W.buffer.indexOf("\n")) >= 0)
    {
      const line = W.buffer.slice(0, at).trim();
      W.buffer = W.buffer.slice(at + 1);
      if (!W.ready)
      {
        if (line == "ready")
        {
          W.ready = true;
          winNext(W);
        }
        continue;
      }
      const ask = W.queue.shift();
      if (ask)
      {
        clearTimeout(ask.timer);
        const level = Number(line);
        ask.resolve(level >= 0 ? level : null);
      }
      winNext(W);
    }
  });
  child.stderr.on("data", () => {});
  const gone = () =>
  {
    if (win === W) win = null;
    for (const ask of W.queue.splice(0))
    {
      clearTimeout(ask.timer);
      ask.resolve(null);
    }
  };
  child.on("exit", gone);
  child.on("error", gone);
  return W;
}

function winNext(W)
{
  const ask = W.queue[0];
  if (!W.ready || !ask || ask.sent) return;
  ask.sent = true;
  // An ask not answered in time: the PowerShell is let go (started again at the next)
  ask.timer = setTimeout(() =>
  {
    try
    {
      W.child.kill();
    }
    catch (e)
    {
      // Gone already
    }
  }, 8000);
  W.child.stdin.write(JSON.stringify(ask.q) + "\n");
}

function winAsk(q)
{
  if (!win) win = winStart();
  const W = win;
  return new Promise((resolve) =>
  {
    W.queue.push({ q: q, resolve: resolve, sent: false });
    winNext(W);
  });
}

function run(file, args)
{
  return new Promise((resolve) =>
  {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

// Linux: the source whose description the label is (pactl's own names, as "pactl list sources" gives them), the default's for the default
async function linuxSource(label, isDefault)
{
  if (isDefault) return "@DEFAULT_SOURCE@";
  const out = await run("pactl", ["list", "sources"]);
  if (out == null) return null;
  let name = null;
  for (const line of out.split("\n"))
  {
    const t = line.trim();
    if (t.startsWith("Name:")) name = t.slice(5).trim();
    else if (t.startsWith("Description:") && t.slice(12).trim() == label) return name;
  }
  return null;
}

async function linuxGet(source)
{
  const out = await run("pactl", ["get-source-volume", source]);
  const m = out && out.match(/(\d+)%/);
  return m ? Number(m[1]) / 100 : null;
}

// Where the Windows script is written (the app's Ginternal folder)
function inputLevelFolder(folder)
{
  scriptFolder = folder;
}

async function inputLevel(op, label, isDefault, level)
{
  label = String(label || "");
  if (process.platform == "win32")
  {
    return winAsk(op == "set" ? { op: "set", label: label, level: Number(level) } : { op: "get", label: label });
  }
  if (process.platform == "linux")
  {
    const source = await linuxSource(label, isDefault);
    if (!source) return null;
    if (op == "set") await run("pactl", ["set-source-volume", source, Math.round(Math.max(0, Math.min(1, Number(level))) * 100) + "%"]);
    return linuxGet(source);
  }
  if (process.platform == "darwin")
  {
    if (!isDefault) return null;
    if (op == "set") await run("osascript", ["-e", "set volume input volume " + Math.round(Math.max(0, Math.min(1, Number(level))) * 100)]);
    const out = await run("osascript", ["-e", "input volume of (get volume settings)"]);
    const n = out == null ? NaN : parseFloat(out);
    return n >= 0 ? n / 100 : null;
  }
  return null;
}

// The PowerShell let go as the app quits
function inputLevelQuit()
{
  if (win)
  {
    try
    {
      win.child.kill();
    }
    catch (e)
    {
      // Gone already
    }
    win = null;
  }
}

module.exports = { inputLevel, inputLevelQuit, inputLevelFolder };
