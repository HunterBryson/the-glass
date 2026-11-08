// The glass: a see-through layer over each of Hunter's screens that Odie and he both draw on.
// Clicks pass through to whatever is underneath, except on the puck or while his pen is on.
// Odie drives it over HTTP on 127.0.0.1:7931 (tools/glass.js is the friendly way in).
// One window per screen: Windows keeps a window to one display, so one big window loses the second screen.
const { app, BrowserWindow, screen, ipcMain, desktopCapturer, nativeImage, globalShortcut } = require('electron');
// The glass sits over everything and is never focused, so Windows can count it as covered and Chromium stops painting
// and slows its timers (my cursor stayed parked on his words, Nov 7). Keep it live.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.GLASS_PORT) || 7931;
// Two parts are wired to our own setup and stay off unless you point them somewhere (see README, "Optional parts"):
// GLASS_DEN_URL: a workspace that takes dropped marks (the buttons call it the Den).
// GLASS_EAR_DIR: a local speech-to-text folder with .venv and dump_transcribe.py (ours was the Ear). Windows dictation (Win+H) works in the note box without it.
const DEN_ON = !!process.env.GLASS_DEN_URL, EAR_ON = !!process.env.GLASS_EAR_DIR;
const hideOff = w => w && !w.isDestroyed() && w.webContents.executeJavaScript(`for (const id of [${[!DEN_ON && "'den'", !DEN_ON && "'t-den'", !EAR_ON && "'mic'"].filter(Boolean).join(',')}]) document.getElementById(id)?.remove();`).catch(() => {});
// The AI's name on its cards, the puck and the note box (GLASS_NAME). Ours is Odie.
const AI_NAME = process.env.GLASS_NAME || 'Claude';
const DATA = path.join(__dirname, 'data');
const SHOTS = path.join(DATA, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
// Screenshots older than three days go, so his disk doesn't fill (his sends keep their words in events.jsonl).
try { const cut = Date.now() - 3 * 864e5; for (const f of fs.readdirSync(SHOTS)) { const p = path.join(SHOTS, f); if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p); } } catch {}

if (!app.requestSingleInstanceLock()) app.quit();

// A trail, so a freeze or crash can be read afterwards.
const trail = m => fs.appendFile(path.join(DATA, 'glass.log'), `${new Date().toISOString()} ${m}\n`, () => {});
process.on('uncaughtException', e => trail('main error: ' + (e.stack || e)));
trail('glass starting');

let panes = []; // { win, d (display), primary }
let active = null; // the pane my cursor is on
let puck = null, mode = 'off';
// Test switches, so a freeze can be pinned to one part.
const LEVEL = process.env.GLASS_LEVEL || 'screen-saver'; // screen-saver | floating | none
const WITH_PUCK = process.env.GLASS_PUCK !== '0';
const FOCUSABLE = process.env.GLASS_FOCUSABLE === '1';
const top = w => { if (LEVEL === 'none') w.setAlwaysOnTop(false); else w.setAlwaysOnTop(true, LEVEL); };
const PUCK = { w: 64, closed: 64, open: 760, right: 16, bottom: 70 };
const events = [];
let seq = 0;
const waiters = [];

function log(e) {
  e.n = ++seq; e.at = new Date().toISOString();
  events.push(e); if (events.length > 500) events.shift();
  fs.appendFile(path.join(DATA, 'events.jsonl'), JSON.stringify(e) + '\n', () => {});
  // Wake only who was waiting before this event. (Draining in a loop let a waiter re-queue itself forever: the day-one freeze.)
  if (e.who === 'hunter' && e.op === 'send' && !e.error) unread.push(e);
  waiters.splice(0).forEach(w => w());
  linkSay(true);
}

// Delivery: a send stays unread until a chat of mine takes it, so nothing he sends is skipped (Nov 7).
// delivered.json holds the time of the last send I received; it outlives restarts (seq doesn't).
const DELIVERED = path.join(DATA, 'delivered.json');
let delivered;
try { delivered = JSON.parse(fs.readFileSync(DELIVERED, 'utf8')).at; } catch { delivered = new Date().toISOString(); fs.writeFileSync(DELIVERED, JSON.stringify({ at: delivered })); }
let unread = [];
try {
  unread = fs.readFileSync(path.join(DATA, 'events.jsonl'), 'utf8').split(String.fromCharCode(10)).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && e.who === 'hunter' && e.op === 'send' && !e.error && e.at > delivered);
} catch {}
let lastAck = 0;
function ack(at) {
  if (at && at > delivered) { delivered = at; fs.writeFile(DELIVERED, JSON.stringify({ at: delivered }), () => {}); }
  unread = unread.filter(e => e.at > delivered); lastAck = Date.now(); linkSay(true);
}

// Am I connected? on: a watch of mine is waiting. busy: no watch, but I took a send in the last 15 minutes
// (I'm reading or answering). off: nobody is listening. The puck shows it, so he can see it at a glance.
let lastWaiting = 0, lastLink = '';
const link = () => waiters.length > 0 || Date.now() - lastWaiting < 20000 ? 'on' : Date.now() - lastAck < 15 * 60000 ? 'busy' : 'off';
function linkSay(force) {
  const s = { state: link(), unread: unread.length }, k = JSON.stringify(s);
  if (!force && k === lastLink) return;
  lastLink = k;
  if (puck && !puck.isDestroyed()) { puck.webContents.send('link', s); sizePuck(); }
}
setInterval(() => linkSay(false), 2000);

function displaysInfo() {
  const p = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map(d => ({ id: d.id, primary: d.id === p.id, bounds: d.bounds, scale: d.scaleFactor }));
}

function build() {
  panes.forEach(p => { if (!p.win.isDestroyed()) p.win.destroy(); });
  const prim = screen.getPrimaryDisplay();
  panes = screen.getAllDisplays().map(d => {
    const win = new BrowserWindow({
      ...d.bounds, transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, show: false,
      skipTaskbar: true, focusable: FOCUSABLE, alwaysOnTop: LEVEL !== 'none', fullscreenable: false, backgroundColor: '#00000000',
      // The glass is never the focused window, so Chromium would slow its timers; it needs them on time (my cursor's fade).
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    top(win);
    // Clicks pass through, but the glass feels the mouse go by, so it can catch it over a note he wants to grab.
    // (The day-one freeze was my waiter loop, proven Nov 7, not this.)
    win.setIgnoreMouseEvents(true, { forward: true });
    // Visible to his own screenshots (Snipping Tool, Win+Shift+S): it hides only for the instant I take a clean read.
    win.setContentProtection(false);
    win.webContents.on('did-finish-load', () => win.webContents.send('style', style));
    win.loadFile(path.join(__dirname, 'glass.html'), { query: { ai: AI_NAME } });
    const pane = { win, d, primary: d.id === prim.id };
    win.webContents.on('did-finish-load', () => {
      win.setBounds(d.bounds); win.showInactive();
      win.webContents.send('setup', { origin: { x: d.bounds.x, y: d.bounds.y }, size: { width: d.bounds.width, height: d.bounds.height } });
      if (puck && !puck.isDestroyed()) puck.moveTop();
    });
    watchWin(win, `glass ${pane.primary ? 'main' : 'second'}`);
    return pane;
  });
  active = panes.find(p => p.primary) || panes[0];
  if (WITH_PUCK) buildPuck(prim);
}

function watchWin(win, name) {
  win.on('unresponsive', () => trail(`${name} stopped responding`));
  win.on('responsive', () => trail(`${name} responding again`));
  win.webContents.on('render-process-gone', (_e, d) => trail(`${name} renderer gone: ${d.reason}`));
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) trail(`${name} console: ${msg}`); });
}

function puckBounds(prim, open) {
  const h = open ? PUCK.open : PUCK.closed, b = prim.workArea;
  const wide = lastLink && JSON.parse(lastLink).state !== 'on' || unread.length > 0;
  const w = open ? 260 : wide ? 340 : PUCK.w; return { x: b.x + b.width - w - PUCK.right, y: b.y + b.height - h - PUCK.bottom + 40, width: w, height: h };
}

