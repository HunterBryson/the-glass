# What window is under each point? Points as "x,y;x,y". Prints JSON: [ { x, y, app, title } ].
# The glass is click-through, so the window found is the one he's actually looking at.
param([string]$points)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class Wh { [StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }
"@
$out = foreach ($pt in ($points -split ';' | Where-Object { $_ })) {
  $x, $y = $pt -split ','; $p = New-Object Wh+PT; $p.x = [int]$x; $p.y = [int]$y
  $h = [Wh]::GetAncestor([Wh]::WindowFromPoint($p), 2)
  $sb = New-Object System.Text.StringBuilder 512; [Wh]::GetWindowText($h, $sb, 512) | Out-Null
  $procId = 0; [Wh]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  $app = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
  [pscustomobject]@{ x = [int]$x; y = [int]$y; app = $app; title = $sb.ToString() }
}
ConvertTo-Json -InputObject @($out) -Compress
