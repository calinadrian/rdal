// Reports M / Escape presses made while the game window is focused (the overlay's fallback when the game's map
// panel cannot be read, and a hint to look for it). The keyboard state is polled rather than hooked: a low-level
// keyboard hook puts this process in the path of every key the game gets, and any pause here (a garbage
// collection, a busy pipe to the app) would delay the player's input.
using System.Runtime.InteropServices;

namespace Dumper;

public static class KeyWatch
{
    const int VK_ESCAPE = 0x1B, VK_M = 0x4D;

    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    // Whether the game window has the keyboard (not alt-tabbed away).
    public static bool GameFocused(int gamePid) => GetWindowThreadProcessId(GetForegroundWindow(), out var pid) != 0 && pid == gamePid;

    static bool Down(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    // A tap lasts well over the 25 ms between looks, so presses are not missed.
    public static void Start(int gamePid, Action<string> onKey)
    {
        var t = new Thread(() =>
        {
            bool m = Down(VK_M), esc = Down(VK_ESCAPE);
            while (true)
            {
                Thread.Sleep(25);
                bool m2 = Down(VK_M), esc2 = Down(VK_ESCAPE);
                if ((m2 && !m) || (esc2 && !esc))
                    if (GameFocused(gamePid)) onKey(m2 && !m ? "M" : "Escape");
                m = m2; esc = esc2;
            }
        }) { IsBackground = true, Priority = ThreadPriority.AboveNormal };
        t.Start();
    }
}