function buildPuck(prim) {
  if (puck && !puck.isDestroyed()) puck.destroy();
  puck = new BrowserWindow({
    ...puckBounds(prim, false), transparent: true, frame: false, resizable: false, movable: false, hasShadow: false, show: false,
    skipTaskbar: true, focusable: FOCUSABLE, alwaysOnTop: LEVEL !== 'none', fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  top(puck);
  puck.setContentProtection(false);
  puck.webContents.on('did-finish-load', () => puck && !puck.isDestroyed() && puck.webContents.send('style', style));
  puck.loadFile(path.join(__dirname, 'puck.html'), { query: { ai: AI_NAME } }).then(() => hideOff(puck));
  puck.webContents.on('did-finish-load', () => { puck.showInactive(); puck.moveTop(); linkSay(true); });
  watchWin(puck, 'puck');
}

const paneOf = wc => panes.find(p => p.win.webContents === wc);

// His marks gather here and reach me only when he presses send.
let pending = [];
// A Keep counts as something waiting for ➤ too, so ➤ lights up after a Keep even when no new mark is up (Nov 7: "I cant submit a turn").
let keptWaiting = 0;
const puckSay = () => { if (puck && !puck.isDestroyed()) puck.webContents.send('pending', pending.length + keptWaiting); };

// His pen's color and size. A color is a meaning, so his mark says what he thinks before his words do.
let style = { color: 'blue', size: 1, step: 1 };
const sayStyle = () => { for (const p of panes) p.win.webContents.send('style', style); if (puck && !puck.isDestroyed()) puck.webContents.send('style', style); };
ipcMain.on('style', (_e, s) => { style = { ...style, ...s }; sayStyle(); sayLegend(); });
// Areas he hid: painted out of every picture the glass takes, so they never reach me (screen pixels).
let hides = [];
const meets = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
// Paint every hidden area that falls on this display into a picture of it (bounds = that picture's screen rectangle).
function paintHides(img, bounds, list = hides) {
  const W = img.getSize().width, H = img.getSize().height, sx = W / bounds.width, sy = H / bounds.height;
  const mine = list.map(h => h.box || h).filter(b => meets(b, { x1: bounds.x, y1: bounds.y, x2: bounds.x + bounds.width, y2: bounds.y + bounds.height }));
  if (!mine.length) return img;
  const buf = img.toBitmap();
  for (const b of mine) {
    const x1 = Math.max(0, Math.floor((b.x1 - bounds.x) * sx)), x2 = Math.min(W, Math.ceil((b.x2 - bounds.x) * sx)), y1 = Math.max(0, Math.floor((b.y1 - bounds.y) * sy)), y2 = Math.min(H, Math.ceil((b.y2 - bounds.y) * sy));
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { const k = (y * W + x) * 4; buf[k] = 0x18; buf[k + 1] = 0x14; buf[k + 2] = 0x12; buf[k + 3] = 255; }
  }
  return nativeImage.createFromBitmap(buf, { width: W, height: H });
}
// A new hidden area also goes into every picture already saved, so nothing from before it was drawn is left to open.
function paintSaved(box) {
  const ds = screen.getAllDisplays(), prim = screen.getPrimaryDisplay();
  for (const f of fs.readdirSync(SHOTS)) {
    if (!f.endsWith('.png')) continue;
    const p = path.join(SHOTS, f), m = f.match(/-(main|second)(-clean)?\.png$/);
    // Anything that isn't a whole-screen picture (crops, test frames) can't be mapped back to the screen, so it goes.
    if (!m) { fs.unlink(p, () => {}); continue; }
    const d = m[1] === 'main' ? prim : ds.find(x => x.id !== prim.id); if (!d || !meets(box, { x1: d.bounds.x, y1: d.bounds.y, x2: d.bounds.x + d.bounds.width, y2: d.bounds.y + d.bounds.height })) continue;
    try { fs.writeFileSync(p, paintHides(nativeImage.createFromPath(p), d.bounds, [box]).toPNG()); } catch (e) { trail('paint saved failed: ' + e); }
  }
}
function setMode(m) {
  mode = ['pen', 'box', 'ellipse', 'arrow', 'hl', 'step', 'hide', 'note'].includes(m) ? m : 'off'; caught.clear();
  for (const p of panes) {
    // Never make the glass focusable: on Windows that costs it its see-through (it went dark over his whole screen).
    p.win.setIgnoreMouseEvents(mode === 'off', { forward: true });
    p.win.webContents.send('mode', mode);
  }
  if (puck && !puck.isDestroyed()) { puck.webContents.send('mode', mode); puck.moveTop(); }
  sayLegend();
  log({ who: 'hunter', op: 'mode', mode });
}

// His keys (Nov 7 night, after the mouse app wouldn't keep a bind: "give me a keybind I can use on my keyboard easily").
// Left hand only: thumb on Alt, fingers on the keys beside it. Heard system-wide without the glass taking focus.
// Pressing a tool's key again turns it off. Picked to dodge Firefox's Alt menus (F E V S B T H), Chrome's Alt+D
// and NVIDIA's Alt+Z.
// Second layout, from his first real use: "alt+5 is impossible to it. alt +4 is unreliable. Alt + 1-3 is alright even
// thoguht its a stretch." So the tools sit on the home row under his fingers. These take over Chrome's Alt+D and
// Firefox's Alt+F/Alt+S menus everywhere; Ctrl+L still reaches the address bar. Alt+Z stays NVIDIA's.
const KEYS = { 'Alt+A': 'pen', 'Alt+S': 'box', 'Alt+D': 'ellipse', 'Alt+F': 'hl', 'Alt+V': 'arrow',
  'Alt+X': 'off', 'Alt+C': 'color', 'Alt+W': 'undo', 'Alt+Q': 'send', 'Alt+E': 'clear', 'Alt+K': 'legend' };
// His ask the same night: "where is my key to clear the glass? ... I need to have this keybind box up all the time".
// Clear is Alt+E. The key list stays up by the puck (drag it anywhere; it remembers), and Alt+K hides or
// shows it. It lights the tool that's on and shows the pen's color, so it's also how he sees what a key just did.
const KEY_NAMES = { pen: 'pen', box: 'box', ellipse: 'circle', hl: 'highlighter', arrow: 'arrow', off: 'tool off',
  color: 'color', undo: 'undo', send: 'send ➤', clear: 'clear glass', legend: 'hide this list' };
const SWATCH = { blue: '#6cc6ff', red: '#ff5a5a', green: '#3fb950', yellow: '#ffe14d' };
let legend = null, legendOn = true;
function legendHtml() {
  const rows = Object.entries(KEYS).map(([k, a]) => `<div class="r" data-a="${a}"><b>${k.replace('Alt+', '')}</b><span>${KEY_NAMES[a]}${a === 'color' ? ' <i id="sw"></i>' : ''}</span></div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;font-family:"Segoe UI",system-ui,sans-serif;user-select:none;overflow:hidden}
    .box{-webkit-app-region:drag;cursor:move;margin:6px;padding:10px 12px 8px;background:rgba(21,23,28,.94);border:2px solid #f5a524;border-radius:12px;color:#f4f4f2;
      box-shadow:0 0 0 3px rgba(0,0,0,.7),0 0 18px rgba(245,165,36,.3)}
    .h{font:700 12px/1 "Segoe UI";letter-spacing:.07em;text-transform:uppercase;color:#f5a524;margin:0 0 8px}
    .r{display:flex;align-items:center;gap:10px;padding:3px 4px;border-radius:6px;font-size:16px}
    .r b{display:inline-block;min-width:26px;text-align:center;padding:2px 0;border-radius:5px;background:#2a2e36;font-weight:700}
    .r.on{background:rgba(245,165,36,.22)} .r.on b{background:#f5a524;color:#15171c}
    #sw{display:inline-block;width:12px;height:12px;border-radius:50%;margin-left:4px;vertical-align:-1px}
  </style><div class="box"><div class="h">Hold Alt +</div>${rows}</div><script>
    window.show=(mode,color)=>{document.querySelectorAll('.r').forEach(r=>r.classList.toggle('on',r.dataset.a===mode));
      const s=document.getElementById('sw'); if(s) s.style.background=color;};
  </script>`;
}
function sayLegend() { if (legend && !legend.isDestroyed()) legend.webContents.executeJavaScript(`show(${JSON.stringify(mode)}, ${JSON.stringify(SWATCH[style.color] || SWATCH.blue)})`).catch(() => {}); }
// He drags it wherever he wants (his catch: "why can i not move this around buddy?"), and it stays there next time.
const LEGEND_AT = path.join(DATA, 'legend.json');
function buildLegend() {
  const b = screen.getPrimaryDisplay().workArea, w = 250, h = 52 + Object.keys(KEYS).length * 31;
  let at = { x: b.x + b.width - w - 300, y: b.y + b.height - h - 10 };
  try { const s = JSON.parse(fs.readFileSync(LEGEND_AT, 'utf8')); if (screen.getAllDisplays().some(d => s.x >= d.bounds.x - w / 2 && s.x < d.bounds.x + d.bounds.width - w / 2 && s.y >= d.bounds.y && s.y < d.bounds.y + d.bounds.height - 40)) at = s; } catch {}
  legend = new BrowserWindow({ ...at, width: w, height: h, transparent: true, frame: false,
    resizable: false, movable: true, hasShadow: false, skipTaskbar: true, focusable: false, show: false, backgroundColor: '#00000000' });
  top(legend);
  legend.on('moved', () => { const [x, y] = legend.getPosition(); fs.writeFile(LEGEND_AT, JSON.stringify({ x, y }), () => {}); });
  legend.webContents.on('did-finish-load', () => { if (legendOn) legend.showInactive(); sayLegend(); });
  legend.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(legendHtml()));
}
app.whenReady().then(buildLegend);
function key(a) {
  if (a === 'color') { const c = ['blue', 'red', 'green', 'yellow']; style = { ...style, color: c[(c.indexOf(style.color) + 1) % c.length] }; sayStyle(); }
  else if (a === 'undo' || a === 'send' || a === 'clear') ipcMain.emit(a, {});
  else if (a === 'legend') { legendOn = !legendOn; if (legend && !legend.isDestroyed()) legendOn ? legend.showInactive() : legend.hide(); }
  else setMode(a === 'off' || mode === a ? 'off' : a);
  sayLegend(); log({ who: 'hunter', op: 'key', does: a });
}
app.whenReady().then(() => { for (const [k, a] of Object.entries(KEYS)) if (!globalShortcut.register(k, () => key(a))) trail(`key taken: ${k}`); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// A note gets its own small window at the click, so the keyboard never touches the glass.
// A tied note opens beside his mark (outside it, so nothing gets covered) and travels with it.
let noteWin = null, noteAt = null;
const NOTE = { w: 280, h: 130, gap: 34 };
function closeNote() { if (noteWin && !noteWin.isDestroyed()) noteWin.destroy(); noteWin = null; }
// The dashed line from his mark to the box, live while he types or drags the box.
function draftLine(w) {
  if (!noteAt || !noteAt.tie || !w || w.isDestroyed() || w !== noteWin) return;
  const p = panes[noteAt.pane]; if (!p) return; const o = p.d.bounds, b = w.getBounds();
  run(p, { op: 'draft', id: noteAt.tie.id, rect: { x1: b.x - o.x, y1: b.y - o.y, x2: b.x + b.width - o.x, y2: b.y + b.height - o.y } }).catch(() => {});
}
let noteGrab = null;
ipcMain.on('note-drag', (_e, k, x, y) => {
  if (!noteWin || noteWin.isDestroyed()) return;
  // Screen coordinates from the page are in DIPs, same as window bounds at scale 1.
  if (k === 'start') { const b = noteWin.getBounds(); noteGrab = { ox: x - b.x, oy: y - b.y }; return; }
  if (!noteGrab) return;
  noteWin.setPosition(Math.round(x - noteGrab.ox), Math.round(y - noteGrab.oy));
  if (k === 'end') noteGrab = null;
});
ipcMain.on('note-size', (_e, h) => {
  if (!noteWin || noteWin.isDestroyed()) return;
  // Never past the edge of his screen: near the bottom, the box grows upward instead.
  const b = noteWin.getBounds(), d = screen.getDisplayMatching(b).workArea; h = Math.round(h);
  let y = b.y; if (y + h > d.y + d.height - 8) y = Math.max(d.y + 8, d.y + d.height - 8 - h);
  noteWin.setBounds({ ...b, y, height: h });
});

function openNote(paneIdx, x, y, tie) {
  const p = panes[paneIdx]; if (!p) return;
  const b = p.d.bounds, { w, h, gap } = NOTE;
  let nx = x, ny = y, side = 'free';
  if (tie) {
    const bx = tie.box; side = 'right'; nx = bx.x2 + gap; ny = bx.y1 - 6;
    if (nx + w > b.x + b.width - 10) { side = 'left'; nx = bx.x1 - gap - w; }
    if (nx < b.x + 10) { side = 'below'; nx = Math.max(b.x + 10, bx.x1); ny = bx.y2 + gap; }
  }
  nx = Math.max(b.x + 10, Math.min(nx, b.x + b.width - w - 10)); ny = Math.max(b.y + 10, Math.min(ny, b.y + b.height - h - 10));
  noteAt = { pane: paneIdx, screen: p.primary ? 'main' : 'second', x: nx, y: ny, tie, side };
  noteWin = new BrowserWindow({
    x: nx, y: ny, width: w, height: h,
    transparent: true, frame: false, resizable: false, movable: true, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  noteWin.setAlwaysOnTop(true, 'screen-saver');
  if (tie) { const w = noteWin, line = () => draftLine(w); w.on('move', line); w.on('resize', line); w.once('show', line); }
  noteWin.setContentProtection(false);
  const nw = noteWin; nw.webContents.once('did-finish-load', () => hideOff(nw));
  noteWin.loadFile(path.join(__dirname, 'note.html'), { query: { tie: tie ? '1' : '0', color: (tie && tie.color) || 'blue', ai: AI_NAME } });
  noteWin.once('ready-to-show', () => { noteWin.show(); noteWin.focus(); });
  watchWin(noteWin, 'note');
}

async function commitNote(text) {
  const at = noteAt; noteAt = null;
  // His words land where the box is now, so if he dragged it somewhere, that's where the note stays.
  if (at && noteWin && !noteWin.isDestroyed()) { const b = noteWin.getBounds(); at.x = b.x; at.y = b.y; }
  closeNote();
  if (!at || !panes[at.pane]) return;
  const o = panes[at.pane].d.bounds;
  if (at.steer != null) {
    // A steer is a note like any other: it stays on my card and waits with his marks until he presses ➤.
    // Emptied while editing: the steer is taken back.
    if (!text) { const had = pending.some(m => m.op === 'steer' && m.gid === at.steer);
      if (had) { pending = pending.filter(m => !(m.op === 'steer' && m.gid === at.steer)); puckSay(); await run(panes[at.pane], { op: 'unsteer', id: at.steer % 1000 }).catch(() => {}); }
      return; }
    const meta = proposals.get(at.steer) || {}, id = at.steer % 1000;
    pending = pending.filter(m => !(m.op === 'steer' && m.gid === at.steer)); // a new steer replaces his last one
    pending.push({ pane: at.pane, screen: at.screen, op: 'steer', id, gid: at.steer, text, file: meta.file || null }); puckSay();
    await run(panes[at.pane], { op: 'steercard', id, text }).catch(() => {});
    log({ who: 'hunter', screen: at.screen, op: 'steer', id: at.steer, text });
    return;
  }
  if (at.tie) {
    if (!text) { await run(panes[at.pane], { op: 'draft', id: at.tie.id, rect: null }); return; }
    const mark = pending.find(m => m.pane === at.pane && m.id === at.tie.id);
    if (!mark) return;
    mark.note = text;
    await run(panes[at.pane], { op: 'tienote', id: at.tie.id, text, color: mark.color, card: { x: at.x - o.x, y: at.y - o.y } });
    log({ who: 'hunter', screen: at.screen, op: 'tie', of: mark.op, id: mark.gid, text });
    return { pane: at.pane, id: at.tie.id };
  }
  if (!text) return;
  const id = await run(panes[at.pane], { op: 'hisnote', x: at.x - o.x, y: at.y - o.y, text });
  const gid = at.pane * 1000 + id;
  pending.push({ pane: at.pane, screen: at.screen, op: 'note', id, gid, text, x: at.x, y: at.y }); puckSay();
  log({ who: 'hunter', screen: at.screen, op: 'note', id: gid, text, x: at.x, y: at.y });
  return { pane: at.pane, id };
}

// If a note box is open when he moves on, keep whatever he typed in it.
async function finishNote() {
  if (!noteWin || noteWin.isDestroyed()) { noteWin = null; return; }
  let text = '';
  try { text = (await noteWin.webContents.executeJavaScript("document.getElementById('t').value")).trim(); } catch {}
  await commitNote(text);
}

ipcMain.on('note-at', async (e, x, y) => { await finishNote(); const p = paneOf(e.sender); if (p) openNote(panes.indexOf(p), x, y, null); });
ipcMain.on('note-done', (_e, text) => commitNote(text));
// ⤓ in his note box: keep his words on the mark, and send the mark to the Den.
ipcMain.on('note-den', async (_e, text) => {
  const r = await commitNote(text);
  if (!r) return;
  try { const n = await markToDen(r.pane, r.id, text); await run(panes[r.pane], { op: 'status', id: r.id, state: 'done', text: `in the Den · #${n}` }); }
  catch (err) { trail('den drop failed: ' + err); await run(panes[r.pane], { op: 'status', id: r.id, state: 'you', text: "didn't reach the Den" }).catch(() => {}); }
});

ipcMain.on('mode', (_e, m) => setMode(m));
ipcMain.on('catch', () => {}); // the cursor check below decides
// Notes are grabbable anytime: the glass knows where its notes are, checks where his cursor is 20 times a second
// (just reading its position, nothing hooked), and catches clicks only while the cursor is over a note.
const cardRects = new Map(), caught = new Set();
ipcMain.on('card-rects', (e, rects) => {
  const p = paneOf(e.sender); if (!p) return; const o = p.d.bounds;
  cardRects.set(panes.indexOf(p), rects.map(r => ({ x1: r.x1 + o.x, y1: r.y1 + o.y, x2: r.x2 + o.x, y2: r.y2 + o.y })));
});
// While his Snipping Tool is up, the glass lets go of the mouse everywhere, so a snip can be dragged across my cards
// (Nov 7 night: "I hit keep and I cant screenshot it"). A small helper reports which app is in front.
let snipping = false;
const SNIP = /^(ScreenClippingHost|SnippingTool|ScreenSketch)$/i;
function watchFront() {
  const ps = require('child_process').spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'tools', 'foreground.ps1')], { windowsHide: true });
  let buf = '';
  ps.stdout.on('data', d => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const name of lines) { const on = SNIP.test(name.trim()); if (on === snipping) continue; snipping = on;
      if (on) { caught.clear(); for (const p of panes) if (!p.win.isDestroyed()) p.win.setIgnoreMouseEvents(true, { forward: true }); }
      else if (mode !== 'off') for (const p of panes) if (!p.win.isDestroyed()) p.win.setIgnoreMouseEvents(false); } });
  ps.on('exit', () => { snipping = false; setTimeout(watchFront, 5000); });
  app.on('before-quit', () => { try { ps.kill(); } catch {} });
}
app.whenReady().then(watchFront);
setInterval(() => {
  if (snipping || mode !== 'off' || !panes.length) return;
  const c = screen.getCursorScreenPoint();
  panes.forEach((p, i) => {
    const over = (cardRects.get(i) || []).some(r => c.x >= r.x1 && c.x <= r.x2 && c.y >= r.y1 && c.y <= r.y2);
    if (over === caught.has(i) || p.win.isDestroyed()) return;
    if (over) caught.add(i); else caught.delete(i);
    p.win.setIgnoreMouseEvents(!over, { forward: true });
  });
}, 50);
// A wheel on the glass goes back to his page: the glass lets go for a moment so the next turns of the wheel scroll it.
let wheelT = null;
ipcMain.on('pass-wheel', () => {
  for (const p of panes) p.win.setIgnoreMouseEvents(true, { forward: true });
  clearTimeout(wheelT);
  wheelT = setTimeout(() => { if (mode !== 'off') for (const p of panes) p.win.setIgnoreMouseEvents(false); }, 700);
});
let puckOpen = false;
const sizePuck = () => { if (puck && !puck.isDestroyed()) puck.setBounds(puckBounds(screen.getPrimaryDisplay(), puckOpen || mode !== 'off' || pending.length > 0)); };
ipcMain.on('puck-open', (_e, on) => { puckOpen = on; sizePuck(); });
ipcMain.on('clear', async () => { for (const p of panes) await run(p, { op: 'clear', who: 'all' }); tracked.clear(); pending = []; hides = []; style.step = 1; sayStyle(); puckSay(); log({ who: 'hunter', op: 'clear' }); });
let penNoteT = null;
ipcMain.on('his', async (e, ev) => {
  const p = paneOf(e.sender), screenName = p && !p.primary ? 'second' : 'main', paneIdx = panes.indexOf(p);
  if (ev.op === 'penmore') {
    // Another stroke of the same mark: grow it, and give him a moment more before the note box opens.
    const m = pending.find(x => x.pane === paneIdx && x.id === ev.id); if (!m) return;
    m.box = ev.box; m.points = (m.points || []).concat(ev.points || []);
    if (penNoteT) { clearTimeout(penNoteT); penNoteT = setTimeout(() => { penNoteT = null; openNote(paneIdx, 0, 0, { id: ev.id, box: m.box, color: m.color }); }, 900); }
    return;
  }
  if (penNoteT) { clearTimeout(penNoteT); penNoteT = null; }
  await finishNote();
  const gid = paneIdx * 1000 + ev.id;
  if (ev.op === 'hide') { hides.push({ pane: paneIdx, id: ev.id, box: ev.box }); setImmediate(() => paintSaved(ev.box)); log({ who: 'hunter', screen: screenName, ...ev, id: gid }); return; }
  if (ev.kind === 'step') { style.step = (ev.n || style.step) + 1; sayStyle(); }
  pending.push({ pane: paneIdx, screen: screenName, ...ev, gid }); puckSay();
  log({ who: 'hunter', screen: screenName, ...ev, id: gid });
  // Every circle or ? gets a note box beside it; Esc or simply drawing on skips it.
  if (ev.op === 'pen' || ev.op === 'ask') {
    // An arrow's words go by its point, where he's pointing to.
    const box = ev.op === 'ask' ? { x1: ev.x - 17, y1: ev.y - 17, x2: ev.x + 17, y2: ev.y + 17 }
      : ev.kind === 'arrow' ? { x1: ev.to[0] - 14, y1: ev.to[1] - 14, x2: ev.to[0] + 14, y2: ev.to[1] + 14 } : ev.box;
    // A pen stroke waits a moment for the next one, so a word gets one note box, not one per letter.
    if (ev.kind === 'pen') penNoteT = setTimeout(() => { penNoteT = null; const m = pending.find(x => x.pane === paneIdx && x.id === ev.id); if (m) openNote(paneIdx, 0, 0, { id: ev.id, box: m.box, color: m.color }); }, 900);
    else openNote(paneIdx, 0, 0, { id: ev.id, box, color: ev.color });
  }
});
// He removed a note with its ✕: if it was still waiting for ➤, it doesn't go.
ipcMain.on('removed', (e, localId) => { const p = paneOf(e.sender); if (!p) return; const i = panes.indexOf(p);
  pending = pending.filter(m => !(m.pane === i && (m.id === localId || m.gid === i * 1000 + localId))); puckSay();
  hides = hides.filter(h => !(h.pane === i && h.id === localId)); log({ who: 'hunter', op: 'remove', id: i * 1000 + localId }); });
ipcMain.on('undo', async () => {
  if (noteWin) { const at = noteAt; noteAt = null; closeNote(); if (at && at.tie && panes[at.pane]) await run(panes[at.pane], { op: 'draft', id: at.tie.id, rect: null }); }
  const last = pending.pop(); puckSay();
  if (last && last.op === 'steer' && panes[last.pane]) await run(panes[last.pane], { op: 'unsteer', id: last.id });
  else if (last && panes[last.pane]) await run(panes[last.pane], { op: 'clear', id: last.id });
  log({ who: 'hunter', op: 'undo', of: last && last.op });
});
ipcMain.on('send', async () => {
  await finishNote();
  setMode('off');
  try {
    if (puck && !puck.isDestroyed()) puck.hide();
    await new Promise(r => setTimeout(r, 150));
    const screens = [...new Set(pending.map(m => m.screen))];
    const which = screens.length === 1 ? screens[0] : 'all';
    const clean = await shot(which, true);
    const shots = await shot(which);
    // What he's looking at under each mark: the app and window, so I know what it is.
    const pts = pending.map(m => m.kind === 'arrow' ? m.to.map(Math.round) : m.box ? [Math.round((m.box.x1 + m.box.x2) / 2), Math.round((m.box.y1 + m.box.y2) / 2)] : [Math.round(m.x), Math.round(m.y)]);
    const wins = await whereIs(pts);
    // A window that holds a hidden area keeps its title to itself: titles can carry what he hid (an email subject, a file name).
    pending.forEach((m, i) => { const w = wins[i]; if (!w) return; m.app = w.app;
      const win = w.x2 > w.x1 ? { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 } : null;
      m.title = (!win || hides.some(h => meets(h.box, win))) && hides.length ? '(withheld: a hidden area is in this window)' : w.title; });
    const marks = pending.map(({ pane, ...m }) => m);
    // What he just sent stays bright on the glass; older rounds step back.
    for (const [i, p] of panes.entries()) run(p, { op: 'sent', ids: pending.filter(m => m.pane === i).map(m => m.id) }).catch(() => {});
    pending = []; keptWaiting = 0; puckSay(); style.step = 1; sayStyle();
    log({ who: 'hunter', op: 'send', marks, shots: shots.map(s => s.file), clean: clean.map(s => ({ file: s.file, screen: s.screen, bounds: s.bounds })) });
  } catch (err) { log({ who: 'hunter', op: 'send', error: String(err) }); }
  finally { if (puck && !puck.isDestroyed()) { puck.showInactive(); puck.moveTop(); } }
});
ipcMain.on('drop', async (_e, title) => {
  try {
    if (puck && !puck.isDestroyed()) puck.hide();
    await new Promise(r => setTimeout(r, 150));
    const r = await dropToDen(title || 'From the glass', 'primary');
    log({ who: 'hunter', op: 'drop', ...r });
  } catch (err) { log({ who: 'hunter', op: 'drop', error: String(err) }); }
  finally { if (puck && !puck.isDestroyed()) { puck.showInactive(); puck.moveTop(); } }
});

// ---- Marks stay with what they're on ----
// While marks are up, the glass takes a small grey look at each screen (the glass itself is hidden from that look),
// finds the patch that was under each mark, and moves the whole group (mark, his words, my answer) with it.
// It never pauses for his tools or his note box. It looks fast while the screen is moving and slows when it's still.
// A mark only jumps when the match is clear; marks on the same page agree on a scroll, so a mark over plain space
// moves with the page instead of latching onto something that only looks alike. Gone off screen, it hides until it's back.
const FAST_MS = 70, IDLE_MS = 250, LOOK_W = Number(process.env.GLASS_LOOK_W || 1920), GOOD = 10, OK = 22;
const tracked = new Map(); // `${pane}:${id}` -> { pane, id, patch, pw, ph, px, py, dx, dy, fx, fy, shown, still, weak, miss }
let tracking = false, shooting = false, tick = 0, lastChange = 0;
const lastSig = new Map();
let DEBUG_FRAMES = 6;

function protect(on) {
  for (const w of [...panes.map(p => p.win), puck, noteWin]) if (w && !w.isDestroyed()) w.setContentProtection(on);
}

let lookN = 0, lookMs = 0;
async function look() {
  const t0 = Date.now(); try { return await lookNow(); } finally { lookMs += Date.now() - t0; if (++lookN % 50 === 0) { trail(`look avg ${(lookMs / 50).toFixed(0)} ms`); lookMs = 0; } }
}
async function lookNow() {
  protect(true); let sources; try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: LOOK_W, height: Math.round(LOOK_W * 9 / 16) } }); } finally { protect(false); }
  for (const src of sources) { const d = screen.getAllDisplays().find(x => String(x.id) === String(src.display_id)); if (d && hides.length) src.thumbnail = paintHides(src.thumbnail, d.bounds); }
  const out = new Map();
  screen.getAllDisplays().forEach((d, i) => {
    const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[i]; if (!src) return;
    const { width: w, height: h } = src.thumbnail.getSize(), bgra = src.thumbnail.toBitmap(), g = new Uint8Array(w * h);
    for (let k = 0, j = 0; k < g.length; k++, j += 4) g[k] = (bgra[j] * 29 + bgra[j + 1] * 150 + bgra[j + 2] * 77) >> 8;
    out.set(d.id, { w, h, g, s: w / d.bounds.width });
  });
  return out;
}

