#!/usr/bin/env node
// Fit this build into the rest. The same file, word for word, ships in every one of our builds:
// the-homebase, the-glass, the-den and ui-taste. Whichever one you set up, this plugs them into each other.
//
//   node tools/fit.mjs              find the others and plug them into each other (safe to run any time)
//   node tools/fit.mjs --check      say what's here and what's plugged in, change nothing
//   node tools/fit.mjs --line       print the one line your person pastes, if needed
//   --also "<folder>"               look in that folder too (a build, or a folder that holds builds); repeat it for more
//   --no-home                       skip scanning the user's home folder (also FIT_NO_HOME=1)
//   --home "<folder>"               scan that folder instead of the real home folder (also FIT_HOME)
//
// Works identically for Claude, Antigravity, or any other AI: Glass reads Den/Taste URLs from its own config.json.
// Made by Odie, Rivet and Hunter. If it gets something wrong, open an issue on any of the repos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const hasFlag = f => argv.includes(f);
const optVal = f => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };

const CHECK = hasFlag('--check');
const LINE = hasFlag('--line');
const NO_HOME = hasFlag('--no-home') || process.env.FIT_NO_HOME === '1';
const HOME_DIR = path.resolve(optVal('--home') || process.env.FIT_HOME || os.homedir());
const also = [];
argv.forEach((a, i) => { if (a === '--also' && argv[i + 1]) also.push(path.resolve(argv[i + 1])); });

const has = (dir, ...files) => files.every(f => fs.existsSync(path.join(dir, f)));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// A build's own config: {} when there is none yet (its default port), and { broken } when it's there but won't read.
// A broken one is never read as the default port: that reached the wrong program (another app on the default port).
const readConf = f => {
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { broken: e.message }; }
};
const envPort = name => {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
};
const portOf = (f, dflt, envName) => {
  const c = readConf(f);
  if (c.broken) return { broken: c.broken, file: path.basename(f) };
  return envPort(envName) || c.port || dflt;
};
const slash = p => p.split(path.sep).join('/');
const atomicWriteJson = (file, obj, backupSuffix) => {
  if (backupSuffix && fs.existsSync(file)) {
    const back = file + backupSuffix;
    if (!fs.existsSync(back)) fs.copyFileSync(file, back);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
};

// How each build is recognized, and where it keeps its address.
const KINDS = {
  homebase: { name: 'Homebase', is: d => has(d, 'tools/plug.js', 'lib/brain.js'), port: d => portOf(path.join(d, 'homebase.config.json'), 7940, 'HOMEBASE_PORT') },
  glass:    { name: 'the glass', is: d => has(d, 'tools/glass.js', 'glass/main.js'), port: d => portOf(path.join(d, 'config.json'), 7931, 'GLASS_PORT') },
  den:      { name: 'the Den', is: d => has(d, 'tools/den.js', 'tools/admin.mjs'), port: d => portOf(path.join(d, 'config.json'), 7950, 'DEN_PORT') },
  taste:    { name: 'UI Taste', is: d => has(d, 'tools/taste.mjs', 'server.js'), port: d => portOf(path.join(d, 'ui-taste.config.json'), 7960, 'UI_TASTE_PORT') },
};

// Look: this folder, any --also, its neighbors, and (unless --no-home) the home folder.
const places = [];
const consider = d => { try { if (fs.statSync(d).isDirectory()) places.push(path.resolve(d)); } catch {} };
const children = d => {
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') consider(path.join(d, e.name));
    }
  } catch {}
};
consider(SELF);
for (const a of also) { consider(a); children(a); }
children(path.dirname(SELF));
if (!NO_HOME) children(HOME_DIR);

const found = {}, extra = [];
for (const d of [...new Set(places)]) {
  for (const [k, kind] of Object.entries(KINDS)) {
    if (!kind.is(d)) continue;
    if (!found[k]) found[k] = d;
    else if (found[k] !== d) extra.push(`${kind.name} at ${slash(d)}`);
  }
}

