# Prints the name of the app in front each time it changes (one line per change). The glass uses it to know when
# his Snipping Tool is up, so it can let go of the mouse while he snips.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$last = ''
while ($true) {
  $h = [Fg]::GetForegroundWindow(); $procId = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
  $n = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
  if ($n -ne $last) { [Console]::Out.WriteLine($n); [Console]::Out.Flush(); $last = $n }
  Start-Sleep -Milliseconds 150
}
