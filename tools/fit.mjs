#!/usr/bin/env node
// Fit this build into the rest. The same file, word for word, ships in every one of our builds:
// the-homebase, the-glass, the-den and ui-taste. Whichever one you set up, this plugs them into each other.
//
//   node tools/fit.mjs              find the others and plug in everything that's only files (safe to run any time)
//   node tools/fit.mjs --settings   also turn on the glass's buttons for the Den and UI Taste (writes ~/.claude/settings.json, a copy kept)
//   node tools/fit.mjs --check      say what's here and what's plugged in, change nothing
//   node tools/fit.mjs --line       print the one line your person pastes, if your app won't let you change your own settings
//   --also "<folder>"               look in that folder too (a build, or a folder that holds builds); repeat it for more
//
// It looks for the others beside this folder and in the user folder. Running it twice changes nothing.
// Made by Odie and Hunter. If it gets something wrong, open an issue on any of the repos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check'), SETTINGS = argv.includes('--settings'), LINE = argv.includes('--line');
const also = []; argv.forEach((a, i) => { if (a === '--also' && argv[i + 1]) also.push(path.resolve(argv[i + 1])); });

const has = (dir, ...files) => files.every(f => fs.existsSync(path.join(dir, f)));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// A build's own config: {} when there is none yet (its default port), and { broken } when it's there but won't read.
// A broken one is never read as the default port: that reached the wrong program (another app on the default port).
const readConf = f => { if (!fs.existsSync(f)) return {}; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return { broken: e.message }; } };
const portOf = (f, dflt) => { const c = readConf(f); return c.broken ? { broken: c.broken, file: path.basename(f) } : (c.port || dflt); };
const slash = p => p.split(path.sep).join('/');

// How each build is recognized, and where it keeps its address.
const KINDS = {
  homebase: { name: 'Homebase', is: d => has(d, 'tools/plug.js', 'lib/brain.js'), port: d => portOf(path.join(d, 'homebase.config.json'), 7940) },
  glass:    { name: 'the glass', is: d => has(d, 'tools/glass.js', 'glass/main.js') },
  den:      { name: 'the Den', is: d => has(d, 'tools/den.js', 'tools/admin.mjs'), port: d => portOf(path.join(d, 'config.json'), 7950) },
  taste:    { name: 'UI Taste', is: d => has(d, 'tools/taste.mjs', 'server.js'), port: d => portOf(path.join(d, 'ui-taste.config.json'), 7960) },
};

// Look: this folder, any --also, its neighbors, the user folder.
const places = [];
const consider = d => { try { if (fs.statSync(d).isDirectory()) places.push(path.resolve(d)); } catch {} };
const children = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') consider(path.join(d, e.name)); } catch {} };
consider(SELF);
for (const a of also) { consider(a); children(a); }
children(path.dirname(SELF));
children(os.homedir());

