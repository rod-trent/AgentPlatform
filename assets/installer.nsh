; installer.nsh — custom NSIS hooks for AI Agent Platform
; Included automatically by electron-builder via nsis.include

; "Run at startup" is managed entirely from within the app (Settings toggle).
; The installer simply cleans up the registry entry on uninstall.

; ── Uninstall: remove the startup entry if present ───────────────────────────
!macro customUnInstall
  DeleteRegValue HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\Run" "AI Agent Platform"
!macroend
