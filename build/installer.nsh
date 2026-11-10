!macro customInstall
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "DisplayName" "다스캔"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "Publisher" "Dascan"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "DisplayIcon" "$INSTDIR\다스캔.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "UninstallString" '$\"$INSTDIR\Uninstall 다스캔.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "QuietUninstallString" '$\"$INSTDIR\Uninstall 다스캔.exe$\" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan" "NoRepair" 1
!macroend

!macro customUnInstall
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Dascan"
!macroend
