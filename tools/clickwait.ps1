# Wait until he clicks inside a rectangle (screen pixels). Exits 0 on his click, 1 on timeout.
# Reads the mouse button's state only; nothing is hooked or blocked.
param([int]$x1, [int]$y1, [int]$x2, [int]$y2, [int]$seconds = 600)
# Real pixels on every machine: without this, Windows may scale what this script sees at 125-150%.
Add-Type -Namespace Glass -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Glass.Dpi]::SetProcessDPIAware()
Add-Type @"
using System; using System.Runtime.InteropServices;
public class CW { [StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p); }
"@
$end = (Get-Date).AddSeconds($seconds); $was = $false
while ((Get-Date) -lt $end) {
  $down = ([CW]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  if ($was -and -not $down) {
    $p = New-Object CW+PT; [CW]::GetCursorPos([ref]$p) | Out-Null
    if ($p.x -ge $x1 -and $p.x -le $x2 -and $p.y -ge $y1 -and $p.y -le $y2) { 'clicked'; exit 0 }
  }
  $was = $down; Start-Sleep -Milliseconds 40
}
'timeout'; exit 1
