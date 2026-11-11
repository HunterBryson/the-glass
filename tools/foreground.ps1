# Prints the app in front and its window title each time either changes (one line per change: name, a tab, the title).
# The glass uses it to know when his Snipping Tool is up (so it lets go of the mouse while he snips), and to know
# what's in front of him, so a chat of mine can see it with his next message (Nov 10).
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$last = ''
while ($true) {
  $h = [Fg]::GetForegroundWindow(); $procId = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
  $n = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
  $sb = New-Object System.Text.StringBuilder 512; [void][Fg]::GetWindowText($h, $sb, 512)
  $line = $n + "`t" + ($sb.ToString() -replace "[`t`r`n]", ' ')
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Milliseconds 150
}