// A build whose config won't read isn't plugged into anything until it's fixed, and the list says why.
const broken = {};
for (const k of Object.keys(found)) {
  const p = KINDS[k].port?.(found[k]);
  if (p && typeof p === 'object') { broken[k] = { dir: found[k], ...p }; delete found[k]; }
}
const url = k => `http://127.0.0.1:${KINDS[k].port(found[k])}`;
const node = process.execPath;
const cmd = (dir, tool, rest) => `"${node}" "${path.join(dir, 'tools', tool)}" ${rest}`;
const run = (dir, tool, args) => {
  try {
    return { ok: true, out: execFileSync(node, [path.join(dir, 'tools', tool), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim() };
  } catch (e) {
    return { ok: false, err: (e.stderr || e.stdout || e.message || 'failed').toString().trim().split('\n')[0] };
  }
};

const lines = { here: [], done: [], already: [], next: [], failed: [] };
for (const [k, kind] of Object.entries(KINDS)) {
  if (found[k]) lines.here.push(`✓ ${kind.name}: ${slash(found[k])}${k !== 'glass' ? `  (${url(k)}/)` : `  (port ${KINDS[k].port(found[k])})`}`);
  else if (broken[k]) lines.here.push(`✗ ${kind.name}: ${slash(broken[k].dir)}, but its ${broken[k].file} doesn't read (${broken[k].broken}), so it isn't plugged in. Fix that file (paths with forward slashes), then run this again.`);
  else lines.here.push(`· ${kind.name}: not here (skipped)`);
}

if (LINE) {
  const extraFlags = [
    ...(NO_HOME ? ['--no-home'] : []),
    ...also.flatMap(a => ['--also', `"${a}"`]),
  ].join(' ');
  console.log(`Give your person this one line. They right-click Start, choose Terminal, paste it, and press Enter:\n\n& "${node}" "${path.join(SELF, 'tools', 'fit.mjs')}"${extraFlags ? ' ' + extraFlags : ''}`);
  process.exit(0);
}

// 1 · Homebase's left side: every build with a page gets one click there.
function onHomebase(k, label, sub, icon) {
  if (!found.homebase || !found[k]) return;
  const nav = readJson(path.join(found.homebase, 'data', 'nav.json'));
  const item = nav?.groups?.flatMap(g => g.items || []).find(i => (i.name || '').toLowerCase() === label.toLowerCase());
  if (item && item.url === url(k) + '/') return lines.already.push(`${label} is on Homebase's left side`);
  if (CHECK) return lines.next.push(`${label} isn't on Homebase's left side yet`);
  const r = run(found.homebase, 'plug.js', ['add', label, url(k) + '/', '--sub', sub, '--icon', icon]);
  if (r.ok) lines.done.push(`${label} is on Homebase's left side now (open Homebase and it's under "Built for you")`);
  else lines.failed.push(`couldn't add ${label} to Homebase's left side (${r.err})`);
}
const aiName = readJson(path.join(found.taste || '', 'ui-taste.config.json'))?.ai?.name || 'your AI';
onHomebase('den', 'The Den', 'The table you and your AI share', 'room');
onHomebase('taste', 'UI Taste', `Box what you like. ${aiName} learns it.`, 'star');

// 2 · The Den's way back to Homebase.
if (found.den && found.homebase) {
  const file = path.join(found.den, 'config.json'), c = readJson(file);
  if (!c) lines.next.push(`the Den has no config.json yet: finish the Den's setup (its CLAUDE.md, step 3), then run this again`);
  else if ((c.homebase || '').replace(/\/$/, '') === url('homebase')) lines.already.push(`the Den has its way back to Homebase`);
  else if (CHECK) lines.next.push(`the Den doesn't know where Homebase is yet`);
  else {
    c.homebase = url('homebase') + '/';
    atomicWriteJson(file, c, '.before-fit');
    lines.done.push(`the Den has a way back to Homebase (if the Den is running, restart it: ${cmd(found.den, 'den.js', 'restart')})`);
  }
}

// 3 · The Den knows the glass (so den.js point can circle a card on their real screen).
if (found.den && found.glass) {
  const c = readJson(path.join(found.den, 'config.json'));
  if (!c) { /* step 2 already noted missing config.json */ }
  else if (c.glass && path.resolve(c.glass) === found.glass) lines.already.push(`the Den knows the glass`);
  else if (CHECK) lines.next.push(`the Den doesn't know the glass yet`);
  else {
    const r = run(found.den, 'den.js', ['link', found.glass]);
    if (r.ok) lines.done.push(`the Den knows the glass`);
    else lines.failed.push(`couldn't link the glass in the Den (${r.err})`);
  }
}

// 4 · The glass's buttons (⤓ Den on the card, ♥ Taste in the note box).
//     Saved directly in the glass's own config.json (env vars still override), so it works identically
//     for Claude, Antigravity, or any other AI without touching ~/.claude/settings.json.
const wantGlass = {};
if (found.glass && found.den) wantGlass.denUrl = url('den');
if (found.glass && found.taste) wantGlass.tasteUrl = url('taste');
if (Object.keys(wantGlass).length) {
  const file = path.join(found.glass, 'config.json');
  const c = readConf(file);
  const what = k => k === 'denUrl' ? '⤓ Den on their card' : '♥ Taste in their note box';
  if (c.broken) {
    lines.failed.push(`the glass's config.json doesn't read (${c.broken}), so its buttons were left alone`);
  } else {
    const missing = Object.entries(wantGlass).filter(([k, v]) => c[k] !== v);
    if (!missing.length) lines.already.push(`the glass has ${Object.keys(wantGlass).map(what).join(' and ')}`);
    else if (CHECK) lines.next.push(`the glass doesn't have ${missing.map(([k]) => what(k)).join(' and ')} in its config.json yet`);
    else {
      for (const [k, v] of missing) c[k] = v;
      atomicWriteJson(file, c, '.before-fit');
      lines.done.push(`the glass gets ${missing.map(([k]) => what(k)).join(' and ')} in config.json (restart the glass to pick it up: ${cmd(found.glass, 'glass.js', 'restart')})`);
    }
  }
}

// The glass and Homebase need nothing: they box a line of your memory on Homebase and you fix it.
if (found.glass && found.homebase) lines.already.push(`the glass and Homebase work together as they are`);

console.log('What I found:\n  ' + lines.here.join('\n  '));
if (extra.length) console.log('Also found (not used; --also picks a different one first):\n  ' + extra.join('\n  '));
if (lines.done.length) console.log('Plugged in just now:\n  ' + lines.done.join('\n  '));
if (lines.already.length) console.log('Already fitted:\n  ' + lines.already.join('\n  '));
if (lines.next.length) console.log((CHECK ? 'Not fitted yet:' : 'Still to do:') + '\n  ' + lines.next.join('\n  '));
if (lines.failed.length) {
  console.log('Could not finish:\n  ' + lines.failed.join('\n  '));
  process.exitCode = 1;
}
if (Object.keys(found).length < 2 && !Object.keys(broken).length) {
  console.log('Nothing else to fit with yet. Run this again after they set up another of our builds.');
}
