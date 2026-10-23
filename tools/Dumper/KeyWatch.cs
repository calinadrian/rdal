// Reports M / Escape presses made while the game window is focused (the overlay's fallback when the game's map
// panel cannot be read, and a hint to look for it). Keys are always passed on to the game unchanged.
using System.Runtime.InteropServices;

namespace Dumper;

public static class KeyWatch
{
    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100;
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string? name);

    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

    static HookProc? _proc; // kept alive for the hook's lifetime

    // Whether the game window has the keyboard (not alt-tabbed away).
    public static bool GameFocused(int gamePid) => GetWindowThreadProcessId(GetForegroundWindow(), out var pid) != 0 && pid == gamePid;

    public static void Start(int gamePid, Action<string> onKey)
    {
        var t = new Thread(() =>
        {
            _proc = (code, wParam, lParam) =>
            {
                if (code >= 0 && wParam == new IntPtr(WM_KEYDOWN))
                {
                    int vk = Marshal.ReadInt32(lParam);
                    if ((vk == 0x4D || vk == 0x1B) && GameFocused(gamePid))
                        onKey(vk == 0x4D ? "M" : "Escape");
                }
                return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
            };
            SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
            while (GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { }
        }) { IsBackground = true };
        t.Start();
    }
}
