# Submitting Bug Reports

## Is It a Bug?

First check whether it is really a bug, or a setting that is easy to overlook while you are chasing that rare DX:

* Read [FAQ and Troubleshooting](FAQ-Troubleshooting.md).
* Search our [Discord server](https://discord.gg/gridtracker) for earlier discussions.
* Look through the [GitLab issues](https://gitlab.com/gridtracker.org/gridtracker2/-/issues) to see whether it has already been reported.
* Make sure you are running the latest version (Settings → About).

## It Is a Bug!

Open a new issue on [GitLab](https://gitlab.com/gridtracker.org/gridtracker2/-/issues). The issue form asks for:

```markdown
## Summary
(Summarize the bug concisely)

## Version
(From Settings -> About. Please check the bug still happens in the latest version first.)

## Operating System and Platform
(Be specific, e.g. "Windows 11 24H2", "macOS 15 Sequoia", "Debian Bookworm, kernel 6.11.6".
Linux users, please include the output of: uname -r)

## Steps to reproduce
(How we can make it happen - this is very important)

## What is the current bug behavior?
(What actually happens)

## What is the expected correct behavior?
(What you should see instead)

## Relevant logs and/or screenshots
(Paste logs in code blocks (```), and attach screenshots)

## Possible fixes
(If you can, link to the line of code that might be responsible)
```

Please fill it in as completely as you can. Useful attachments:

* a screenshot: **Ctrl+K** copies the main window to the clipboard and saves it in the Screenshots folder;
* the error log, `main.log`, from the `logs` folder in GridTracker2's data folder (see [Files, Folders and Command-Line Options](GridTracker-File-Storage.md)).

Everyone on the development team is notified of new issues, and a note is posted on our Discord server, although it may take a while to reply.
