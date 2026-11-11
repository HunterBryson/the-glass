# The windows on his screens, top to bottom, printed as one JSON line each time they change.
# The glass uses it so a mark lives on the window it was drawn on: it rides along when the window moves,
# and hides when another window covers it or the window is minimized (Nov 10).
# Reads positions only (EnumWindows, DWM frame bounds); hooks nothing, changes nothing.
# Each line: {"fg":<hwnd>,"w":[[hwnd,x1,y1,x2,y2],...]}  (topmost first; the glass's own windows left out)
param([int]$skipPid = 0, [int]$ms = 150, [switch]$once)
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Wins {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int l, t, r, b; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RC rc);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RC v, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  public static string Snap(uint skip) {
    var sb = new StringBuilder(); bool first = true;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x20) != 0 || (ex & 0x80) != 0) return true; // click-through overlays, tool windows
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true; // other desktops, hidden UWP
      uint pid; GetWindowThreadProcessId(h, out pid); if (pid == skip) return true;
      RC r; if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) GetWindowRect(h, out r);
      if (r.r - r.l < 40 || r.b - r.t < 30) return true;
      sb.Append(first ? "" : ",").Append("[").Append(h.ToInt64()).Append(",").Append(r.l).Append(",").Append(r.t).Append(",").Append(r.r).Append(",").Append(r.b).Append("]");
      first = false; return true; }, IntPtr.Zero);
    return "{\"fg\":" + GetForegroundWindow().ToInt64() + ",\"w\":[" + sb + "]}";
  }
}
"@
if ($once) { [Console]::Out.WriteLine([Wins]::Snap([uint32]$skipPid)); exit }
$last = ''
while ($true) {
  $s = [Wins]::Snap([uint32]$skipPid)
  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  Start-Sleep -Milliseconds $ms
}
