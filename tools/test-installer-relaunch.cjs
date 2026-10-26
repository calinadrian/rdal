// Execute the production NSIS restart hook in a harmless installer harness.
// The harness records StartApp calls; it never installs or launches AtlasLoot.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const compiler = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
const dir = path.join(root, 'cache', `installer-relaunch-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });
const exe = path.join(dir, 'relaunch-test.exe'), marker = path.join(dir, 'launches.txt');
const script = path.join(dir, 'test.nsi');
fs.writeFileSync(script, `
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "AtlasLoot relaunch test"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
Var updated
Var forced
Var parameters
Var launchLink
!define isUpdated '$updated == "1"'
!define isForceRun '$forced == "1"'
!define StdUtils.ExecShellAsUser '!insertmacro RecordStart'
!macro RecordStart RESULT LINK ACTION ARGS
  FileOpen $R1 "${marker}" a
  FileWrite $R1 "launch$\\r$\\n"
  FileClose $R1
!macroend
!macro StartApp
  Var /GLOBAL startAppArgs
  FileOpen $R1 "${marker}" a
  FileWrite $R1 "launch$\\r$\\n"
  FileClose $R1
!macroend
!include "${path.join(root, 'build/installer.nsh')}"
Function .onInit
  StrCpy $updated "0"
  StrCpy $forced "0"
  \${GetParameters} $parameters
  ClearErrors
  \${GetOptions} $parameters "--updated" $R0
  \${IfNot} \${Errors}
    StrCpy $updated "1"
  \${EndIf}
  ClearErrors
  \${GetOptions} $parameters "--force-run" $R0
  \${IfNot} \${Errors}
    StrCpy $forced "1"
  \${EndIf}
FunctionEnd
Section
  !insertmacro customInstall
  ; The standard one-click template handles explicit forced updates itself.
  \${If} \${isForceRun}
    !insertmacro StartApp
  \${EndIf}
SectionEnd
`);
const build = spawnSync(compiler, ['/V2', script], { encoding: 'utf8', windowsHide: true });
assert.equal(build.status, 0, build.stderr + build.stdout);
for (const [args, expected, label] of [
  [['/S', '--updated'], 0, 'update installed on normal quit leaves the app closed'],
  [['/S', '--updated', '--force-run'], 1, 'explicit Update now without duplicate launch'],
  [['/S'], 0, 'unrelated silent install'],
]) {
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  const run = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  const launches = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/).filter(Boolean).length : 0;
  assert.equal(launches, expected, label);
  console.log(`PASS: ${label} (${launches} launch)`);
}