async function track(pane, id, r) {
  if (process.env.GLASS_TRACK !== '1') return; // parked Nov 7 at his word: scroll-following isn't the angle
  const p = panes[pane]; if (!p || !r) return;
  let L; try { L = (await look()).get(p.d.id); } catch (e) { trail('look failed: ' + e); return; }
  if (!L) return;
  const pad = 30, s = L.s, MW = Math.round(320 * s), MH = Math.round(150 * s);
  let x1 = Math.max(0, Math.round((r.x1 - pad) * s)), y1 = Math.max(0, Math.round((r.y1 - pad) * s));
  let x2 = Math.min(L.w, Math.round((r.x2 + pad) * s)), y2 = Math.min(L.h, Math.round((r.y2 + pad) * s));
  if (x2 - x1 > MW) { const c = (x1 + x2) >> 1; x1 = c - MW / 2; x2 = c + MW / 2; }
  if (y2 - y1 > MH) { const c = (y1 + y2) >> 1; y1 = Math.max(0, c - MH / 2); y2 = y1 + MH; }
  const pw = x2 - x1, ph = y2 - y1; if (pw < 8 || ph < 8) return;
  const patch = new Uint8Array(pw * ph); let sum = 0, sq = 0;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const v = L.g[(y1 + y) * L.w + x1 + x]; patch[y * pw + x] = v; sum += v; sq += v * v; }
  const n = pw * ph, sd = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
  // Plain space can't be found again by itself: fully plain stays put, nearly plain only moves with the page.
  // Debug: keep the patch and the screen it came from, to study a bad track afterwards.
  try { const D = path.join(DATA, 'debug'); fs.mkdirSync(D, { recursive: true });
    fs.writeFileSync(path.join(D, `p${pane}-${id}.pgm`), Buffer.concat([Buffer.from(`P5 ${pw} ${ph} 255
`), Buffer.from(patch)]));
    fs.writeFileSync(path.join(D, `p${pane}-${id}-screen.pgm`), Buffer.concat([Buffer.from(`P5 ${L.w} ${L.h} 255
`), Buffer.from(L.g)]));
    trail(`track #${pane}:${id} patch ${pw}x${ph} at ${x1},${y1} sd ${sd.toFixed(1)}`); } catch {}
  tracked.set(`${pane}:${id}`, { pane, id, patch, pw, ph, px: x1, py: y1, dx: 0, dy: 0, fx: 0, fy: 0, shown: true, still: sd < 6, weak: sd < 14, miss: 0 });
  lastChange = Date.now();
  if (!tracking) trackLoop();
}

