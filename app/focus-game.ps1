# Explicitly return keyboard input to the game after the user hides AtlasLoot.
param([switch]$CloseMap)
$ErrorActionPreference = 'Stop'
$game = Get-Process -Name 'RSDragonwilds-WinGDK-Shipping', 'RSDragonwilds-Win64-Shipping' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $game) { if ($CloseMap) { exit 1 }; exit 0 }

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class AtlasGameFocus {
    [StructLayout(LayoutKind.Sequential)] struct GUIThreadInfo {
        public uint size, flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public int left, top, right, bottom;
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIThreadInfo info);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardInput {
        public ushort key, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit, Size = 40)] struct Input {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KeyboardInput keyboard;
    }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
    public static bool CloseMap(IntPtr hwnd) {
        if (GetForegroundWindow() != hwnd) return false;
        // One ordinary M press, only after the game owns the keyboard and shortcut modifiers are up.
        var inputs = new[] {
            new Input { type = 1, keyboard = new KeyboardInput { scan = 0x32, flags = 0x8 } },
            new Input { type = 1, keyboard = new KeyboardInput { scan = 0x32, flags = 0xA } }
        };
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) != 2) return false;
        Thread.Sleep(150); // Let the game consume both events before the overlay takes focus.
        return true;
    }
    public static bool Activate(IntPtr hwnd) {
        // The shortcut fires on key-down. Transfer focus after its modifiers are released,
        // otherwise the game can receive only part of the Ctrl/Shift/Alt key sequence.
        for (int i = 0; i < 100 && ModifiersDown(); i++) Thread.Sleep(15);
        for (int attempt = 0; attempt < 3; attempt++) {
            if (ActivateOnce(hwnd)) return true;
            Thread.Sleep(50);
        }
        return false;
    }
    static bool ModifiersDown() {
        foreach (int key in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }
    static bool ActivateOnce(IntPtr hwnd) {
        uint pid;
        uint current = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        uint target = GetWindowThreadProcessId(hwnd, out pid);
        if (target == 0) return false;
        bool attachedForeground = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        bool attachedTarget = target != current && target != foreground && AttachThreadInput(current, target, true);
        try {
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
            SetActiveWindow(hwnd);
            SetFocus(hwnd); // Foreground activation alone can leave keyboard focus unset.
        } finally {
            if (attachedTarget) AttachThreadInput(current, target, false);
            if (attachedForeground) AttachThreadInput(current, foreground, false);
        }
        // Check the game's input queue after detaching, not our temporarily shared queue.
        var info = new GUIThreadInfo { size = (uint)Marshal.SizeOf(typeof(GUIThreadInfo)) };
        return GetForegroundWindow() == hwnd && GetGUIThreadInfo(target, ref info) && info.focus == hwnd;
    }
}
'@
if (-not [AtlasGameFocus]::Activate($game.MainWindowHandle)) { exit 1 }
if ($CloseMap -and -not [AtlasGameFocus]::CloseMap($game.MainWindowHandle)) { exit 1 }
