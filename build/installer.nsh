!include "MUI2.nsh"

!macro preInit

  ; Unofficial WoARM build: only for a silent update (electron-updater runs the installer with /S --updated). Not for the
  ; silent run electron-builder makes at build time to write the uninstaller, nor a scripted /S install: on a machine with no
  ; desktop (GitHub's runners) the banner can't show and the installer hangs
  ${if} ${Silent}
  ${andIf} ${isUpdated}
    Banner::show /set 76 "Please wait..." "Installing update"
  ${endIf}

!macroEnd

!macro customInstall

  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" '~ GDIDPISCALING DPIUNAWARE'

!macroEnd