// Mean difference of the patch placed at (ox, oy); gives up early once it can't beat `limit`.
function diff(L, t, ox, oy, step, limit = 999) {
  const cols = Math.ceil(t.pw / step), rows = Math.ceil(t.ph / step), budget = limit * cols * rows;
  let s = 0;
  for (let y = 0; y < t.ph; y += step) {
    const row = (oy + y) * L.w + ox, prow = y * t.pw;
    for (let x = 0; x < t.pw; x += step) s += Math.abs(L.g[row + x] - t.patch[prow + x]);
    if (s > budget) return 999;
  }
  return s / (cols * rows);
}
const inb = (L, t, x, y) => x >= 0 && y >= 0 && x + t.pw <= L.w && y + t.ph <= L.h;

function refine(L, t, at) {
  let fine = { d: 999 };
  for (let x = at.x - 3; x <= at.x + 3; x++) for (let y = at.y - 3; y <= at.y + 3; y++) if (inb(L, t, x, y)) { const d = diff(L, t, x, y, 1, fine.d); if (d < fine.d) fine = { d, x, y }; }
  return fine;
}

// Where is this mark's patch now? { x, y, sure } or null.
function find(L, t) {
  const cx = t.px + t.dx, cy = t.py + t.dy;
  if (inb(L, t, cx, cy) && diff(L, t, cx, cy, 2) < GOOD) return { x: cx, y: cy, sure: true };
  if (t.weak) return null; // nearly plain: only the page's scroll moves it
  // Scrolling: the same column, every height. Keep the best and the best elsewhere, to know if the match is clear.
  let best = { d: 999, y: -99 }, second = { d: 999 };
  if (inb(L, t, cx, 0)) for (let y = 0; y + t.ph <= L.h; y += 2) {
    const d = diff(L, t, cx, y, 2, second.d);
    if (d < best.d) { if (Math.abs(y - best.y) > 8) second = best; best = { d, x: cx, y }; }
    else if (d < second.d && Math.abs(y - best.y) > 8) second = { d, x: cx, y };
  }
  if (best.d <= OK * 1.3) {
    const f = refine(L, t, best);
    // A clear winner moves the mark. A close call only counts if it's near-perfect (or the page's scroll agrees, below).
    if (f.d < GOOD || (f.d <= OK && second.d - f.d > 6)) return { x: f.x, y: f.y, sure: true, d: +f.d.toFixed(1), d2: +second.d.toFixed(1), via: 'col' };
    if (f.d <= OK) return { x: f.x, y: f.y, sure: false, d: +f.d.toFixed(1), d2: +second.d.toFixed(1), via: 'col' };
  }
  // A window that moved sideways: only once the mark has gone missing, a slower look everywhere, and only a near-perfect match.
  if (t.shown || tick % 4) return null;
  best = { d: 999 };
  for (let x = 0; x + t.pw <= L.w; x += 12) for (let y = 0; y + t.ph <= L.h; y += 12) { const d = diff(L, t, x, y, 4, best.d); if (d < best.d) best = { d, x, y }; }
  if (best.d > OK) return null;
  let f = { d: 999 };
  for (let x = best.x - 6; x <= best.x + 6; x++) for (let y = best.y - 6; y <= best.y + 6; y++) if (inb(L, t, x, y)) { const d = diff(L, t, x, y, 2, f.d); if (d < f.d) f = { d, x, y }; }
  return f.d < GOOD ? { x: f.x, y: f.y, sure: true, d: +f.d.toFixed(1), via: 'coarse' } : null;
}

