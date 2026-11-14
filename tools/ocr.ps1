# Read the words in a picture with Windows' own OCR (local, nothing leaves the PC).
# Prints one JSON object: { lines: [ { text, words: [ { text, x, y, w, h } ] } ] } in the picture's pixels.
param([string]$path, [string]$crop = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8  # accented words came back garbled without it (the public Den's cold test, Nov 13)
# A second, sharper look at one spot (-crop "x,y,w,h"): cut it out, grey it, stretch the contrast, and make it 3x bigger.
# It reads text the plain pass misses, like white-on-blue selected text. Word boxes come back in the crop's pixels.
if ($crop) {
  Add-Type -AssemblyName System.Drawing
  $c = $crop -split ',' | ForEach-Object { [int]$_ }; $k = 3
  $src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $path).Path)
  $out = New-Object System.Drawing.Bitmap ($c[2] * $k), ($c[3] * $k)
  $g = [System.Drawing.Graphics]::FromImage($out); $g.InterpolationMode = 'HighQualityBicubic'
  $m = New-Object System.Drawing.Imaging.ColorMatrix; $f = 1.6; $o = -0.25
  foreach ($i in 0..2) { $m.Item(0, $i) = 0.299 * $f; $m.Item(1, $i) = 0.587 * $f; $m.Item(2, $i) = 0.114 * $f; $m.Item(4, $i) = $o }
  $ia = New-Object System.Drawing.Imaging.ImageAttributes; $ia.SetColorMatrix($m)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $out.Width, $out.Height), $c[0], $c[1], $c[2], $c[3], 'Pixel', $ia)
  $g.Dispose(); $src.Dispose()
  $path = Join-Path $env:TEMP ('glass-crop-' + [guid]::NewGuid() + '.png'); $out.Save($path); $out.Dispose()
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $path).Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = foreach ($l in $result.Lines) {
  [pscustomobject]@{ text = $l.Text; words = @(foreach ($w in $l.Words) { $r = $w.BoundingRect; $d = $(if ($crop) { 3 } else { 1 }); [pscustomobject]@{ text = $w.Text; x = [int]($r.X / $d); y = [int]($r.Y / $d); w = [int]($r.Width / $d); h = [int]($r.Height / $d) } }) }
}
$stream.Dispose()
if ($crop) { Remove-Item $path -ErrorAction SilentlyContinue }
[pscustomobject]@{ lines = @($lines) } | ConvertTo-Json -Depth 5 -Compress
