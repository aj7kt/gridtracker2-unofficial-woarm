!["GridTracker Logo](/img/GridTracker_logo.png)

# GridTracker v1.21.1212
## An Amateur Radio Companion

Dec 12th, 2021

## General Information

This is the last release of 2021 and includes an overhaul of the Call Roster code so that additional fixes and improvements can be more easily made in early 2022. Additionally this version may see some performance improvements when the Call Roster has a lot of decodes to display.

## Program Update

### Bug Fixes
- Fix Issue #76, completed CQ and ITU Zone ignores in the Call Roster
- Improved handling of stations not in a valid DXCC (ie /MM stations).
- Improved handling of free text messages decoded that don’t contain a valid callsign (“MRRY XMAS” and “HI JOE” type messages), so they no longer are displayed in the Call Roster.

### Enhancements
- Fix Issue #107, asking that the Call Roster support smaller max age so only a single FT4 cycle can be kept on the call roster (reduced min from 15 to 5 seconds).
- Fix issue #91, asking that CQ highlighting in the Call Roster be enabled even when “CQ Only” is checked.
- Change how uncertain counties are displayed in the call roster using ? Symbols instead of ~. Also improve the hover over tool-tip when hovering over those entries instructing the user to click to do a lookup to show the county listed in the lookup service.
- Call Roster code refactored for performance and to make future improvments and fixes easier.


GridTracker is:\
Copyright © 1998-2020 by Stephen ‘Tag’ Loomis\
Copyright © 2020-2022 by GridTracker.org\
All rights reserved.\
GridTracker uses the OSS compliant [BSD 3 Clause License](https://gitlab.com/gridtracker.org/gridtracker/-/blob/master/LICENSE)\
Source code is available at GitLab: https://gitlab.com/gridtracker.org/gridtracker