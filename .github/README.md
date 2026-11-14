# GridTracker2 Unofficial WoARM

**Unofficial** builds of [GridTracker2](https://gridtracker.org/) for **Windows on ARM** (Snapdragon and other ARM64 PCs), running natively instead of under x64 emulation.

These builds are **not made, signed or supported by GridTracker.org** or the GridTracker2 team.

- **Downloads:** this repository's **Releases** (on the right of its main page). Windows SmartScreen warns about the installer because it is unsigned: choose **More info**, then **Run anyway**.
- **The official GridTracker2** (Windows x64 and 32-bit, macOS, Linux) is at [gridtracker.org/downloads](https://gridtracker.org/downloads/). Its source is at [gitlab.com/gridtracker.org/gridtracker2](https://gitlab.com/gridtracker.org/gridtracker2).
- **Problems with these builds** go in this repository's **Issues**, not to the GridTracker2 team, unless the same problem also happens in the official GridTracker2.

## How it differs from the official GridTracker2

- It is the official source plus two commits: Windows on ARM support (offered to the GridTracker2 team for the official installer), and the one for this build, which makes the changes below and builds it here ([electron-builder.github.yml](../electron-builder.github.yml), [the workflow](workflows/windows-arm64.yml)).
- It installs as **GridTracker2 Unofficial WoARM**, beside the official app rather than over it, and says so in its title bar. It keeps its own settings and logs in `%APPDATA%\GridTracker2 Unofficial WoARM`. To bring over your settings from the official app, copy the contents of `%APPDATA%\GridTracker2` there while both apps are closed.
- It updates itself from this repository's releases.
- It names itself to the online services it uses as **GridTracker2-Unofficial-WoARM** (its User-Agent, the program name in QSOs it uploads to eQSL and LoTW and in QRZCQ and HamQTH lookups, `GT2-WoARM` as the source of POTA spots it posts, `gridtracker-woarm` to HamCQ, and `GT2-WoARM_` to start its PSK Reporter MQTT client id), so its traffic isn't taken for the official app's.

## Hosted here instead of on GridTracker.org's servers

This build doesn't use the servers of GridTracker.org or its developer for what it downloads by itself:

- **Reference data** (country prefixes, Club Log's OQRS list, US county and Canadian province data, Parks on the Air parks) comes from this repository's GitHub Pages site: copies of GridTracker.org's files.

## Disabled or left out

The code for these is still there, only switched off, so this build stays close to the official source:

- **Off-Air Services** (GridTracker2's own online service, `oams.space`) is off and can't be turned on; its Settings checkbox is hidden. So are the features that work through it: spotting other GridTracker2 users and showing them on the map, Band Activity, DX Feeds (DX Cluster and CW Skimmer spots in the Feed Roster), and the Kp index on the Conditions button.
- **Prediction overlays** MUF, foF2, EPI and AUF are left out of the map's prediction button (their images come from the GridTracker2 developer's server). Tropo remains.
- **The City Lights by NASA map** is left out of the map list (its tiles come from the same server).
- **Sending QSOs to Club Log as you log them** is left out: it needs GridTracker's own Club Log application key, which this build doesn't ship. Downloading your Club Log log (with your own login) still works.
- **CARTO maps** (Voyager, Positron, Dark Matter) need your own CARTO API key: the official app bundles GridTracker.org's, this build has none. Pick a CARTO map and enter yours in **Settings → Map → API Key**. Without one, its tiles say "API KEY REQUIRED".

## Other online services

Like the official app, it uses third-party services: map tiles, PSK Reporter, Parks on the Air, the LoTW and eQSL user lists, callook.info lookups, and the solar images in Current Conditions, plus any you set up yourself (QRZ, Club Log, LoTW and other logbooks, push notifications).

## License

GridTracker2 is BSD 3-Clause licensed; see [LICENSE](../LICENSE). The copyright holders and contributors listed there don't endorse these builds.
