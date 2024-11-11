## **Windows**

1. Download the latest version from [https://gridtracker.org/downloads/](https://gridtracker.org/downloads/) being sure to use the file link under Windows. Save the file to your Downloads directory and then double click on `GridTracker-Installer.<verion>.exe` to start the installation process. \
\
You may be prompted with a “User Access Control” dialog. If so, click the **Yes** button to continue. 

!["Windows UAC prompt to launch GridTracker installer"](/img/GT_InstallWin_UAC.png) 

2. Click **Next** to continue.

![](/img/GT_InstallWin_Wiz1.png)

3. GridTracker will present the default installation location. It is recommended that you use this, but you may select path if desired, but clicking the **Browse…** button. \
\
Click **Install** to continue.

![](/img/GT_InstallWin_Wiz2.png)

4. When the installation finishes click **Next** to continue.

![](/img/GT_InstallWin_Wiz3.png)

5. The installation is now complete. Click **Finish** to close the installer and launch GridTracker for the first time. \
\
You may uncheck “Launch GridTracker now” if you do not want to launch it after clicking the **Finish** button.

![](/img/GT_InstallWin_Wiz4.png)

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.


## **MacOS**

1. Download the latest version from [https://gridtracker.org/downloads/](https://gridtracker.org/downloads/)\
\
Open a Finder window and navigate to the place that the download is in; likely the Downloads directory. It may need to be unzipped (double click the zip file) or your browser may have already done that for you.\
\
Once you have the GridTracker.app, drag it to your Applications folder:

![](/img/GT_InstallMac_DragToApps.png)

2. Next you need to open the Applications folder, **Command-Click** GridTracker, then Click **Open**. \
\
MacOS will present a security warning allowing you to decide to override system security settings, click **Open**. You should not see this warning after this.

> Screen grab needed for MAC system security override screen.

3. And another asking permission for notifications.

![](/img/GT_InstallMac_Network.png)

You will get two more pop-ups after the program has been running, one to allow incoming network traffic:

4. And another asking permission for notifications.

![](/img/GT_InstallMac_Notifications.png)

You will want to Allow network notifications, and it is up to you if you want to Allow the Notifications.

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.

## **Linux Intel/AMD Archs**

### Redhat based distros

GridTracker is now available for most RPM Package Managers on Fedora COPR! 

```bash
sudo dnf copr enable nr0q/GridTracker
sudo dnf install gridtracker
```
Then to do updates
```bash
sudo dnf upgrade gridtracker
```

Or download the repo file for you system [here](https://copr.fedorainfracloud.org/coprs/nr0q/GridTracker/), and use your package manager to install / update GridTracker

You should now find the GridTracker icon in your Window Manager's applications menu.

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.

### Debian based distros

Ubuntu 20.04.1 LTS depends on libatomic1 and GridTracker will not run without it being installed. To install libatomic1 in your command line

```bash
$ sudo apt-get install libatomic1
```
For all Debian based systems, NWJS is packaged seperately from GridTracker and can be installed using the nwjs-downloader package that must be downloaded [here](https://fleetwood.mchambersradio.com/gridtracker/nwjs-downloader/v0.59.0-6/nwjs-downloader_0.59.0-6_all.deb) until it is eventually added to the Debian repos. After download install it using apt

```bash
$ sudo apt intall nwjs-downloader_0.59.0-6_all.deb
```

Then download the latest version DEB package from [https://gridtracker.org/downloads/](https://gridtracker.org/downloads/). 

```bash
$ sudo apt install gridtracker_1.21.1212_all.deb
```

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.

### Arch linux

```bash
$ git clone https://aur.archlinux.org/gridtracker.git
$ cd gridtracker
$ makepkg -sri
```
or
```bash
$ yay -S gridtracker
```
That's it :thinking:

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.

### All other Linuxes
(or using the tar.gz packge)

Download the tar.gz package for your architecture from [https://gridtracker.org/downloads/](https://gridtracker.org/downloads/), decompress and execute the GridTracker exectuable from the decompressed directory.

```bash
$ tar -xf GridTracker-<version>-linux-<arch>.tar.gz
```

Run the GridTracker executable from the now decompressed package directory.

## **Linux ARM / Raspberry Pi - OdroidIn**

If running a Debian based Raspbery Pi distro, you can use the method for [Debian based distros](Appendices/appendix-a-Installing-GridTracker#debian-based-distros), otherwise use the instructions for [All other linuxes](Appendices/appendix-a-Installing-GridTracker#all-other-linuxes)

Proceed to the [Configuring WSJT-X and JTDX for GridTracker](Appendices/appendix-b-Configuring-WSJT-X-and-JTDX-for-GridTracker) section for next steps.