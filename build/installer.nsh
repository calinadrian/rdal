; Older clients install on normal quit with --updated /S but omit --force-run.
; The standard one-click installer only relaunches silent installs with --force-run.
; Cover that missing case here; leave its existing explicit-update launch intact.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${Silent}
  ${andIfNot} ${isForceRun}
    ; StartApp declares a global variable on expansion, so it cannot be inserted
    ; here as well as in the standard installer. Use its same user-shell launch.
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${endIf}
!macroend
