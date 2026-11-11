#!/usr/bin/env node
// The glass: the AI's hands on their screen. Coordinates are
// in the glass's own units (`state` prints each screen's range; on a scaled laptop they're smaller than its pixels).
//
//   node tools/glass.js start | stop | state
//   node tools/glass.js shot [main|second|all]          screenshot(s) with the glass in them; prints the files to Read
//   node tools/glass.js move x y
//   node tools/glass.js point x y ["note"]              glide there and pulse
//   node tools/glass.js circle x y r ["note"]           (or --rx/--ry for an oval)
//   node tools/glass.js box x1 y1 x2 y2 ["note"]
//   node tools/glass.js underline x1 x2 y ["note"]
//   node tools/glass.js arrow x1 y1 x2 y2 ["note"]      the note sits at the tail
//   node tools/glass.js note x y "text"
//   node tools/glass.js read [main|second|all]          their screen as text, line by line, with where each line starts
//   node tools/glass.js find "phrase" [screen]          where those words are on their screen
//   node tools/glass.js mark "phrase" ["note"] [--as box|underline]   mark by meaning: find the words and mark them
//   node tools/glass.js status <#> working|done|you|clear ["words"]   where I am with their mark, shown on it
//   node tools/glass.js point-at "name" ["note"] [--app x]   "click here": a ring on the real button/link/field, found by name
//   node tools/glass.js steps "name|note" "name|note" ...      a walkthrough: ring, wait for their click there, next
//   node tools/glass.js propose <#|"phrase"> "new text" [--file f --old "exact text in f"]   my version over it, Keep/Drop
//   node tools/glass.js watch <#|"phrase"|x1 y1 x2 y2> [--label t] [--every 60] [--above N|--below N]   ping on change
//   node tools/glass.js den <#> ["note"]                 their mark into the Den (only with GLASS_DEN_URL): a picture of exactly it, its words, the note
//   node tools/glass.js answer <#> "text"               my answer beside their mark #, tied to it, moving with it
//   node tools/glass.js say "text"                      a bubble by my cursor that fades
//   node tools/glass.js clear [ai|theirs|all|<id>]      ai = your marks (the default), theirs = their marks (odie|hunter still work)
//   node tools/glass.js drop "<title>" [main|second]    put the marked screen on the Den table (only with GLASS_DEN_URL)
//   node tools/glass.js stream                         the watch that never ends: run it under your Monitor tool, one block per send
//   node tools/glass.js wait [--min N]                  the older watch: wait for one send, print it, exit (unread sends come first)
//   node tools/glass.js last                          their last send again, read fresh
//   node tools/glass.js look                          a look at the window in front of them, with them (a soft frame shows it)
//   node tools/glass.js scene                         what's on the glass, and what was kept aside when its window closed
//   node tools/glass.js hello                         the start-of-chat note (npm run skill -- --hook runs it in every new chat)
//   node tools/glass.js here                          are they at the PC? (here / away, from Windows' last keyboard or mouse input)
//   node tools/glass.js unread | ack                    what they sent that no chat has taken yet; mark it received
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const BASE = `http://127.0.0.1:${Number(process.env.GLASS_PORT) || 7931}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const glassDir = path.join(here, '..', 'glass');
const [cmd, ...a] = process.argv.slice(2);
const flag = (k, d) => { const i = a.indexOf('--' + k); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const num = v => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; };

// Here or away: seconds since their last keyboard or mouse input (Windows' GetLastInputInfo).
// Drawing on their screen unasked only makes sense when they're there to see it; from their
// phone, a mark on an empty desk is just a mess waiting for them.
const AWAY_MIN = Number(process.env.GLASS_AWAY_MIN) || 10;
function idleSeconds() {
  const ps = `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Idle { [StructLayout(LayoutKind.Sequential)] struct L { public uint cb; public uint t; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref L l);
  public static uint Ms() { L l = new L(); l.cb = 8; GetLastInputInfo(ref l); return (uint)Environment.TickCount - l.t; } }
'@; [Idle]::Ms()`;
  try { return Math.round(Number(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim()) / 1000); }
  catch { return 0; }
}
const ago = s => s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;

