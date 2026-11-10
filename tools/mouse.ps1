# My hands on his real mouse, for testing a gesture from his side before I hand it to him (the puck drag, Nov 9).
# Screen pixels, same as the glass: main 0..1919, second 1920..3839.
#   mouse.ps1 move x y
#   mouse.ps1 hover x y [ms]            move there and rest (opens hover menus)
#   mouse.ps1 click x y [right]
#   mouse.ps1 drag x1 y1 x2 y2 [steps]  press, glide, let go, the way a hand does
#   mouse.ps1 where                     where the cursor is now
# It puts the cursor back where it found it unless -stay is passed, so his hand isn't left somewhere strange.
$cmd = $args[0]; $stay = $args -contains '-stay'
$n = @($args | Select-Object -Skip 1 | Where-Object { $_ -as [double] -ne $null } | ForEach-Object { [double]$_ })
Add-Type -Namespace OdieMouse -Name M -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int i);
[StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
'@
$p = New-Object OdieMouse.M+P; [void][OdieMouse.M]::GetCursorPos([ref]$p); $back = $p
function Go($x, $y) { [void][OdieMouse.M]::SetCursorPos([int]$x, [int]$y) }
function Arrive($x, $y) { Go ($x - 6) ($y - 6); Start-Sleep -m 120; Go $x $y; Start-Sleep -m 250 }  # a small approach, so hover fires
switch ($cmd) {
  'where' { "$($p.X),$($p.Y)"; return }
  'move'  { Go $n[0] $n[1]; $stay = $true }
  'hover' { Arrive $n[0] $n[1]; Start-Sleep -m ([int]($(if ($n.Count -gt 2) { $n[2] } else { 900 }))); $stay = $true }
  'click' { Arrive $n[0] $n[1]; if ($args -contains 'right') { [OdieMouse.M]::mouse_event(8,0,0,0,0); [OdieMouse.M]::mouse_event(16,0,0,0,0) } else { [OdieMouse.M]::mouse_event(2,0,0,0,0); Start-Sleep -m 60; [OdieMouse.M]::mouse_event(4,0,0,0,0) } }
  'drag'  {
    $steps = if ($n.Count -gt 4) { [int]$n[4] } else { 30 }
    Arrive $n[0] $n[1]; [OdieMouse.M]::mouse_event(2,0,0,0,0); Start-Sleep -m 120
    for ($i = 1; $i -le $steps; $i++) { Go ($n[0] + ($n[2] - $n[0]) * $i / $steps) ($n[1] + ($n[3] - $n[1]) * $i / $steps); Start-Sleep -m 20 }
    Start-Sleep -m 120; [OdieMouse.M]::mouse_event(4,0,0,0,0); Start-Sleep -m 250
  }
  default { 'mouse.ps1 move|hover|click|drag|where'; return }
}
if (-not $stay) { Start-Sleep -m 300; Go $back.X $back.Y }
"done ($cmd)"