function moveMark(m, dx, dy, shown) {
  if (!m.base) m.base = { box: m.box && { ...m.box }, x: m.x, y: m.y };
  if (m.base.box) m.box = { x1: m.base.box.x1 + dx, y1: m.base.box.y1 + dy, x2: m.base.box.x2 + dx, y2: m.base.box.y2 + dy };
  if (m.base.x != null) { m.x = m.base.x + dx; m.y = m.base.y + dy; }
  if (shown) delete m.offscreen; else m.offscreen = true;
}

const sigOf = L => { let h = 0; for (let k = 0; k < L.g.length; k += 157) h = (h * 31 + L.g[k]) | 0; return h; };
const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

async function trackLoop() {
  tracking = true;
  while (tracked.size) {
    await new Promise(r => setTimeout(r, Date.now() - lastChange < 2500 ? FAST_MS : IDLE_MS));
    if (shooting) continue; // only while I take a picture
    tick++;
    let L; try { L = await look(); } catch (e) { trail('look failed: ' + e); continue; }
    const byPane = new Map();
    for (const t of tracked.values()) { if (!byPane.has(t.pane)) byPane.set(t.pane, []); byPane.get(t.pane).push(t); }
    for (const [pi, ts] of byPane) {
      const p = panes[pi], S = p && L.get(p.d.id); if (!S || p.win.isDestroyed()) continue;
      const sig = sigOf(S); if (lastSig.get(pi) === sig) continue; // nothing on this screen changed
      lastSig.set(pi, sig); lastChange = Date.now();
      const found = new Map(), moves = [];
      for (const t of ts) {
        if (t.still) continue;
        const f = find(S, t); found.set(t, f);
        if (f && f.sure) moves.push(f.y - t.py - t.dy);
      }
      // The page's scroll, agreed by the marks that matched clearly.
      const page = moves.length ? median(moves) : null;
      for (const t of ts) {
        if (t.still) continue;
        let f = found.get(t);
        if ((!f || !f.sure) && page !== null && page !== 0) {
          const x = t.px + t.dx, y = t.py + t.dy + page;
          if (inb(S, t, x, y) && diff(S, t, x, y, 2) < OK) f = { x, y, sure: true };
        }
        if (f && !f.sure) f = null; // a close call alone never moves a mark
        let dx = t.dx, dy = t.dy, shown = t.shown;
        if (f) { dx = f.x - t.px; dy = f.y - t.py; shown = true; t.miss = 0; }
        else if (!t.weak) { t.miss++; if (t.miss >= 3) shown = false; }
        if (shown === t.shown && dx === t.dx && dy === t.dy) continue;
        t.shown = shown; t.dx = dx; t.dy = dy;
        trail(`move #${t.pane}:${t.id} -> ${dx},${dy} shown ${shown} f ${f ? JSON.stringify(f) : 'none'} page ${page}`);
        if (DEBUG_FRAMES-- > 0) fs.writeFile(path.join(DATA, 'debug', `f${tick}.pgm`), Buffer.concat([Buffer.from(`P5 ${S.w} ${S.h} 255
`), Buffer.from(S.g)]), () => {});
        const fx = Math.round(dx / S.s), fy = Math.round(dy / S.s), mx = fx - t.fx, my = fy - t.fy; t.fx = fx; t.fy = fy;
        p.win.webContents.send('shift', { id: t.id, dx: fx, dy: fy, shown });
        for (const m of pending) if (m.pane === t.pane && m.id === t.id) moveMark(m, fx, fy, shown);
        // His open note box rides along with the mark it's tied to.
        if ((mx || my) && noteWin && !noteWin.isDestroyed() && noteAt && noteAt.tie && noteAt.pane === t.pane && noteAt.tie.id === t.id) {
          const b = noteWin.getBounds(); noteWin.setPosition(b.x + mx, b.y + my);
        }
      }
    }
  }
  tracking = false;
}

