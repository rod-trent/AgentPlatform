; installer.nsh — custom NSIS hooks for AI Agent Platform
; Included automatically by electron-builder via nsis.include

; ── Finish page: "Run at Windows startup" checkbox ───────────────────────────
; Reuses MUI2's built-in SHOWREADME checkbox mechanism — no custom dialog needed.

!macro customHeader
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Run AI Agent Platform at Windows startup"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION _AddStartupEntry

  Function _AddStartupEntry
    WriteRegStr HKCU \
      "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
      "AI Agent Platform" \
      '"$INSTDIR\AI Agent Platform.exe"'
  FunctionEnd
!macroend

; ── Uninstall: remove the startup entry if present ───────────────────────────
!macro customUnInstall
  DeleteRegValue HKCU \
    "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" \
    "AI Agent Platform"
!macroend
