# Foreground changes are independent of the player's position/tracker availability.
param([int]$AtlasPid)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AtlasForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
$last = ''
$previousWindow = [IntPtr]::Zero
while ($true) {
    $foregroundWindow = [AtlasForeground]::GetForegroundWindow()
    if ($foregroundWindow -eq $previousWindow) { Start-Sleep -Milliseconds 100; continue }
    $previousWindow = $foregroundWindow
    $foregroundPid = [uint32]0
    [void][AtlasForeground]::GetWindowThreadProcessId($foregroundWindow, [ref]$foregroundPid)
    $name = if ($foregroundPid) { (Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue).ProcessName } else { '' }
    $next = [ordered]@{
        game = $name -in @('RSDragonwilds-WinGDK-Shipping', 'RSDragonwilds-Win64-Shipping')
        atlas = $foregroundPid -eq $AtlasPid
    } | ConvertTo-Json -Compress
    if ($next -ne $last) { [Console]::Out.WriteLine($next); $last = $next }
    Start-Sleep -Milliseconds 100
}
