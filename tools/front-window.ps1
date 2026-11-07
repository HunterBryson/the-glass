# Bring a window whose title contains $Match to the front, filling one of his screens.
# Usage: powershell -File front-window.ps1 -Match "Hunter and Odie" -Screen second
param([string]$Match, [string]$Screen = 'second')
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int ht, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$found = $null
[Win]::EnumWindows({ param($h, $l)
  if ([Win]::IsWindowVisible($h)) { $sb = New-Object Text.StringBuilder 512; [void][Win]::GetWindowText($h, $sb, 512); if ($sb.ToString() -like "*$Match*") { $script:found = $h; $script:title = $sb.ToString(); return $false } }
  return $true }, [IntPtr]::Zero) | Out-Null
if (-not $found) { "no window with '$Match'"; exit 1 }
$x = if ($Screen -eq 'second') { 1920 } else { 0 }
[Win]::ShowWindow($found, 9) | Out-Null
[Win]::SetWindowPos($found, [IntPtr]::Zero, $x, 0, 1920, 1040, 0x40) | Out-Null
[Win]::SetForegroundWindow($found) | Out-Null
"front: $title"