const found = {}, extra = [];
for (const d of [...new Set(places)]) for (const [k, kind] of Object.entries(KINDS)) {
  if (!kind.is(d)) continue;
  if (!found[k]) found[k] = d; else if (found[k] !== d) extra.push(`${kind.name} at ${slash(d)}`);
}
// A build whose config won't read isn't plugged into anything until it's fixed, and the list says why.
const broken = {};
for (const k of Object.keys(found)) { const p = KINDS[k].port?.(found[k]); if (p && typeof p === 'object') { broken[k] = { dir: found[k], ...p }; delete found[k]; } }
const url = k => `http://127.0.0.1:${KINDS[k].port(found[k])}`;
const node = process.execPath;
const cmd = (dir, tool, rest) => `"${node}" "${path.join(dir, 'tools', tool)}" ${rest}`;
const run = (dir, tool, args) => execFileSync(node, [path.join(dir, 'tools', tool), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const lines = { here: [], done: [], already: [], next: [] };
for (const [k, kind] of Object.entries(KINDS)) lines.here.push(found[k] ? `✓ ${kind.name}: ${slash(found[k])}${kind.port ? `  (${url(k)}/)` : ''}` : broken[k] ? `✗ ${kind.name}: ${slash(broken[k].dir)}, but its ${broken[k].file} doesn't read (${broken[k].broken}), so it isn't plugged in. Fix that file (paths with forward slashes), then run this again.` : `· ${kind.name}: not here (skipped)`);

// 1 · Homebase's left side: every build with a page gets one click there.
function onHomebase(k, label, sub, icon) {
  if (!found.homebase || !found[k]) return;
  const nav = readJson(path.join(found.homebase, 'data', 'nav.json'));
  const item = nav?.groups?.flatMap(g => g.items || []).find(i => (i.name || '').toLowerCase() === label.toLowerCase());
  if (item && item.url === url(k) + '/') return lines.already.push(`${label} is on Homebase's left side`);
  if (CHECK) return lines.next.push(`${label} isn't on Homebase's left side yet`);
  run(found.homebase, 'plug.js', ['add', label, url(k) + '/', '--sub', sub, '--icon', icon]);
  lines.done.push(`${label} is on Homebase's left side now (open Homebase and it's under "Built for you")`);
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
  else { c.homebase = url('homebase') + '/'; fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n'); lines.done.push(`the Den has a way back to Homebase (if the Den is running, restart it: ${cmd(found.den, 'den.js', 'restart')})`); }
}

// 3 · The Den knows the glass (so den.js point can circle a card on their real screen).
if (found.den && found.glass) {
  const c = readJson(path.join(found.den, 'config.json'));
  if (!c) {} else if (c.glass && path.resolve(c.glass) === found.glass) lines.already.push(`the Den knows the glass`);
  else if (CHECK) lines.next.push(`the Den doesn't know the glass yet`);
  else { run(found.den, 'den.js', ['link', found.glass]); lines.done.push(`the Den knows the glass`); }
}

// 4 · The glass's buttons: ⤓ Den on the card, ♥ Taste in the note box. These live in the person's Claude settings,
//     because the glass takes its settings from the chat that starts it.
const want = {};
if (found.glass && found.den) want.GLASS_DEN_URL = url('den');
if (found.glass && found.taste) want.GLASS_TASTE_URL = url('taste');
if (Object.keys(want).length) {
  const file = path.join(os.homedir(), '.claude', 'settings.json');
  const s = fs.existsSync(file) ? readJson(file) : {};
  const missing = Object.entries(want).filter(([k, v]) => s?.env?.[k] !== v);
  const what = k => k === 'GLASS_DEN_URL' ? '⤓ Den on their card' : '♥ Taste in their note box';
  if (s === null) lines.next.push(`${file} doesn't read as JSON, so the glass's buttons were left off. Fix that file first.`);
  else if (!missing.length && LINE) { console.log('Nothing for your person to paste: the glass already has its buttons.'); process.exit(0); }
  else if (!missing.length) lines.already.push(`the glass has ${Object.keys(want).map(what).join(' and ')}`);
  else if (LINE) {
    console.log(`Give your person this one line. They right-click Start, choose Terminal, paste it, and press Enter:\n\n& "${node}" "${path.join(SELF, 'tools', 'fit.mjs')}" --settings\n\nIt turns on ${missing.map(([k]) => what(k)).join(' and ')}, and keeps a copy of their Claude settings first.`);
    process.exit(0);
  } else if (!SETTINGS || CHECK) {
    lines.next.push(`one more, for the glass: ${missing.map(([k]) => what(k)).join(' and ')} need a setting. Run this again with --settings (if your app won't let you, --line gives you one line for your person)`);
  } else {
    const back = file + '.before-fit';
    if (fs.existsSync(file) && !fs.existsSync(back)) fs.copyFileSync(file, back);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    s.env ??= {}; for (const [k, v] of missing) s.env[k] = v;
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
    lines.done.push(`the glass gets ${missing.map(([k]) => what(k)).join(' and ')} (in a new chat, after the glass restarts: ${cmd(found.glass, 'glass.js', 'restart')}). Their settings from before are kept at settings.json.before-fit`);
  }
}

// The glass and Homebase need nothing: they box a line of your memory on Homebase and you fix it.
if (found.glass && found.homebase) lines.already.push(`the glass and Homebase work together as they are`);

console.log('What I found:\n  ' + lines.here.join('\n  '));
if (extra.length) console.log('Also found (not used; --also picks a different one first):\n  ' + extra.join('\n  '));
if (lines.done.length) console.log('Plugged in just now:\n  ' + lines.done.join('\n  '));
if (lines.already.length) console.log('Already fitted:\n  ' + lines.already.join('\n  '));
if (lines.next.length) console.log((CHECK ? 'Not fitted yet:' : 'Still to do:') + '\n  ' + lines.next.join('\n  '));
const n = Object.keys(found).length;
if (n < 2) console.log('Nothing else to fit with yet. Run this again after they set up another of our builds.');
