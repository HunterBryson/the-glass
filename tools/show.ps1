# Puts a web page full screen on one of their screens, in one step, so the AI can mark it with the glass.
#   show.ps1 -Url https://example.com -Screen main|second
# A full URL opens as-is; a local file path opens as a file. It opens its own app window (Chrome, or Edge), maximized, in front.
# Full screen matters: if they maximize it themselves after the AI marked it, the marks no longer sit on their words.
param([Parameter(Mandatory)][string]$Url, [string]$Screen = 'main')
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Show {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static List<long> Chromes() {
    var l = new List<long>();
    EnumWindows((h, p) => { var s = new StringBuilder(64); GetClassName(h, s, 64);
      if (IsWindowVisible(h) && s.ToString() == "Chrome_WidgetWin_1") l.Add(h.ToInt64()); return true; }, IntPtr.Zero);
    return l; }
}
"@
if ($Url -notmatch '^[a-z]+://') { $Url = 'file:///' + (Resolve-Path $Url).Path.Replace('\', '/') }
Add-Type -AssemblyName System.Windows.Forms
$all = [System.Windows.Forms.Screen]::AllScreens
$scr = if ($Screen -eq 'second') { $all | ? { -not $_.Primary } | Select-Object -First 1 } else { [System.Windows.Forms.Screen]::PrimaryScreen }
if (-not $scr) { "there is no second screen"; exit 1 }
$x = $scr.Bounds.X; $y = $scr.Bounds.Y
$before = [Show]::Chromes()
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | ? { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { "no Chrome or Edge found"; exit 1 }
Start-Process -FilePath $chrome -ArgumentList "--app=$Url", "--window-position=$($x+100),$($y+100)", '--window-size=1400,850'
$h = $null
for ($i = 0; $i -lt 40 -and -not $h; $i++) {
  Start-Sleep -Milliseconds 150
  $new = [Show]::Chromes() | ? { $before -notcontains $_ }
  if ($new) { $h = [IntPtr]([long]@($new)[0]) }
}
if (-not $h) { "no new window appeared"; exit 1 }
[Show]::SetWindowPos($h, [IntPtr]::Zero, $x + 100, $y + 100, 1400, 850, 0x0004) | Out-Null
[Show]::ShowWindow($h, 3) | Out-Null
[Show]::SetForegroundWindow($h) | Out-Null
"full screen on $Screen ($Url)"
