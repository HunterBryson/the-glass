# How far the page under each mark has scrolled, so a mark on the glass can follow its words (Nov 10, his test:
# the chat scrolled and my underline stayed behind, under the wrong words).
# The glass tells it what to watch, one line per window on stdin each time that changes:
#   <hwnd> <key>:<x1>,<x2>,<y1>,<y2>;<key>:...      (a box per thread, relative to the window's visible top-left)
#   <hwnd>                                          (stop watching that window)
# It looks only at the window in front of him. A few times a second it copies just that window (PrintWindow: the
# window's own picture, so the glass isn't in it), turns the columns under each mark into row fingerprints, and finds
# where the stretch of page around the mark went. Not the whole window: a chat scrolls while its prompt box stays put.
# Prints {"h":<hwnd>,"k":"<key>","dy":<pixels>} when the page under a mark moved. Reads pixels only; changes nothing.
param([int]$ms = 200)
$ErrorActionPreference = "Stop" # if my code can't load, quit (the glass starts me again later) instead of spinning on errors
Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Scroll {
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RC { public int l, t, r, b; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RC rc);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RC v, int size);
  public static long Fg() { return GetForegroundWindow().ToInt64(); }
  // Lines from the glass, read on their own thread (PowerShell 5's ReadLineAsync blocks, which froze the loop).
  static System.Collections.Concurrent.ConcurrentQueue<string> inbox = new System.Collections.Concurrent.ConcurrentQueue<string>();
  public static bool Closed = false, Dbg = false; public static string Snap = null; static DateTime snapAt = DateTime.MinValue;
  public static void Listen() { var t = new System.Threading.Thread(() => { string l; while ((l = Console.In.ReadLine()) != null) inbox.Enqueue(l); Closed = true; }); t.IsBackground = true; t.Start(); }
  public static string Next() { string l; return inbox.TryDequeue(out l) ? l : null; }
  // Row fingerprints over columns x1..x2 for the whole height: how much brightness changes along each row, in K slices
  // across. One number per row made lookalike stretches of text match each other (Nov 10: a mark jumped 784 px down
  // in our chat); four slices tell them apart.
  const int K = 4;
  static float[] Rows(byte[] px, int stride, int W, int H, int offX, int offY, int x1, int x2) {
    x1 = Math.Max(1, x1 + offX); x2 = Math.Min(W - 3, x2 + offX); if (x2 - x1 < 16) return null;
    int rows = H - offY; var r = new float[rows * K]; int cw = (x2 - x1) / K;
    for (int y = offY; y < H; y++) { int row = y * stride;
      for (int c = 0; c < K; c++) { float s = 0; int a = x1 + c * cw, b = a + cw;
        for (int x = a; x < b; x += 2) { int i = row + x * 4, j = i + 8; s += Math.Abs((px[i] + px[i+1] + px[i+2]) - (px[j] + px[j+1] + px[j+2])); }
        r[(y - offY) * K + c] = s / Math.Max(1, cw / 2); } }
    return r;
  }
  // Each mark keeps a snapshot of the page around it (its rows' fingerprints). Every tick I look for that snapshot
  // in the new picture: where it is now is where the mark goes. Not frame to frame, so a mark that scrolls out of
  // sight is found again when it scrolls back. The worst quarter of rows is ignored, so a fixed header or a new
  // line typed inside the stretch doesn't spoil the match.
  static Dictionary<string, float[]> tpl = new Dictionary<string, float[]>();
  static Dictionary<string, bool> lost = new Dictionary<string, bool>();
  static Dictionary<string, int> pads = new Dictionary<string, int>();
  const int PAD = 60;
  // t and b are rows x K; top is in rows. n = rows compared.
  static double Err(float[] t, float[] b, int top, out int n) {
    int tr = t.Length / K, br = b.Length / K; var d = new List<double>(tr); int busy = 0;
    for (int i = 0; i < tr; i++) { int y = top + i; if (y < 0 || y >= br) continue; double e = 0; bool bz = false;
      for (int c = 0; c < K; c++) { e += Math.Abs(t[i * K + c] - b[y * K + c]); if (t[i * K + c] > 1) bz = true; }
      d.Add(e / K); if (bz) busy++; }
    n = d.Count; if (n < tr * 0.4 || busy < 6) return double.MaxValue;
    d.Sort(); int k = Math.Max(1, (int)(n * 0.75)); double s = 0; for (int i = 0; i < k; i++) s += d[i]; return s / k;
  }
  static int RowsOf(float[] t) { return t.Length / K; }
  static bool Busy(float[] t) { int b = 0; for (int i = 0; i < t.Length; i += K) { for (int c = 0; c < K; c++) if (t[i + c] > 1) { b++; break; } } return b >= 10; }
  static float[] Slice(float[] r, int y1, int y2) { int rows = r.Length / K; y1 = Math.Max(0, y1); y2 = Math.Min(rows, y2); if (y2 - y1 < 20) return null; var t = new float[(y2 - y1) * K]; Array.Copy(r, y1 * K, t, 0, t.Length); return t; }
  // boxes: key -> [x1,x2,y1,y2]. Returns lines to print; moves each box by what it found.
  public static string Tick(long hwnd, Dictionary<string, int[]> boxes) {
    var h = new IntPtr(hwnd); if (IsIconic(h)) return null;
    RC wr; GetWindowRect(h, out wr); RC fr; if (DwmGetWindowAttribute(h, 9, out fr, 16) != 0) fr = wr;
    int W = wr.r - wr.l, H = wr.b - wr.t; if (W < 40 || H < 40) return null;
    int offX = fr.l - wr.l, offY = fr.t - wr.t;
    byte[] px; int stride;
    using (var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) { var dc = g.GetHdc(); bool ok = PrintWindow(h, dc, 2); g.ReleaseHdc(dc); if (!ok) return null; }
      var d = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      stride = d.Stride; px = new byte[stride * H]; Marshal.Copy(d.Scan0, px, 0, px.Length); bmp.UnlockBits(d);
      if (Snap != null && (DateTime.Now - snapAt).TotalSeconds > 5) { snapAt = DateTime.Now; try { bmp.Save(Snap + DateTime.Now.ToString("HHmmss") + ".png"); } catch {} }
    }
    var sb = new System.Text.StringBuilder(); var rowsBy = new Dictionary<string, float[]>();
    foreach (var kv in boxes) {
      var bx = kv.Value; string col = hwnd + ":" + bx[0] + ":" + bx[1];
      float[] cur; if (!rowsBy.TryGetValue(col, out cur)) { cur = Rows(px, stride, W, H, offX, offY, bx[0], bx[1]); rowsBy[col] = cur; }
      if (cur == null) continue;
      var box = kv.Value; string key = hwnd + ":" + kv.Key;
      float[] t; int n;
      if (!tpl.TryGetValue(key, out t)) {
        int p0 = Math.Min(PAD, Math.Max(0, box[2])); t = Slice(cur, box[2] - p0, box[3] + PAD);
        if (t != null && Busy(t)) { tpl[key] = t; pads[key] = p0; } continue;
      }
      int top = box[2] - pads[key];
      double eh = Err(t, cur, top, out n);
      if (Dbg && eh < 1.2) sb.Append("dbg " + kv.Key + " here eh=" + eh.ToString("F2") + "\n");
      int tr = RowsOf(t), cr = RowsOf(cur);
      if (eh < 1.2) { if (lost.Remove(key)) sb.Append("{\"h\":" + hwnd + ",\"k\":\"" + kv.Key + "\",\"dy\":0}\n"); if (n == tr) tpl[key] = Slice(cur, top, top + tr) ?? t; continue; } // still here
      // Best fit, and the best fit somewhere else (more than 12 rows away). Only an unambiguous match moves a mark.
      var errs = new double[2 * cr + 1];
      double best = double.MaxValue; int bs = 0;
      for (int s = -cr; s <= cr; s++) { double e = Err(t, cur, top + s, out n); errs[s + cr] = e; if (e < best) { best = e; bs = s; } }
      double second = double.MaxValue; for (int s = -cr; s <= cr; s++) if (Math.Abs(s - bs) > 12 && errs[s + cr] < second) second = errs[s + cr];
      if (Dbg) sb.Append("dbg " + kv.Key + " eh=" + eh.ToString("F2") + " best=" + best.ToString("F2") + " at " + bs + " second=" + (second > 1e9 ? "-" : second.ToString("F2")) + "\n");
      if (bs != 0 && best < 1.5 && best < eh * 0.5 && second > best + 2.0) {
        box[2] += bs; box[3] += bs; lost.Remove(key);
        sb.Append("{\"h\":" + hwnd + ",\"k\":\"" + kv.Key + "\",\"dy\":" + bs + "}\n");
        int n2; if (Err(t, cur, top + bs, out n2) < 1.2 && n2 == tr) tpl[key] = Slice(cur, top + bs, top + bs + tr) ?? t;
      } else if (bs == 0 || (best < 1.5 && second <= best + 2.0)) {
        // Changed in place (our chat rewrites its lines), or two spots fit equally: stay put. Learn the new look if it's still here.
        int n3; if (Err(t, cur, top, out n3) < 4 && n3 == tr) tpl[key] = Slice(cur, top, top + tr) ?? t;
      } else if (!lost.ContainsKey(key)) { lost[key] = true; sb.Append("{\"h\":" + hwnd + ",\"k\":\"" + kv.Key + "\",\"lost\":1}\n"); }
    }
    return sb.ToString();
  }
}
"@
$watch = @{}  # hwnd -> Dictionary key -> int[4]
$ErrorActionPreference = "Continue"
[Scroll]::Listen(); if ($env:SCROLL_DEBUG) { [Scroll]::Dbg = $true }; if ($env:SCROLL_SNAP) { [Scroll]::Snap = $env:SCROLL_SNAP }
while ($true) {
  while ($null -ne ($l = [Scroll]::Next())) {
    $p = $l.Trim() -split ' ', 2
    if ($p.Count -eq 2 -and $p[1]) {
      $d = New-Object 'System.Collections.Generic.Dictionary[string,int[]]'
      foreach ($e in $p[1] -split ';') { $kv = $e -split ':', 2; if ($kv.Count -eq 2) { $d[$kv[0]] = [int[]]($kv[1] -split ',') } }
      $watch[[int64]$p[0]] = $d
    } elseif ($p[0]) { $watch.Remove([int64]$p[0]) }
  }
  if ([Scroll]::Closed) { exit } # the glass went away
  $fg = [Scroll]::Fg()
  if ($watch.ContainsKey($fg)) {
    try { $o = [Scroll]::Tick($fg, $watch[$fg]); if ($o) { [Console]::Out.Write($o); [Console]::Out.Flush() } } catch {}
  }
  Start-Sleep -Milliseconds $ms
}
