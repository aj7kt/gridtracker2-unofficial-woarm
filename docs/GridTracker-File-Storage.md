# Files, Folders and Command-Line Options

## The Data Folder

GridTracker2 keeps your settings, backup logs and other files in its data folder:

| System | Data folder |
| --- | --- |
| Windows | `%APPDATA%\GridTracker2`, that is `C:\Users\<you>\AppData\Roaming\GridTracker2` |
| macOS | `~/Library/Application Support/GridTracker2` |
| Linux | `~/.config/GridTracker2` |

```{tip}
On Windows, type `%APPDATA%\GridTracker2` into the File Explorer address bar to open the folder. **Backup Logs** in Settings → Logging opens the backup log folder directly.
```

Inside it:

* **Backup Logs:** GridTracker2's own backup log, one ADIF file for each callsign and grid you have operated from, such as `GridTracker2_N0TTL_CN84.adif`. See [The GridTracker2 Backup Log](Making-GridTracker-Work-For-You/GridTracker-Logging-Options-and-Functions.md#the-gridtracker2-backup-log).
* **Screenshots:** the pictures saved by **Ctrl+K**.
* **Extra Media:** put your own sound files here to use them in alerts. They are listed with the built-in sounds the next time GridTracker2 starts.
* **Call Roster Scripts:** put a `cr-alert.bat` (Windows) or `cr-alert.sh` (macOS and Linux) script here to run it on roster alerts. See [Running a Script on Alerts](Making-GridTracker-Work-For-You/Using-Call-Roster.md#running-a-script-on-alerts).
* **Ginternal:** GridTracker2's own files: your settings (`app-settings.json`), window positions (`windows.json`), and the downloaded callsign databases and logs. You shouldn't need to touch these; use **Export Settings** in Settings → General to back up your settings.
* **logs:** the error log, `main.log`. On macOS it is in `~/Library/Logs/GridTracker2` instead. Include it when you report a problem.

Uninstalling GridTracker2 leaves the data folder in place, so your settings and backup logs are kept.

### Backing Up

Your real log should be in a logging program or online logbook, which have their own backups. To back up GridTracker2 itself:

* **Export Settings** in Settings → General saves all your settings to a file of your choice. **Import Settings** restores them, on this or another computer.
* Copy the **Backup Logs** folder.

Upload failures to LoTW are queued in your system's temporary folder, and sent with your next QSO.

## Where Your Logs Are Found

At startup, GridTracker2 looks for the logs of WSJT-X, WS – Digital Mode Suite and JTDX in their usual folders:

| System | Searched folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%` |
| macOS | `~/Library/Application Support` |
| Linux | `~/.local/share` |

The logs it finds are listed under **App Log(s)** in Settings → Logging, where you can untick them or add others.

## The Program

| System | Installed in |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\GridTracker2` for a single-user installation (the default), or `C:\Program Files\GridTracker2` for all users |
| macOS | your **Applications** folder, if you dragged it there |
| Linux | `/opt/GridTracker2` for the deb, rpm and pacman packages; wherever you put the AppImage or the unpacked tar.gz |

## Command-Line Options

| Option | Effect |
| --- | --- |
| `--gt-name=Name` | Runs a separate copy of GridTracker2 with its own settings, logs and windows, in a data folder named `GridTracker2 - Name`. |
| `--disable-auto-updates` | GridTracker2 still tells you when a new version is available, but doesn't download it until you click **Download**. |

On Windows, to start GridTracker2 from a command prompt or batch file and see its messages there, first run `set ELECTRON_NO_ATTACH_CONSOLE=true`.

### Running Several Copies

Normally only one copy of GridTracker2 can run: starting a second one just exits. To run several, for example one for each radio, start each with its own name:

```text
GridTracker2.exe --gt-name=HF
GridTracker2.exe --gt-name=VHF
```

On Windows, add the option to a copy of the GridTracker2 shortcut (right-click it, choose **Properties**, and add it at the end of **Target**). Each copy has its own data folder and settings: set each one's UDP port to match its WSJT-X, and in Settings → Logging → **App Log(s)**, untick the logs another copy uses.

## Updates

GridTracker2 checks for a new version shortly after it starts and then once a day. A new version downloads by itself; the message list then shows **Install and Restart**, which saves your settings, installs the update and restarts GridTracker2. The About tab in Settings shows the same. With `--disable-auto-updates`, the message list shows an **About** button instead: click **Download** in Settings → About first.
