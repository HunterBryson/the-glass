# Find buttons, links, fields and tabs on his screen by their name (Windows UI Automation: what screen readers use).
# Prints JSON: [ { name, type, x, y, w, h, window, app } ], visible ones only, front windows first.
param([string]$name, [string]$app = '', [int]$max = 8)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$root = $A::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$cond = New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)
$out = New-Object System.Collections.ArrayList
foreach ($w in $wins) {
  if ($out.Count -ge $max) { break }
  try {
    $c = $w.Current
    if ($c.IsOffscreen -or -not $c.Name) { continue }
    $proc = try { (Get-Process -Id $c.ProcessId -ErrorAction Stop).ProcessName } catch { '' }
    if ($proc -match '^electron$' -and $c.Name -eq 'The glass') { continue }
    if ($app -and $proc -notlike "*$app*" -and $c.Name -notlike "*$app*") { continue }
    foreach ($e in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) {
      $ec = $e.Current; $r = $ec.BoundingRectangle
      if ($ec.IsOffscreen -or $r.Width -le 0 -or $r.Height -le 0 -or [double]::IsInfinity($r.X)) { continue }
      $type = $ec.ControlType.ProgrammaticName -replace 'ControlType\.', ''
      [void]$out.Add([pscustomobject]@{ name = $ec.Name; type = $type; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height; window = $c.Name; app = $proc })
      if ($out.Count -ge $max) { break }
    }
  } catch { }
}
ConvertTo-Json -InputObject @($out) -Compress