async function call(p, body, timeout = 20000) {
  const r = await fetch(BASE + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const j = await r.json(); if (!j.ok && j.error) throw new Error(j.error); return j;
}
const up = () => call('/state', undefined, 1500).then(() => true, () => false);
const act = body => call('/do', body).then(j => console.log(body.op === 'clear' ? 'cleared' : body.op === 'status' ? 'status set' : j.id ? `on the glass (#${j.id})` : 'done'));
async function offWords(body, b) {
  if (!body.note && !body.text) return body;
  try { body.avoid = avoidNear(await cleanWords(), b); } catch {}
  return body;
}

// ---- My eyes: Windows' own OCR reads his screen as words with places (tools/ocr.ps1, local) ----
function ocr(file) {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'ocr.ps1'), file], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 << 20 });
  return JSON.parse(out.replace(/[\u0000-\u001f]/g, ' ')).lines || [];
}
// Every word on the screen(s), in screen pixels, line by line.
function wordsOf(shots) {
  const all = [];
  for (const s of shots) {
    const o = s.bounds || { x: 0, y: 0 };
    ocr(s.file).forEach((l, li) => l.words.forEach(w => all.push({ text: w.text, x1: w.x + o.x, y1: w.y + o.y, x2: w.x + w.w + o.x, y2: w.y + w.h + o.y, line: `${s.screen}:${li}` })));
  }
  return all;
}
// The words inside a box, as text, in reading order.
// A second, sharper look at one spot when the plain pass found nothing there (selected text, small or faint type).
function readCrop(shots, b) {
  const s = shots.find(x => { const o = x.bounds; return o ? b.x1 >= o.x && b.x1 < o.x + o.width : true; }); if (!s) return '';
  const o = s.bounds || { x: 0, y: 0 }, x = Math.max(0, Math.round(b.x1 - o.x - 6)), y = Math.max(0, Math.round(b.y1 - o.y - 6)), w = Math.round(b.x2 - b.x1 + 12), h = Math.round(b.y2 - b.y1 + 12);
  if (w < 8 || h < 8 || w * h > 1200 * 700) return '';
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'ocr.ps1'), s.file, '-crop', `${x},${y},${w},${h}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 << 20 });
    return (JSON.parse(out.replace(/[\u0000-\u001f]/g, ' ')).lines || []).map(l => l.words.map(w => w.text).join(' ')).join(' / ');
  } catch { return ''; }
}
function textIn(words, b, pad = 6) {
  const inside = words.filter(w => { const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2; return cx >= b.x1 - pad && cx <= b.x2 + pad && cy >= b.y1 - pad && cy <= b.y2 + pad; });
  let out = '', line = null;
  for (const w of inside) { out += (line === null ? '' : w.line === line ? ' ' : '\n') + w.text; line = w.line; }
  return out;
}
const norm = t => t.toLowerCase().replace(/[^a-z0-9']/g, '');
function near(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1; // one letter off (OCR slips)
}
// Find a phrase on his screen: the boxes of each place it appears.
function findPhrase(words, phrase) {
  const want = phrase.split(/\s+/).map(norm).filter(Boolean), seq = words.map(w => ({ ...w, n: norm(w.text) })).filter(w => w.n);
  const hits = [];
  for (let i = 0; i + want.length <= seq.length; i++) {
    if (!want.every((t, k) => near(seq[i + k].n, t))) continue;
    const ws = seq.slice(i, i + want.length);
    hits.push({ x1: Math.min(...ws.map(w => w.x1)), y1: Math.min(...ws.map(w => w.y1)), x2: Math.max(...ws.map(w => w.x2)), y2: Math.max(...ws.map(w => w.y2)),
      lines: [...new Set(ws.map(w => w.line))].length, text: ws.map(w => w.text).join(' ') });
  }
  return hits;
}
async function cleanWords(which = 'all') {
  const st = await call('/state');
  const shots = (await call('/shot', { which, clean: true })).shots;
  shots.forEach(s => { const d = st.displays.find(d => (d.primary ? 'main' : 'second') === s.screen); if (d) s.bounds = d.bounds; });
  return wordsOf(shots);
}
// Buttons, links and fields by name (UI Automation), else the words on screen (OCR). Screen pixels.
function locate(name, app = '', hides = []) {
  try {
    let hits = JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'uia.ps1'), name, '-app', app], { encoding: 'utf8', windowsHide: true, timeout: 20000 }) || '[]');
    // Nothing inside a hidden area counts, and with anything hidden I don't repeat window names (they can carry what he hid).
    hits = hits.filter(h => !hides.some(b => h.x < b.x2 && h.x + h.w > b.x1 && h.y < b.y2 && h.y + h.h > b.y1));
    if (hits.length) { const h = hits[0]; return { x1: h.x, y1: h.y, x2: h.x + h.w, y2: h.y + h.h, how: hides.length ? `${h.type} "${h.name}"` : `${h.type} "${h.name}" in ${h.window}` }; }
  } catch {}
  return null;
}
// Between real pixels and the glass's units; an older glass without /convert means 100%, so points pass through.
const convert = async (to, points) => (await call('/convert', { to, points }).catch(() => ({ points }))).points;
async function locateAny(name, app) {
  const hides = (await call('/hides').catch(() => ({ hides: [] }))).hides || [];
  let u = locate(name, app, []);
  if (u) { // real pixels -> the glass's units, then drop anything inside a hidden area
    const [[x1, y1], [x2, y2]] = await convert('dip', [[u.x1, u.y1], [u.x2, u.y2]]);
    u = { ...u, x1, y1, x2, y2 };
    if (!hides.some(b => u.x1 < b.x2 && u.x2 > b.x1 && u.y1 < b.y2 && u.y2 > b.y1)) return hides.length ? { ...u, how: u.how.replace(/ in .*$/, '') } : u;
  }
  const hits = findPhrase(await cleanWords(), name);
  return hits.length ? { ...hits[0], how: `the words "${hits[0].text}" on screen` } : null;
}

// A send, read: the window and the words under each of his marks.
// A picture of just the spot around each mark (his box plus room), so I look at what he marked
// instead of reading a whole screen to find it. The full screens stay in the send for when I need them.
function cropMarks(e) {
  const jobs = [];
  for (const m of e.marks || []) {
    const b = m.box || (m.from && m.to ? { x1: Math.min(m.from[0], m.to[0]), y1: Math.min(m.from[1], m.to[1]), x2: Math.max(m.from[0], m.to[0]), y2: Math.max(m.from[1], m.to[1]) } : m.x != null ? { x1: m.x, y1: m.y, x2: m.x, y2: m.y } : null);
    if (!b || m.gid == null) continue;
    const scr = (e.clean || []).find(s => s.screen === (m.screen || 'main')) || {}, o = scr.bounds || { x: m.screen === 'second' ? 1920 : 0, y: 0, width: 1920, height: 1080 };
    const shot = (e.shots || []).find(f => f.includes(`-${m.screen === 'second' ? 'second' : 'main'}`)); if (!shot) continue;
    const pad = 160, x = Math.max(0, Math.round(b.x1 - o.x - pad)), y = Math.max(0, Math.round(b.y1 - o.y - pad));
    const w = Math.min((o.width || 1920) - x, Math.round(b.x2 - b.x1 + pad * 2)), h = Math.min((o.height || 1080) - y, Math.round(b.y2 - b.y1 + pad * 2));
    if (w < 20 || h < 20) continue;
    const out = shot.replace(/\.png$/i, `-mark${m.gid}.png`); jobs.push({ shot, out, x, y, w, h }); m.crop = out;
  }
  if (!jobs.length) return;
  const ps = 'Add-Type -AssemblyName System.Drawing;' + jobs.map(j => `$i=[Drawing.Image]::FromFile('${j.shot}');$b=New-Object Drawing.Bitmap ${j.w},${j.h};$g=[Drawing.Graphics]::FromImage($b);$g.DrawImage($i,(New-Object Drawing.Rectangle 0,0,${j.w},${j.h}),(New-Object Drawing.Rectangle ${j.x},${j.y},${j.w},${j.h}),[Drawing.GraphicsUnit]::Pixel);$b.Save('${j.out}');$g.Dispose();$b.Dispose();$i.Dispose();`).join('');
  try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }); } catch { for (const m of e.marks || []) delete m.crop; }
}

// The words on his screen at a send, kept a while, so my answers can stay off them (Nov 10).
const WORDS = path.join(glassDir, 'data', 'words');
const wordsFile = e => path.join(WORDS, String(e.at).replace(/[:.]/g, '-') + '.json');
function lineRects(words) {
  const m = new Map();
  for (const w of words) { const r = m.get(w.line); if (!r) m.set(w.line, { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }); else { r.x1 = Math.min(r.x1, w.x1); r.y1 = Math.min(r.y1, w.y1); r.x2 = Math.max(r.x2, w.x2); r.y2 = Math.max(r.y2, w.y2); } }
  return [...m.values()];
}
function sendWords(e) {
  try { return JSON.parse(fs.readFileSync(wordsFile(e), 'utf8')); } catch {}
  if (!e.clean || !e.clean.length) return [];
  try { const w = wordsOf(e.clean); try { fs.mkdirSync(WORDS, { recursive: true }); fs.writeFileSync(wordsFile(e), JSON.stringify(w)); } catch {} return w; } catch { return []; }
}
// The lines of text near a spot on his screen, to keep my card off them.
function avoidNear(words, b, reach = 700) {
  return lineRects(words).filter(r => r.x2 > b.x1 - reach && r.x1 < b.x2 + reach && r.y2 > b.y1 - reach && r.y1 < b.y2 + reach).map(r => ({ x1: r.x1 - 3, y1: r.y1 - 3, x2: r.x2 + 3, y2: r.y2 + 3 }));
}
function readSend(e) {
  if (e.op === 'send') cropMarks(e);
  if (e.op === 'send' && e.look) { try { e.look.words = ocr(e.look.crop).map(l => l.words.map(w => w.text).join(' ')).filter(Boolean); } catch {} return e; }
  if (e.op !== 'send' || !e.clean || !e.clean.length) return e;
  let words = [];
  try { words = sendWords(e); if (!words.length) throw new Error('no words read'); } catch (err) { e.readError = String(err.message || err); return e; }
  for (const m of e.marks || []) {
    // Each tool reads its own way: an arrow, what's at each end; a step, what's beside the dot; a highlight, exactly its words.
    if (m.kind === 'arrow') { const near = ([x, y]) => ({ x1: x - 150, y1: y - 22, x2: x + 150, y2: y + 22 }); m.fromReads = textIn(words, near(m.from)); m.toReads = textIn(words, near(m.to)); continue; }
    if (m.kind === 'step') { m.reads = textIn(words, { x1: m.x - 20, y1: m.y - 12, x2: m.x + 460, y2: m.y + 12 }); continue; }
    const b = m.box || (m.op === 'note' ? null : { x1: m.x - 60, y1: m.y - 30, x2: m.x + 60, y2: m.y + 30 });
    if (b) m.reads = textIn(words, b);
    if (b && !m.reads && m.op !== 'note') m.reads = readCrop(e.clean, b);
  }
  return e;
}

// A stop I meant: my watch sees it and waits for the glass to come back instead of starting it again
// (it used to restart the glass the instant I stopped it, which made every restart a fight).
import fs from 'node:fs';
const STOPPING = path.join(glassDir, 'data', '.stopping');
const stoppedOnPurpose = () => { try { return Date.now() - Number(fs.readFileSync(STOPPING, 'utf8')) < 90000; } catch { return false; } };
async function stopGlass() {
  try { fs.writeFileSync(STOPPING, String(Date.now())); } catch {}
  if (await up()) { await call('/quit', {}); for (let i = 0; i < 40 && await up(); i++) await new Promise(r => setTimeout(r, 150)); }
}
async function comeBack() {
  // While a stop I meant is fresh, wait for it to come back; otherwise start it.
  for (let i = 0; i < 120 && stoppedOnPurpose(); i++) { if (await up()) return; await new Promise(r => setTimeout(r, 500)); }
  if (!(await up())) await start();
}

// Restart the glass. It saves what's on it as it changes and puts it all back itself when it starts (Nov 10),
// with the same numbers, so I only say so, restart, and wait for it to finish putting things back.
async function restart() {
  if (await up()) {
    if (idleSeconds() < AWAY_MIN * 60) { await call('/do', { op: 'say', text: 'Restarting the glass for a few seconds. Everything on it comes back.' }).catch(() => {}); await new Promise(r => setTimeout(r, 1800)); }
    await new Promise(r => setTimeout(r, 2200)); // the last change reaches scene.json
  }
  await stopGlass();
  try { fs.unlinkSync(STOPPING); } catch {}
  await start();
  let said = '';
  for (let i = 0; i < 40 && !said; i++) {
    await new Promise(r => setTimeout(r, 300));
    const st = await call('/state').catch(() => null), e = st && st.events.find(x => x.op === 'restored');
    if (e) said = '; put back ' + e.back + ' of ' + e.of + (e.closed ? ' (' + e.closed + ' whose window closed are kept aside: glass.js scene)' : '');
  }
  console.log('the glass restarted' + said + '. Same numbers as before. A running watch rides through a restart.');
}

async function start() {
  try { fs.unlinkSync(STOPPING); } catch {}
  if (await up()) return console.log('the glass is already up');
  const electron = createRequire(path.join(glassDir, 'package.json'))('electron');
  // A chat's shell can carry ELECTRON_RUN_AS_NODE (the Claude app is Electron too); with it, the glass starts as plain node and dies.
  const env = { ...process.env, NODE_EXE: process.execPath }; delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, [glassDir], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await up()) return console.log('the glass is up'); }
  throw new Error('the glass did not come up');
}

// What his mark says before his words do: the tool, and the color's meaning.
const MEANS = { red: 'RED = wrong, cut this', green: 'GREEN = good, keep this', yellow: 'YELLOW = look here' };
function markLine(m) {
  const at = m.box ? ` x ${m.box.x1}-${m.box.x2}, y ${m.box.y1}-${m.box.y2}` : '', c = MEANS[m.color] ? ` [${MEANS[m.color]}]` : '';
  if (m.kind === 'arrow') return `arrow${c} from ${m.from.join(',')} to ${m.to.join(',')}: this goes there${m.fromReads ? `\n       from: "${m.fromReads.replace(/\n/g, ' / ')}"` : ''}${m.toReads ? `\n       to: "${m.toReads.replace(/\n/g, ' / ')}"` : ''}`;
  if (m.kind === 'step') return `STEP ${m.n}${c} at ${m.x},${m.y}`;
  if (m.kind === 'highlight') return `highlighted${c}${at} (read exactly these words)`;
  if (m.kind === 'ellipse') return `circled${c}${at}`;
  if (m.kind === 'pen') return `drew${c}${at}`;
  return `boxed${c}${at}`;
}
function describe(e) {
  const t = e.at.slice(11, 19);
  if (e.op === 'send') {
    if (e.error) return `${t} the send failed: ${e.error}`;
    if (e.look) {
      const L = e.look, w = L.words || [];
      return t + ' THEY PRESSED ➤ WITH NOTHING MARKED: look at what they are looking at, and answer on the glass (or in chat)\n' +
        '  in front of them: ' + (L.app || '?') + ' "' + (L.title || '') + '" (' + L.screen + ' screen, x ' + L.rect.x1 + '-' + L.rect.x2 + ', y ' + L.rect.y1 + '-' + L.rect.y2 + ')\n' +
        '  see it: ' + L.crop + (w.length ? '\n  words in it (first ' + Math.min(40, w.length) + ' of ' + w.length + ' lines): ' + w.slice(0, 40).join(' / ') : '') +
        '\n  to point at something in it: glass.js mark "words" "note", or box x1 y1 x2 y2 "note"';
    }
    const marks = [...(e.marks || [])].sort((p, q) => (p.kind === 'step' && q.kind === 'step') ? p.n - q.n : 0);
    const lines = marks.map((m, i) => `  #${m.gid ?? '?'} ${m.op === 'steer' ? (m.file ? `STEER on your version (re-propose to #${m.gid}): "${m.text}"` : `REPLY on the thread at #${m.gid} (answer #${m.gid} again): "${m.text}"`) : m.op === 'note' ? `loose note at ${m.x},${m.y}: "${m.text}"` : m.op === 'ask' ? `? at ${m.x},${m.y}` : markLine(m)}${m.screen === 'second' ? ' (second screen)' : ''}${m.app ? `\n       in: ${m.app} "${m.title}"` : ''}${m.reads ? `\n       under it: "${m.reads.replace(/\n/g, ' / ')}"` : ''}${m.note ? `\n       their words on it: "${m.note}"` : ''}${m.crop ? `\n       see just this spot: ${m.crop}` : ''}`);
    return `${t} THEY SENT YOU ${lines.length} mark(s), answer each beside it with: glass.js answer <#> "text"\n${lines.join('\n')}\n  whole screens, only if you need more: ${(e.shots || []).join(' , ')}`;
  }
  if (e.op === 'tie') return `${t} they tied words to their ${e.of === 'ask' ? '?' : 'circle'} (#${e.id}): "${e.text}"`;
  if (e.op === 'note') return `${t} they wrote a note at ${e.x},${e.y}: "${e.text}"`;
  if (e.op === 'undo') return `${t} they undid their last ${e.of || 'mark'}`;
  if (e.op === 'pen') return `${t} they drew a stroke around x ${e.box.x1}-${e.box.x2}, y ${e.box.y1}-${e.box.y2} (#${e.id})`;
  if (e.op === 'ask') return `${t} they dropped a ? at ${e.x},${e.y} (#${e.id})`;
  if (e.op === 'drop') return `${t} they sent the screen to the Den: ${(e.results || []).map(r => r.out).join(' | ') || e.error}`;
  if (e.op === 'clear') return `${t} they cleared the glass`;
  if (e.op === 'hide') return `${t} they hid an area (blacked out of every picture the glass gives you; treat it as off limits in your other tools too)`;
  if (e.op === 'proposal') return `${t} THEY TAPPED ${e.choice === 'keep' ? 'KEEP' : 'DROP'} on your version #${e.id}${e.file ? ` (${e.file})` : ''}: ${e.note || ''}`;
  if (e.op === 'watch') return `${t} A SPOT I'M WATCHING CHANGED (#${e.id}${e.label ? ', ' + e.label : ''}): "${e.from}" → "${e.to}"`;
  if (e.op === 'mode') return `${t} their pen: ${e.mode}`;
  return `${t} ${JSON.stringify(e)}`;
}

