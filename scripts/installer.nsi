; AuroraCraft 极光启动器 - NSIS 图形化安装程序
; 使用 makensis 编译：makensis /V2 scripts\installer.nsi

Unicode true

!define APP_NAME        "AuroraCraft"
!define APP_NAME_CN     "极光启动器"
!define APP_PUBLISHER   "AuroraCraft"
!define APP_EXE         "AuroraCraft.exe"
!define APP_ID          "AuroraCraft"
!define APP_REGKEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

!ifndef APP_VERSION
  !define APP_VERSION "1.0.0"
!endif
!ifndef SOURCE_DIR
  !define SOURCE_DIR "..\dist\AuroraCraft"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "..\release\AuroraCraft-Setup-${APP_VERSION}.exe"
!endif
!ifndef ICON_FILE
  !define ICON_FILE "..\build\icon.ico"
!endif

Name "${APP_NAME_CN} ${APP_VERSION}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "${APP_NAME_CN} 安装程序"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName"     "${APP_NAME_CN}"
VIAddVersionKey /LANG=2052 "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME_CN} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion"     "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright"  "Copyright (C) 2026 ${APP_PUBLISHER}"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON   "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ${APP_NAME_CN}"
!define MUI_FINISHPAGE_LINK "项目说明（README）"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\README.md"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ; 已安装则提示
  ReadRegStr $0 HKCU "${APP_REGKEY}" "UninstallString"
  StrCmp $0 "" done
  MessageBox MB_YESNO|MB_ICONQUESTION "${APP_NAME_CN} 似乎已经安装过。$\r$\n是否继续安装（将覆盖现有文件）？" IDYES done
  Abort
done:
FunctionEnd

Section "主程序" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; 主程序与运行时
  File /r "${SOURCE_DIR}\*.*"

  ; 快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME_CN}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME_CN}\${APP_NAME_CN}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$DESKTOP\${APP_NAME_CN}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; 卸载信息
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${APP_NAME_CN}\卸载 ${APP_NAME_CN}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${APP_REGKEY}" "DisplayName"     "${APP_NAME_CN} (${APP_NAME})"
  WriteRegStr HKCU "${APP_REGKEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "${APP_REGKEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "${APP_REGKEY}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${APP_REGKEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "${APP_REGKEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
  WriteRegStr HKCU "${APP_REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${APP_REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_REGKEY}" "NoRepair" 1

  ; 估算占用体积
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${APP_REGKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME_CN}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME_CN}"

  DeleteRegKey HKCU "${APP_REGKEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"

  ; 结束正在运行的进程，避免文件占用
  ExecWait 'taskkill /F /IM ${APP_EXE}'

  RMDir /r "$INSTDIR"
SectionEnd