ipcMain.on('track', (e, id, r) => { const p = paneOf(e.sender); if (p) track(panes.indexOf(p), id, r); });
ipcMain.on('untrack', (e, ids) => { const p = paneOf(e.sender); if (p) for (const id of ids) tracked.delete(`${panes.indexOf(p)}:${id}`); });

// ---- Talk instead of type: his voice in a note box goes through the Ear (local, his own model) ----
const EAR = process.env.GLASS_EAR_DIR || path.join(__dirname, '..', '..', 'ear');
ipcMain.handle('note-audio', async (_e, buf) => {
  const dir = path.join(DATA, 'voice'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.webm');
  fs.writeFileSync(file, Buffer.from(buf));
  return await new Promise(resolve => {
    const py = spawn(path.join(EAR, '.venv', 'Scripts', 'python.exe'), [path.join(EAR, 'dump_transcribe.py'), file], { cwd: EAR, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { py.kill(); resolve({ error: 'The Ear took too long.' }); }, 120000);
    py.stdout.on('data', d => out += d); py.stderr.on('data', d => err += d);
    py.on('error', e => { clearTimeout(t); resolve({ error: String(e.message || e) }); });
    py.on('close', () => {
      clearTimeout(t);
      const line = out.trim().split('\n').pop();
      try { const j = JSON.parse(line); resolve(j.ok ? { text: (j.text || '').trim() } : { error: j.error || 'The Ear could not hear it.' }); }
      catch { trail('ear: ' + (err || out).slice(-400)); resolve({ error: 'The Ear did not answer.' }); }
    });
  });
});

async function shot(which = 'all', clean = false) {
  // The glass is hidden from screen captures; a picture for me shows it again, unless I want his screen clean (to read it).
  if (clean) return shotNow(which, '-clean');
  return shotNow(which);
}

async function shotNow(which = 'all', tag = '') {
  // A clean read of his screen: the glass steps out of the picture for that instant only (his catch, Nov 7: his snips came out with the glass missing).
  if (tag === '-clean') { protect(true); await new Promise(r => setTimeout(r, 60)); try { return await shotNowRaw(which, tag); } finally { protect(false); } }
  return shotNowRaw(which, tag);
}
async function shotNowRaw(which = 'all', tag = '') {
  const p = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 3840, height: 2160 } });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = [];
  screen.getAllDisplays().forEach((d, i) => {
    const isMain = d.id === p.id;
    if (which === 'main' || which === 'primary') { if (!isMain) return; }
    else if (which === 'second') { if (isMain) return; }
    const src = sources.find(s => String(s.display_id) === String(d.id)) || sources[i];
    if (!src) return;
    let img = src.thumbnail.resize({ width: d.bounds.width, height: d.bounds.height });
    // Anything he hid is painted solid before the picture is saved, so the glass never shows it to me, not even to read.
    img = paintHides(img, d.bounds);
    const file = path.join(SHOTS, `${stamp}-${isMain ? 'main' : 'second'}${tag}.png`);
    fs.writeFileSync(file, img.toPNG());
    out.push({ file, screen: isMain ? 'main' : 'second', bounds: d.bounds });
  });
  return out;
}

// The glass draws in Windows' scaled units (DIPs). The PowerShell helpers work in real pixels. These convert,
// so a laptop at 125-150% lines up the same as a desktop at 100%.
const toScreen = ([x, y]) => { try { const p = screen.dipToScreenPoint({ x, y }); return [Math.round(p.x), Math.round(p.y)]; } catch { return [x, y]; } };
const toDip = ([x, y]) => { try { const p = screen.screenToDipPoint({ x, y }); return [Math.round(p.x), Math.round(p.y)]; } catch { return [x, y]; } };
function whereIs(pts) {
  if (!pts.length) return Promise.resolve([]);
  pts = pts.map(toScreen);
  return new Promise(resolve => {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'tools', 'where.ps1'), pts.map(p => p.join(',')).join(';')], { windowsHide: true });
    let o = ''; ps.stdout.on('data', d => o += d);
    const t = setTimeout(() => { ps.kill(); resolve([]); }, 4000);
    ps.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(o).map(w => { const [x1, y1] = toDip([w.x1, w.y1]), [x2, y2] = toDip([w.x2, w.y2]); return { ...w, x1, y1, x2, y2 }; })); } catch { resolve([]); } });
    ps.on('error', () => { clearTimeout(t); resolve([]); });
  });
}

