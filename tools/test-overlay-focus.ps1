# Run on the interactive Windows desktop. Uses a separate process to verify keyboard delivery.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class FocusTestKeys {
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    public static void PressW() {
        keybd_event(0x57, 0x11, 0, UIntPtr.Zero);
        keybd_event(0x57, 0x11, 2, UIntPtr.Zero);
    }
    public static void HoldShortcutBriefly() {
        keybd_event(0x11, 0x1D, 0, UIntPtr.Zero);
        keybd_event(0x10, 0x2A, 0, UIntPtr.Zero);
        new Thread(() => { Thread.Sleep(250); ReleaseShortcut(); }).Start();
    }
    public static void ReleaseShortcut() {
        keybd_event(0x10, 0x2A, 2, UIntPtr.Zero);
        keybd_event(0x11, 0x1D, 2, UIntPtr.Zero);
    }
}
'@
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('atlas-focus-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testDir | Out-Null
$targetScript = Join-Path $testDir 'target.ps1'
$targetCode = @'
param($Report)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms @"
using System;
using System.IO;
using System.Windows.Forms;
public class FocusTargetForm : Form {
    public string Report;
    int keys;
    protected override void WndProc(ref Message message) {
        if (message.Msg == 0x100 && message.WParam.ToInt32() == 0x57)
            File.WriteAllText(Report, (++keys).ToString());
        base.WndProc(ref message);
    }
}
"@
$form = New-Object FocusTargetForm
$form.Text = 'AtlasLoot keyboard focus test'
$form.Report = $Report
$form.Add_Shown({
    [IO.File]::WriteAllText($Report + '.hwnd', $form.Handle.ToInt64().ToString())
    [IO.File]::WriteAllText($Report, '0')
})
[System.Windows.Forms.Application]::Run($form)
'@
Set-Content -LiteralPath $targetScript -Value $targetCode
$report = Join-Path $testDir 'keys.txt'
$targetProcess = $null
$overlayWindow = New-Object System.Windows.Forms.Form
$overlayWindow.Text = 'AtlasLoot overlay test'
try {
    $targetProcess = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
        '-NoProfile', '-STA', '-File', ('"' + $targetScript + '"'), '-Report', ('"' + $report + '"'))
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path $report)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Target window did not start' }
        Start-Sleep -Milliseconds 50
    }
    # Substitute only game discovery; run the production activation and verification unchanged.
    function Get-Process {
        return [pscustomobject]@{ MainWindowHandle = [IntPtr]([long][IO.File]::ReadAllText($report + '.hwnd')) }
    }
    for ($cycle = 1; $cycle -le 10; $cycle++) {
        $overlayWindow.Show()
        $overlayWindow.Activate()
        [System.Windows.Forms.Application]::DoEvents()
        $overlayWindow.Hide()
        if ($cycle -eq 2) { [FocusTestKeys]::HoldShortcutBriefly() }
        $handoffTime = [Diagnostics.Stopwatch]::StartNew()
        $global:LASTEXITCODE = 0
        & (Join-Path $PSScriptRoot '../app/focus-game.ps1')
        if ($LASTEXITCODE -ne 0) { throw "Focus verification failed in cycle $cycle" }
        if (-not ('AtlasGameFocus' -as [type])) { throw 'Helper skipped activation: no target window found' }
        if ($cycle -eq 2 -and $handoffTime.ElapsedMilliseconds -lt 150) { throw 'Handoff did not wait for shortcut release' }
        [FocusTestKeys]::PressW()
        $deadline = [DateTime]::UtcNow.AddSeconds(2)
        while ([int][IO.File]::ReadAllText($report) -lt $cycle) {
            if ([DateTime]::UtcNow -gt $deadline) { throw "W did not reach target in cycle $cycle" }
            Start-Sleep -Milliseconds 20
        }
    }
    Write-Output 'PASS: 10 overlay hide cycles restore foreground AND keyboard focus; held Ctrl+Shift is released before handoff; W reaches a separate target process every time'
} finally {
    [FocusTestKeys]::ReleaseShortcut()
    Remove-Item Function:\Get-Process -ErrorAction SilentlyContinue
    $overlayWindow.Dispose()
    if ($targetProcess -and -not $targetProcess.HasExited) { $targetProcess.Kill(); $targetProcess.WaitForExit() }
    foreach ($testFile in @($targetScript, $report, ($report + '.hwnd'))) { Remove-Item -LiteralPath $testFile -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $testDir -ErrorAction SilentlyContinue
}