try {
  // Going first needs them in the room. Answers, versions and status on their own marks are fine
  // (they just sent them), but unasked drawing waits until they're back. --anyway overrides.
  const UNASKED = ['move', 'point', 'circle', 'box', 'underline', 'arrow', 'note', 'mark', 'point-at', 'steps', 'say'];
  if (UNASKED.includes(cmd) && !a.includes('--anyway')) {
    const idle = idleSeconds();
    if (idle >= AWAY_MIN * 60) { console.log(`they're away from the PC (no input for ${ago(idle)}), so nothing was drawn. Tell them in chat instead, or save it for when they're back (glass.js here). --anyway draws regardless.`); process.exit(0); }
  }
  const any = a.indexOf('--anyway'); if (any >= 0) a.splice(any, 1);
  switch (cmd) {
    case 'start': await start(); break;
    case 'stop': await stopGlass(); console.log('the glass is down (a running watch waits for it to come back)'); break;
    case 'restart': await restart(); break;
    case 'state': {
      if (!(await up())) { console.log('the glass is down'); break; }
      const s = await call('/state');
      console.log(s.displays.map(d => `${d.primary ? 'main' : 'second'}: x ${d.bounds.x}..${d.bounds.x + d.bounds.width - 1}, y ${d.bounds.y}..${d.bounds.y + d.bounds.height - 1}, scale ${d.scale}`).join('\n'));
      if (s.puck) console.log(`puck (the round face): around ${Math.round(s.puck.x + s.puck.width - 32)},${Math.round(s.puck.y + s.puck.height / 2)}`);
      if (s.link) console.log(s.link === 'off' ? 'watch: nobody is watching (the puck says not connected)' : 'watch: an AI is watching (the puck shows connected)');
      const his = s.events.filter(e => e.who === 'hunter'); if (his.length) console.log('\nfrom them:\n' + his.map(describe).join('\n'));
      break;
    }
    case 'shot': { const s = await call('/shot', { which: a[0] || 'all' }); s.shots.forEach(x => console.log(`${x.screen}: ${x.file}`)); break; }
    case 'move': await act({ op: 'move', x: num(a[0]), y: num(a[1]) }); break;
    case 'point': { const x = num(a[0]), y = num(a[1]); await act(await offWords({ op: 'point', x, y, note: a[2] }, { x1: x, y1: y, x2: x, y2: y })); break; }
    case 'circle': { const rx = flag('rx'), ry = flag('ry'), x = num(a[0]), y = num(a[1]), r = a[2] && !isNaN(a[2]) ? num(a[2]) : 40, X = rx ? num(rx) : r, Y = ry ? num(ry) : r;
      await act(await offWords({ op: 'circle', x, y, r, rx: rx && num(rx), ry: ry && num(ry), note: a[2] && isNaN(a[2]) ? a[2] : a[3] }, { x1: x - X, y1: y - Y, x2: x + X, y2: y + Y })); break; }
    case 'box': { const b = { x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]) }; await act(await offWords({ op: 'box', ...b, note: a[4] }, b)); break; }
    case 'underline': { const x1 = num(a[0]), x2 = num(a[1]), y = num(a[2]); await act(await offWords({ op: 'underline', x1, x2, y, note: a[3] }, { x1, y1: y - 20, x2, y2: y })); break; }
    case 'arrow': { const p = a.slice(0, 4).map(num); await act(await offWords({ op: 'arrow', x1: p[0], y1: p[1], x2: p[2], y2: p[3], note: a[4] }, { x1: p[2] - 10, y1: p[3] - 10, x2: p[2] + 10, y2: p[3] + 10 })); break; }
    case 'note': { const x = num(a[0]), y = num(a[1]); await act(await offWords({ op: 'note', x, y, text: a[2] }, { x1: x, y1: y, x2: x + 280, y2: y + 80 })); break; }
    case 'status': await act({ op: 'status', to: num(String(a[0]).replace('#', '')), state: a[1] || 'working', text: a[2] }); break;
    case 'find': {
      const hits = findPhrase(await cleanWords(a[1] || 'all'), a[0] || '');
      console.log(hits.length ? hits.map(h => `${h.x1},${h.y1} to ${h.x2},${h.y2}: "${h.text}"`).join('\n') : `not on their screen: "${a[0]}"`);
      break;
    }
    case 'read': {
      // Everything on their screen as text, line by line, with where each line starts.
      const words = await cleanWords(a[0] || 'all'), lines = new Map();
      for (const w of words) { if (!lines.has(w.line)) lines.set(w.line, { x: w.x1, y: w.y1, t: [] }); lines.get(w.line).t.push(w.text); }
      console.log([...lines.values()].map(l => `${l.x},${l.y}  ${l.t.join(' ')}`).join('\n'));
      break;
    }
    case 'mark': {
      // Mark by meaning: find the words on their screen and box them, with my note tied to them (and off the words around them).
      const markWords = await cleanWords(), hits = findPhrase(markWords, a[0] || '');
      if (!hits.length) { console.log(`not on their screen: "${a[0]}"`); process.exit(1); }
      const h = hits[0], how = flag('as', h.lines > 1 ? 'box' : 'underline'), avoid = avoidNear(markWords, h);
      if (how === 'underline') await act({ op: 'underline', x1: h.x1, x2: h.x2, y: h.y2, note: a[1], avoid });
      else await act({ op: 'box', x1: h.x1 - 2, y1: h.y1 - 2, x2: h.x2 + 2, y2: h.y2 + 2, note: a[1], avoid });
      if (hits.length > 1) console.log(`(it's on screen ${hits.length} times; I marked the first)`);
      break;
    }
    case 'point-at': {
      // "Click here": a ring on the real button, found by its name.
      const app = flag('app', ''), r = await locateAny(a[0] || '', app);
      if (!r) { console.log(`couldn't find "${a[0]}" on their screen`); process.exit(1); }
      const j = await call('/do', { op: 'ring', x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, note: a[1] });
      console.log(`ringed ${r.how} at ${r.x1},${r.y1} (#${j.id})`);
      break;
    }
    case 'steps': {
      // A walkthrough on his real screen: ring step 1, wait for his click there, then step 2, and so on.
      const app = flag('app', ''), secs = Number(flag('wait', 600));
      const steps = a.map(x => { const [name, ...note] = x.split('|'); return { name: name.trim(), note: note.join('|').trim() }; });
      for (let k = 0; k < steps.length; k++) {
        let r = null; for (let tries = 0; tries < 6 && !r; tries++) { r = await locateAny(steps[k].name, app); if (!r) await new Promise(z => setTimeout(z, 700)); }
        if (!r) { await call('/do', { op: 'say', text: `I can't find "${steps[k].name}" yet. Tell me what you see.` }); console.log(`step ${k + 1}: couldn't find "${steps[k].name}"`); process.exit(1); }
        const j = await call('/do', { op: 'ring', x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, n: k + 1, note: steps[k].note || `Step ${k + 1} of ${steps.length}: click here` });
        console.log(`step ${k + 1}: ringed ${r.how}`);
        let clicked = true;
        const [[cx1, cy1], [cx2, cy2]] = await convert('screen', [[r.x1 - 6, r.y1 - 6], [r.x2 + 6, r.y2 + 6]]);
        try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'clickwait.ps1'), cx1, cy1, cx2, cy2, secs].map(String), { windowsHide: true, timeout: (secs + 5) * 1000 }); }
        catch { clicked = false; }
        await call('/do', { op: 'clear', id: j.id });
        if (!clicked) { console.log(`step ${k + 1}: they didn't click it`); process.exit(1); }
        console.log(`step ${k + 1}: they clicked it`);
        await new Promise(z => setTimeout(z, 600));
      }
      await call('/do', { op: 'say', text: 'All done ✓' });
      break;
    }
    case 'propose': {
      // My version laid over the real thing. Target: his mark #N, or a phrase on screen.
      const file = flag('file'), fileOld = flag('old'), endAt = flag('to'), target = a[0] || '', text = a[1] || '';
      let body;
      if (/^#?\d+$/.test(target)) body = { op: 'propose', to: Number(target.replace('#', '')), new: text, old: flag('shown') || '' };
      else {
        const words = await cleanWords(), hits = findPhrase(words, target), end = endAt;
        if (!hits.length) { console.log(`not on their screen: "${target}"`); process.exit(1); }
        let h = hits[0];
        if (end) {
          // From these words to those: the whole stretch, full lines in between.
          const e = findPhrase(words, end).find(x => x.y1 >= h.y1 - 4);
          if (!e) { console.log(`couldn't find the end: "${end}"`); process.exit(1); }
          const box = { x1: Math.min(h.x1, e.x1), y1: h.y1, x2: Math.max(h.x2, e.x2), y2: e.y2 };
          const inside = words.filter(w => (w.y1 + w.y2) / 2 > box.y1 - 2 && (w.y1 + w.y2) / 2 < box.y2 + 2 && w.x1 >= box.x1 - 30);
          box.x2 = Math.max(box.x2, ...inside.map(w => w.x2));
          h = { ...box, text: textIn(words, box).replace(/\n/g, ' ') };
        }
        body = { op: 'propose', x1: h.x1, y1: h.y1, x2: h.x2, y2: h.y2, old: h.text, new: text };
      }
      if (!body.old && body.to != null) {
        // what's under his mark now, so the change shows word by word
        const st = await call('/state'); const sends = st.events.filter(e => e.op === 'send').reverse();
        const m = sends.flatMap(e => readSend(e).marks || []).find(m => m.gid === body.to); if (m && m.reads) body.old = m.reads.replace(/\n/g, ' ');
      }
      if (file) { body.file = path.resolve(file); body.fileOld = fileOld || body.old; }
      const j = await call('/do', body);
      console.log(`your version is on their screen (#${j.id})${file ? `, Keep writes it into ${path.basename(file)}` : ''}`);
      break;
    }
    case 'watch': {
      // Keep an eye on a spot: his mark #N, a phrase, or x1 y1 x2 y2. I'm told when it changes.
      const every = flag('every', 60), above = flag('above'), below = flag('below'), label = flag('label', '');
      let body;
      if (/^#?\d+$/.test(a[0]) && a.length < 4) body = { op: 'watch', to: Number(a[0].replace('#', '')) };
      else if (a.length >= 4 && a.slice(0, 4).every(v => !isNaN(v))) body = { op: 'watch', x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]) };
      else {
        const hits = findPhrase(await cleanWords(), a[0] || '');
        if (!hits.length) { console.log(`not on their screen: "${a[0]}"`); process.exit(1); }
        const h = hits[0], pad = Number(flag('pad', 40)); body = { op: 'watch', x1: h.x1 - 6, y1: h.y1 - 6, x2: h.x2 + pad, y2: h.y2 + 6 };
      }
      const j = await call('/do', { ...body, every, above, below, label }, 60000);
      console.log(`watching #${j.id} every ${every}s; you'll hear from me when it changes`);
      break;
    }
    case 'den': await act({ op: 'den', to: num(String(a[0]).replace('#', '')), note: a[1] || '' }); break;
    case 'answer': {
      const to = num(String(a[0]).replace('#', '')); let avoid;
      try {
        const st = await call('/state'), e = st.events.filter(x => x.op === 'send' && (x.marks || []).some(m => m.gid === to)).at(-1);
        const m = e && e.marks.find(m => m.gid === to), b = m && (m.box || (m.x != null ? { x1: m.x, y1: m.y, x2: m.x, y2: m.y } : null));
        if (b) avoid = avoidNear(sendWords(e), b);
      } catch {}
      await act({ op: 'answer', to, text: a[1] || '', avoid }); break;
    }
    case 'look': {
      // A look at what's in front of them, with them (a soft frame shows them I looked).
      const l = await call('/look', {}, 30000); let w = [];
      try { w = ocr(l.crop).map(x => x.words.map(y => y.text).join(' ')).filter(Boolean); } catch {}
      console.log('in front of them: ' + (l.app || '?') + ' "' + (l.title || '') + '" (' + l.screen + ' screen, x ' + l.rect.x1 + '-' + l.rect.x2 + ', y ' + l.rect.y1 + '-' + l.rect.y2 + ')\nsee it: ' + l.crop + (w.length ? '\nwords: ' + w.slice(0, 60).join(' / ') : ''));
      break;
    }
    case 'scene': {
      // What's on the glass, and what was kept aside because its window closed.
      const show = g => '  #' + ((g.pane || 0) * 1000 + g.id) + ' ' + (g.who === 'hunter' ? 'theirs' : 'mine') + ': ' + ((g.cards || []).map(k => (k.who === 'hunter' ? 'them: ' : 'me: ') + k.text.slice(0, 80).replace(/\n/g, ' ')).join(' | ') || '(a mark, no words)');
      try { const cur = JSON.parse(fs.readFileSync(path.join(glassDir, 'data', 'scene.json'), 'utf8')); console.log('on the glass (saved ' + cur.saved + '):\n' + ((cur.items || []).map(show).join('\n') || '  nothing')); } catch { console.log('nothing saved yet'); }
      try { const c = JSON.parse(fs.readFileSync(path.join(glassDir, 'data', 'scene-closed.json'), 'utf8')); if ((c.items || []).length) console.log('kept aside (their windows closed):\n' + c.items.map(show).join('\n')); } catch {}
      break;
    }
    case 'say': await act({ op: 'say', text: a[0] || '' }); break;
    case 'clear': { const w = ({ ai: 'odie', mine: 'odie', theirs: 'hunter', them: 'hunter' })[a[0]] || a[0] || 'odie'; await act(/^\d+$/.test(w) ? { op: 'clear', id: Number(w) } : { op: 'clear', who: w }); break; }
    case 'drop': { const r = await call('/drop', { title: a[0] || 'From the glass', which: a[1] === 'second' ? 'second' : 'primary' }, 30000); r.results.forEach(x => console.log(x.out || x.file)); break; }
    case 'stream': {
      // The watch that never ends: one block per send, printed as it lands, and it keeps listening.
      // Run it under the Monitor tool: every printed block wakes the chat and the watch stays up (30 minutes at most,
      // then the chat re-arms it). Tested on a test glass: three sends in a row, each woke me, no restart between.
      // Only a chat a person is in may hold the glass: a scheduled job's chat would steal it from the live one (Nov 10).
      if (process.env.CLAUDE_CODE_SESSION_ATTENDED === '0' || process.env.GLASS_UNATTENDED === '1') { console.log('not starting the glass watch: this chat has no person in it, so it leaves the glass to the chat that does'); break; }
      const me = process.env.CLAUDE_CODE_SESSION_ID || `pid${process.pid}`;
      if (!(await up())) await comeBack();
      try {
        const mine = path.join(here, 'glass.js').split(String.fromCharCode(92)).join('/').toLowerCase();
        const ps = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Replace([string][char]92,'/').ToLower().Contains('${mine}') -and ($_.CommandLine -like '*glass.js wait*' -or $_.CommandLine -like '*glass.js stream*') -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
        const gone = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim();
        if (gone) console.error(`(stopped an older watch: ${gone.split(/\s+/).join(', ')})`);
      } catch {}
      try { fs.writeFileSync(path.join(glassDir, 'data', 'owner.json'), JSON.stringify({ chat: me, pid: process.pid, since: new Date().toISOString() })); } catch {}
      const out = async evs => {
        const read = evs.map(readSend);
        console.log(read.map(describe).join('\n'));
        for (const e of read) for (const m of e.marks || []) if (m.gid != null) await call('/do', { op: 'status', to: m.gid, state: 'working' }).catch(() => {});
        const last = read.filter(e => e.op === 'send').at(-1); if (last) await call('/ack', { at: last.at }).catch(() => {});
      };
      // When they sit back down after being away, the watch says so once, so the AI can go first.
      let away = null;
      const backCheck = async () => {
        try {
          const r = await call('/front', undefined, 3000);
          if (r.idle >= AWAY_MIN * 60) { if (!away) away = Date.now() - r.idle * 1000; return; }
          if (away && r.idle < 60) {
            const gone = Math.round((Date.now() - away) / 60000); away = null;
            console.log('THEY ARE BACK AT THE PC (away ' + (gone >= 90 ? Math.round(gone / 60) + 'h' : gone + ' min') + '). In front of them: ' + (r.app || '?') + (r.title ? ' "' + r.title.slice(0, 120) + '"' : '') + '. This is the moment to go first on the glass, if there is something to show them.');
          }
        } catch {}
      };
      await backCheck();
      const waiting = (await call('/unread')).events || [];
      if (waiting.length) await out(waiting);
      let since = (await call('/state')).seq, kept = [];
      for (;;) {
        try {
          const r = await call(`/wait?since=${since}&ms=15000`, undefined, 25000);
          since = r.seq;
          await backCheck();
          kept.push(...r.events.filter(e => e.op === 'proposal'));
          const wakes = r.events.filter(e => ['send', 'drop', 'watch'].includes(e.op));
          if (wakes.length) { await out([...kept, ...wakes]); kept = []; }
        } catch { if (!(await up())) { await comeBack(); since = (await call('/state').catch(() => ({ seq: 0 }))).seq; } }
      }
    }
    case 'wait': {
      // Short stretches (long requests get cut off), and if the glass goes down, it comes back up.
      const min = Number(flag('min', 60)), end = Date.now() + min * 60000;
      if (!(await up())) await comeBack();
      // The newest chat owns the glass: any older watch (another chat, or a leftover) is stopped, so it can't catch his sends.
      try {
        const ps = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine.Replace('\\','/').ToLower().Contains('${path.join(here, 'glass.js').replace(/\\/g, '/').toLowerCase()}') -and $_.CommandLine -like '*glass.js wait*' -and $_.ProcessId -ne ${process.pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
        const gone = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim();
        if (gone) console.log(`(stopped an older watch: ${gone.split(/\s+/).join(', ')})`);
      } catch {}
      // Anything he sent while no chat of mine was listening comes first, so nothing gets skipped.
      let got = (await call('/unread')).events || [];
      let since = (await call('/state')).seq;
      const kept = [];
      // If the chat that started me is gone, stop without taking his sends, so the next chat gets them.
      // Some setups wrap node in another process, so I note my whole line of parents once, and stop as soon as any of them is gone.
      let line = [process.ppid];
      try {
        const ps = `$p=${process.ppid}; for($i=0;$i -lt 3;$i++){ $q=(Get-CimInstance Win32_Process -Filter "ProcessId=$p").ParentProcessId; if(-not $q){break}; $q; $p=$q }`;
        line = line.concat(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).split(/\s+/).filter(Boolean).map(Number));
      } catch {}
      const alive = p => { try { process.kill(p, 0); return true; } catch { return false; } };
      line = line.filter(alive); // Git Bash leaves short-lived in-between processes; only watch the ones alive now.
      const parentAlive = () => line.every(alive);
      while (Date.now() < end && !got.length && parentAlive()) {
        try {
          // 15-second stretches: a watch whose chat closed notices within seconds, so his puck never says "connected" falsely for long.
          const ms = Math.min(15000, end - Date.now());
          const r = await call(`/wait?since=${since}&ms=${ms}`, undefined, ms + 10000);
          // A stretch that times out comes back with whatever happened; only their ➤ (or a Den drop, or a watched spot) wakes me.
          // His Keep/Drop on my versions never wakes me (Nov 7: "I'd like to not have things just auto-fire"): they're
          // written already, and they come to me together with his next ➤, so he can keep several in a row.
          kept.push(...r.events.filter(e => e.op === 'proposal'));
          const wakes = e => ['send', 'drop', 'watch'].includes(e.op);
          if (r.events.some(wakes)) got = r.events.filter(wakes);
          since = r.seq;
        } catch {
          if (!(await up())) { await comeBack(); since = (await call('/state').catch(() => ({ seq: 0 }))).seq; }
        }
      }
      if (!parentAlive()) break;
      got = [...kept, ...got].map(readSend);
      console.log(got.length ? got.map(describe).join('\n') : 'nothing from them on the glass');
      console.log(`Start the watch again: node tools/glass.js wait --min ${min}`);
      for (const e of got) for (const m of e.marks || []) if (m.gid != null) await call('/do', { op: 'status', to: m.gid, state: 'working' }).catch(() => {});
      const lastSend = got.filter(e => e.op === 'send').at(-1);
      if (lastSend) await call('/ack', { at: lastSend.at });
      break;
    }
    // His last send again, read fresh (for when I need to look at it twice).
    case 'last': { const st = await call('/state'); const e = st.events.filter(x => x.op === 'send' && x.who === 'hunter').at(-1); console.log(e ? describe(readSend(e)) : 'no send yet'); break; }
    case 'hello': {
      // Runs at the start of every chat (a SessionStart hook, from `npm run skill -- --hook`), in any folder,
      // so a new chat knows the glass is there and takes it. Quick, quiet about errors, always exits 0.
      const me = path.join(here, 'glass.js').split(String.fromCharCode(92)).join('/');
      if (!(await up())) { console.log(`The glass is installed on this PC but not running. If they want it: "${process.execPath.split(String.fromCharCode(92)).join("/")}" "${me}" start, then start your watch (the-glass skill).`); break; }
      const idle = idleSeconds(), at = idle < AWAY_MIN * 60;
      console.log(`The glass is running on this PC, and they are ${at ? 'at the PC' : `away (no input for ${ago(idle)})`}. Load your the-glass skill, then take the glass for this chat by starting your watch: "${process.execPath.split(String.fromCharCode(92)).join("/")}" "${me}" stream (under your Monitor tool, 30 min timeout; re-arm it when it ends. No Monitor tool: wait --min 60 in the background, started again after each send). ${at ? 'Answer their glass sends on the glass.' : 'While they are away, answer in chat.'}`);
      break;
    }
    case 'here': { const idle = idleSeconds(); console.log(idle >= AWAY_MIN * 60 ? `away (no input for ${ago(idle)})` : `here (last input ${ago(idle)} ago)`); break; }
    case 'unread': { const u = await call('/unread'); console.log(`link: ${u.link}`); console.log(u.events.length ? u.events.map(describe).join('\n') : 'nothing waiting'); break; }
    case 'ack': { const u = await call('/unread'); const at = u.events.at(-1)?.at; if (at) await call('/ack', { at }); console.log(at ? `marked ${u.events.length} send(s) received` : 'nothing waiting'); break; }
    default: console.log('glass.js start|stop|state|shot|move|point|circle|box|underline|arrow|note|answer|status|den|point-at|steps|propose|watch|read|find|mark|say|clear|drop|stream|wait|last|look|scene|restart|hello|here|unread|ack  (the top of this file says what each does)');
  }
} catch (err) { console.error('glass:', err.message); process.exit(1); }