// ---- A mark into the Den: a picture of exactly what he marked, its words as text, and his note ----
const HOMEBASE = process.env.GLASS_DEN_URL || '';
async function denApi(url, body) {
  const r = await fetch(HOMEBASE + '/api/den' + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Den said ${r.status}`); return j;
}
function ocrText(file) {
  return new Promise(resolve => {
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'tools', 'ocr.ps1'), file], { windowsHide: true });
    let o = ''; ps.stdout.on('data', d => o += d);
    const t = setTimeout(() => { ps.kill(); resolve(''); }, 15000);
    ps.on('close', () => { clearTimeout(t); try { resolve((JSON.parse(o.replace(/[\u0000-\u001f]/g, ' ')).lines || []).map(l => l.text).join('\n')); } catch { resolve(''); } });
    ps.on('error', () => { clearTimeout(t); resolve(''); });
  });
}
async function markToDen(paneIdx, id, note) {
  const p = panes[paneIdx]; if (!p) throw new Error('no such screen');
  const o = p.d.bounds, r = await run(p, { op: 'rect', id });
  if (!r) throw new Error(`no mark #${paneIdx * 1000 + id}`);
  const first = (note || '').split(/[.!?\n]/)[0].trim(), title = first ? (first.length > 70 ? first.slice(0, 67) + '…' : first) : 'From the glass';
  if (!r.mark) { // a loose note: just his words
    const it = await denApi('/items', { kind: 'text', title, body: note || '', by: 'hunter' });
    log({ who: 'hunter', op: 'den', id: paneIdx * 1000 + id, item: it.id }); return it.id;
  }
  const [s] = await shotNow(p.primary ? 'main' : 'second', '-clean');
  const pad = 8, img = nativeImage.createFromPath(s.file), size = img.getSize();
  const x = Math.max(0, Math.round(r.x1 - pad)), y = Math.max(0, Math.round(r.y1 - pad));
  const crop = img.crop({ x, y, width: Math.min(size.width - x, Math.round(r.x2 - r.x1 + pad * 2)), height: Math.min(size.height - y, Math.round(r.y2 - r.y1 + pad * 2)) });
  const file = s.file.replace('-clean.png', `-snip-${paneIdx * 1000 + id}.png`); fs.writeFileSync(file, crop.toPNG());
  const words = await ocrText(file);
  const it = await denApi('/items', { kind: 'image', title, name: path.basename(file), mime: 'image/png', data: crop.toPNG().toString('base64'), by: 'hunter' });
  const body = [note ? note : null, words ? '**The words in it:**\n\n' + words.split('\n').map(l => '> ' + l).join('\n') : null].filter(Boolean).join('\n\n');
  if (body) await denApi('/items', { kind: 'text', title: 'With it', body, by: 'hunter', parent: it.id }).catch(e => trail('den text failed: ' + e));
  log({ who: 'hunter', op: 'den', id: paneIdx * 1000 + id, item: it.id, snip: file });
  return it.id;
}

// ---- My versions: he taps Keep and it's written into the real file, or Drop and it's gone ----
const proposals = new Map(); // gid -> { file, old, new }
// ✎ Steer on my version: a note box under it; his words come straight to me, no ➤ needed.
// ✕ on his steer: just that steer is taken back, it won't go with ➤, and the thread stays.
ipcMain.on('unsteer', (e, localId) => { const p = paneOf(e.sender); if (!p) return; const i = panes.indexOf(p);
  pending = pending.filter(m => !(m.op === 'steer' && m.gid === i * 1000 + localId)); puckSay();
  log({ who: 'hunter', op: 'unsteer', id: i * 1000 + localId }); });
ipcMain.on('steer', async (e, localId, at, prev) => {
  const p = paneOf(e.sender); if (!p) return; await finishNote();
  const i = panes.indexOf(p), o = p.d.bounds;
  openNote(i, at.x + o.x, at.y + o.y, null);
  noteAt.steer = i * 1000 + localId; noteAt.x = at.x + o.x; noteAt.y = at.y + o.y;
  const wa = p.d.workArea || p.d.bounds; if (noteAt.y + NOTE.h > wa.y + wa.height - 8) noteAt.y = wa.y + wa.height - 8 - NOTE.h;
  if (noteWin) { noteWin.setBounds({ x: noteAt.x, y: noteAt.y, width: Math.max(280, at.w || 280), height: NOTE.h });
    noteWin.webContents.once('did-finish-load', () => noteWin && noteWin.webContents.executeJavaScript(`const t=document.getElementById('t'); t.placeholder='Steer my version: what should change? Type, or talk with Win+H. Enter keeps it; ✕ on it takes it back; nothing goes until ➤'; t.value=${JSON.stringify(prev || '')};`).catch(() => {})); }
});
ipcMain.on('proposal', async (e, localId, choice) => {
  const p = paneOf(e.sender); if (!p) return;
  const i = panes.indexOf(p), gid = i * 1000 + localId, meta = proposals.get(gid) || {};
  let ok = choice === 'keep', text = '', written = false;
  if (choice === 'keep' && meta.file) {
    try {
      const src = fs.readFileSync(meta.file, 'utf8'), at = src.indexOf(meta.old), again = at < 0 ? -1 : src.indexOf(meta.old, at + 1);
      if (at < 0) { ok = false; text = "couldn't find it in the file; I'll do it by hand"; }
      else if (again >= 0) { ok = false; text = "it's in the file twice; I'll do it by hand"; }
      else { fs.writeFileSync(meta.file, src.slice(0, at) + meta.new + src.slice(at + meta.old.length)); written = true; text = `kept ✓ written to ${path.basename(meta.file)}`; }
    } catch (err) { ok = false; text = 'writing failed: ' + err.message; }
  } else if (choice === 'keep') text = "kept ✓ I'll make the change";
  await run(p, { op: 'proposed', id: localId, choice, ok, text }).catch(() => {});
  if (choice === 'drop') proposals.delete(gid);
  if (choice === 'keep') { keptWaiting++; puckSay(); }
  log({ who: 'hunter', op: 'proposal', id: gid, choice, written, file: meta.file || null, note: text });
});

// ---- Watching a spot for him: read it every so often, light it up when it changes ----
const watchers = new Map(); // gid -> { ... }
const numOf = t => { const m = String(t).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
async function startWatch(cmd) {
  let gid, rect;
  if (cmd.to != null) {
    gid = await doCmd({ op: 'watchmark', to: cmd.to, label: cmd.label });
    const i = Math.floor(gid / 1000), r = await run(panes[i], { op: 'rect', id: gid % 1000 }), o = panes[i].d.bounds;
    rect = { x1: r.x1 + o.x, y1: r.y1 + o.y, x2: r.x2 + o.x, y2: r.y2 + o.y };
  } else {
    rect = { x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2 };
    gid = await doCmd({ op: 'watchmark', ...rect, label: cmd.label });
  }
  const i = Math.floor(gid / 1000), w = { gid, pane: i, rect, label: cmd.label || '', every: Math.max(10, Number(cmd.every) || 60), above: cmd.above, below: cmd.below, last: null };
  w.last = await readSpot(w);
  w.timer = setInterval(() => checkWatch(w).catch(err => trail('watch failed: ' + err)), w.every * 1000);
  watchers.set(gid, w);
  log({ who: 'odie', op: 'watching', id: gid, label: w.label, every: w.every, now: w.last });
  return gid;
}
async function readSpot(w) {
  const p = panes[w.pane], o = p.d.bounds;
  const [s] = await shotNow(p.primary ? 'main' : 'second', '-clean');
  const img = nativeImage.createFromPath(s.file), x = Math.max(0, w.rect.x1 - o.x), y = Math.max(0, w.rect.y1 - o.y);
  // Read it at twice the size: small numbers read much better.
  const crop = img.crop({ x, y, width: Math.max(4, w.rect.x2 - w.rect.x1), height: Math.max(4, w.rect.y2 - w.rect.y1) });
  const big = crop.resize({ width: crop.getSize().width * 2, quality: 'best' });
  const f = s.file.replace('-clean.png', `-watch-${w.gid}.png`); fs.writeFileSync(f, big.toPNG());
  const text = (await ocrText(f)).replace(/\s+/g, ' ').trim();
  fs.unlink(s.file, () => {}); fs.unlink(f, () => {});
  return text;
}
async function checkWatch(w) {
  if (shooting) return;
  const p = panes[w.pane]; if (!p || !(await run(p, { op: 'rect', id: w.gid % 1000 }).catch(() => null))) { clearInterval(w.timer); watchers.delete(w.gid); return; }
  const now = await readSpot(w); if (!now || now === w.last) return;
  const a = numOf(w.last), b = numOf(now);
  let hit = true;
  if (w.above != null) hit = b != null && b > Number(w.above) && !(a != null && a > Number(w.above));
  if (w.below != null) hit = b != null && b < Number(w.below) && !(a != null && a < Number(w.below));
  const was = w.last; w.last = now;
  if (!hit) return;
  const text = `${w.label ? w.label + ' ' : ''}changed: ${was || '(nothing)'} → ${now}`;
  await run(p, { op: 'watchhit', id: w.gid % 1000, text }).catch(() => {});
  log({ who: 'glass', op: 'watch', id: w.gid, label: w.label, from: was, to: now });
}

async function dropToDen(title, which) {
  const shots = await shot(which || 'primary');
  const tool = path.join(__dirname, '..', 'tools', 'den.js');
  const results = [];
  for (const s of shots) {
    const res = await new Promise(resolve => {
      const p = spawn(process.env.NODE_EXE || 'node', [tool, 'put', 'image', title, s.file], { cwd: path.join(__dirname, '..'), windowsHide: true });
      let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d);
      p.on('close', code => resolve({ code, out: o.trim() }));
      p.on('error', err => resolve({ code: -1, out: String(err) }));
    });
    results.push({ file: s.file, ...res });
  }
  return { title, results };
}

function body(req) {
  return new Promise(res => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch { res({}); } }); });
}

