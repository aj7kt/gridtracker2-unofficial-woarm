// The PC clock moved by a number of seconds (the Multi-Mode Decoder's WWV mode, its Set PC Clock button: never by itself), through the
// system's own prompt for an administrator, as setting the clock needs one on every system. The move is relative: the clock is read and
// set again by the elevated command itself, after the prompt has been answered, so however long the prompt waits doesn't matter.
//   Windows: PowerShell's Set-Date -Adjust in a PowerShell started elevated (Start-Process -Verb RunAs: the UAC prompt). Setting the
//            time needs the SeSystemtimePrivilege an elevated administrator has. Windows Time (w32time), where it runs, sets the clock
//            again at its next sync. UAC can't show a program's own reason, only "Windows PowerShell": its command line, under the
//            prompt's Show more details, starts with a sentence saying what it's for (a string, set aside: it does nothing)
//   Linux:   pkexec (polkit's prompt) running sh, which reads the clock to the nanosecond (date +%s%N) and sets it (date -s @seconds.ns:
//            root, CAP_SYS_TIME). systemd-timesyncd, chrony or ntpd, where they run, bring it back to their time.
//   macOS:   osascript's "with administrator privileges" (the password prompt) running perl (Time::HiRes, part of perl): the moment the
//            clock with the move is on a whole second, date -f %s sets that second (macOS's date sets whole seconds only). The system's
//            network time, where it's on, brings it back.
// clockAdjustCommand(platform, seconds): the command, { file, args } (run as is, no shell between), or null for a move it won't make
// (none, not a number, over a day either way) or a system it doesn't know. Exported so it can be checked without running it.
// clockAdjust(seconds): runs it; { ok, error } once the command is done (declined, or failed: ok false and the system's first line why).
const { execFile } = require("child_process");

// The largest move, either way (s); a clock further off is better set by hand
const CLOCK_ADJUST_MAX_S = 86400;
// How long the prompt may wait for an answer (ms)
const CLOCK_ADJUST_TIMEOUT_MS = 180000;

function clockAdjustCommand(platform, seconds)
{
  const s = Number(seconds);
  if (typeof seconds != "number" || !isFinite(s) || s == 0 || Math.abs(s) > CLOCK_ADJUST_MAX_S) return null;
  if (platform == "win32")
  {
    // In 100 ns ticks, a whole number (no decimal point for the locale to read otherwise)
    const ticks = Math.round(s * 1e7);
    // (its quotes doubled: this goes inside the outer command's single-quoted string)
    const reason = "''GridTracker2 (WWV / WWVH): moving the PC clock by " + (s > 0 ? "+" : "") + s.toFixed(4) + " s''";
    const inner = "-NoProfile -NonInteractive -Command $null = " + reason + "; Set-Date -Adjust ([TimeSpan]::FromTicks(" + ticks + ")) | Out-Null";
    const outer = "$p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '" + inner + "'; exit $p.ExitCode";
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", outer] };
  }
  if (platform == "linux")
  {
    const ns = Math.round(s * 1e9);
    const script = "ns=$(date +%s%N) && ns=$((ns + (" + ns + "))) && date -u -s \"@$((ns / 1000000000)).$(printf %09d $((ns % 1000000000)))\" > /dev/null";
    return { file: "pkexec", args: ["/bin/sh", "-c", script] };
  }
  if (platform == "darwin")
  {
    // (No quotes or backslashes inside: it goes in an AppleScript string, then a shell's single quotes)
    const perl = "$d=" + s.toFixed(4) + ";$t=time+$d;sleep(1-($t-int($t)));$s=int(time+$d+0.5);exec(q(/bin/date),q(-u),q(-f),q(%s),$s)";
    const shell = "/usr/bin/perl -MTime::HiRes=time,sleep -e '" + perl + "' > /dev/null";
    return { file: "osascript", args: ["-e", "do shell script \"" + shell + "\" with administrator privileges"] };
  }
  return null;
}

function clockAdjust(seconds)
{
  const command = clockAdjustCommand(process.platform, seconds);
  if (!command) return Promise.resolve({ ok: false, error: "unsupported" });
  return new Promise((resolve) =>
  {
    execFile(command.file, command.args, { timeout: CLOCK_ADJUST_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) =>
    {
      if (!error) resolve({ ok: true, error: null });
      else resolve({ ok: false, error: String(stderr || "").trim().split(/\r?\n/)[0] || error.message });
    });
  });
}

module.exports = { clockAdjust, clockAdjustCommand };