const run = (pane, cmd) => pane.win.webContents.executeJavaScript(`window.glass.do(${JSON.stringify(cmd)})`);

async function doCmd(cmd) {
  if (cmd.op === 'den') {
    const i = Math.floor(cmd.to / 1000), n = await markToDen(i, cmd.to % 1000, cmd.note || '');
    await run(panes[i], { op: 'status', id: cmd.to % 1000, state: 'done', text: `in the Den · #${n}` }).catch(() => {});
    return n;
  }
  if ((cmd.op === 'propose' || cmd.op === 'watchmark') && cmd.to != null) {
    const i = Math.floor(cmd.to / 1000); if (!panes[i]) throw new Error(`no mark #${cmd.to}`);
    const id = await run(panes[i], { ...cmd, id: cmd.to % 1000 }); return i * 1000 + id;
  }
  if (cmd.op === 'answer' || cmd.op === 'status') {
    const i = Math.floor(cmd.to / 1000), target = panes[i]; if (!target) throw new Error(`no mark #${cmd.to}`);
    if (target !== active) { await run(active, { op: 'hide' }); const f = active.d.bounds, o = target.d.bounds; cmd.enter = f.x < o.x ? 'left' : 'right'; cmd.x = o.width / 2; cmd.y = o.height / 2; active = target; }
    const id = await run(target, { ...cmd, id: cmd.to % 1000 });
    return i * 1000 + id;
  }
  // Every pane hears clear/list; drawing goes to the screen the mark starts on.
  if (cmd.op === 'clear') { if (!cmd.id && (cmd.who === 'all' || cmd.who === 'hunter')) hides = []; let n = 0; for (const p of panes) n += await run(p, cmd); return n; }
  if (cmd.op === 'list') { const all = []; for (const p of panes) all.push(...(await run(p, cmd))); return all; }
  if (cmd.op === 'say' || cmd.op === 'hide') return run(active, cmd);
  const ax = cmd.x ?? cmd.x1 ?? (cmd.points && cmd.points[0][0]), ay = cmd.y ?? cmd.y1 ?? (cmd.points && cmd.points[0][1]);
  const target = panes.find(p => ax >= p.d.bounds.x && ax < p.d.bounds.x + p.d.bounds.width && ay >= p.d.bounds.y && ay < p.d.bounds.y + p.d.bounds.height) || active;
  const o = target.d.bounds;
  ['x', 'x1', 'x2'].forEach(k => { if (typeof cmd[k] === 'number') cmd[k] -= o.x; });
  ['y', 'y1', 'y2'].forEach(k => { if (typeof cmd[k] === 'number') cmd[k] -= o.y; });
  if (Array.isArray(cmd.points)) cmd.points = cmd.points.map(([px, py]) => [px - o.x, py - o.y]);
  if (target !== active) {
    // My cursor leaves one screen and comes in from the side that faces it.
    const from = active.d.bounds;
    await run(active, { op: 'hide' });
    cmd.enter = from.x < o.x ? 'left' : from.x > o.x ? 'right' : from.y < o.y ? 'top' : 'bottom';
    active = target;
  }
  // Marks are numbered across screens: screen index * 1000 + local id.
  const id = await run(target, cmd);
  return id ? panes.indexOf(target) * 1000 + id : 0;
}

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  // Only the AI's own commands get in. A web page in his browser can send requests to 127.0.0.1 too: browsers mark those
  // with an Origin header, and a site pretending to be 127.0.0.1 (DNS rebinding) shows its own name in Host. Both are refused,
  // so no page can draw fake notes on his screen, put up a version that writes a file on Keep, or read what he sent.
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (req.headers.origin || !['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end(); }
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/state') return send(200, { ok: true, displays: displaysInfo(), seq, events: events.slice(-50) });
    if (req.method === 'GET' && url.pathname === '/wait') {
      const since = Number(url.searchParams.get('since') || seq), ms = Math.min(Number(url.searchParams.get('ms') || 60000), 3600000);
      // I wake for his sends and Den drops, his Keep/Drop on my versions, and a spot I'm watching changing.
      const wakes = e => (e.who === 'hunter' && ['send', 'drop', 'proposal'].includes(e.op)) || (e.who === 'glass' && e.op === 'watch');
      const has = () => events.some(e => e.n > since && wakes(e));
      const done = () => send(200, { seq, events: events.filter(e => e.n > since && (e.who === 'hunter' || e.who === 'glass')) });
      if (has()) return done();
      res.on('close', () => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); clearTimeout(t); linkSay(true); } });
      const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); lastWaiting = Date.now(); done(); }, ms);
      const w = () => { if (has()) { clearTimeout(t); lastWaiting = Date.now(); done(); } else waiters.push(w); };
      waiters.push(w); linkSay(true); return;
    }
    if (req.method === 'POST' && url.pathname === '/convert') { const b = await body(req); const f = b.to === 'screen' ? toScreen : toDip; return send(200, { ok: true, points: (b.points || []).map(f) }); }
    if (req.method === 'GET' && url.pathname === '/hides') return send(200, { ok: true, hides: hides.map(h => h.box) });
    if (req.method === 'GET' && url.pathname === '/unread') return send(200, { ok: true, delivered, link: link(), events: unread });
    if (req.method === 'POST' && url.pathname === '/ack') { const b = await body(req); ack(b.at); return send(200, { ok: true, delivered }); }
    if (req.method === 'POST' && url.pathname === '/do') {
      const cmd = await body(req);
      if (cmd.op === 'propose') {
        const meta = { file: cmd.file, old: cmd.fileOld || cmd.old, new: cmd.new }; delete cmd.file; delete cmd.fileOld;
        const id = await doCmd(cmd); proposals.set(id, meta); log({ who: 'odie', op: 'propose', id, file: meta.file || null });
        return send(200, { ok: true, id });
      }
      if (cmd.op === 'watch') { const id = await startWatch(cmd); return send(200, { ok: true, id }); }
      if (cmd.op === 'clear' && typeof cmd.id === 'number') {
        const p = panes[Math.floor(cmd.id / 1000)]; const n = p ? await run(p, { op: 'clear', id: cmd.id % 1000 }) : 0;
        return send(200, { ok: true, id: n });
      }
      const id = await doCmd(cmd);
      log({ who: 'odie', op: cmd.op, id });
      return send(200, { ok: true, id });
    }
    if (req.method === 'POST' && url.pathname === '/shot') { const b = await body(req); return send(200, { ok: true, shots: await shot(b.which || 'all', !!b.clean) }); }
    if (req.method === 'POST' && url.pathname === '/drop') { const b = await body(req); return send(200, { ok: true, ...(await dropToDen(b.title || 'From the glass', b.which)) }); }
    if (req.method === 'POST' && url.pathname === '/mode') { const b = await body(req); setMode(b.mode); return send(200, { ok: true, mode }); }
    if (req.method === 'POST' && url.pathname === '/quit') { send(200, { ok: true }); return setTimeout(() => app.quit(), 100); }
    send(404, { ok: false, error: 'not here' });
  } catch (err) { send(500, { ok: false, error: String(err && err.message || err) }); }
}).listen(PORT, '127.0.0.1');

app.whenReady().then(() => {
  build();
  screen.on('display-added', build);
  screen.on('display-removed', build);
});
app.on('window-all-closed', () => app.quit());
app.on('child-process-gone', (_e, d) => trail(`child gone: ${d.type} ${d.reason}`));
