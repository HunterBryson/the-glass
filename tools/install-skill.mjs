// Makes the glass part of every chat, not only chats opened in this folder.
//   npm run skill                    the skill, into ~/.claude/skills/the-glass (Claude Code loads it in any folder)
//   npm run skill -- --hook          also a start-of-chat note ("the glass is running, start your watch") and the bubble's three hooks
//   npm run skill -- --allow         also lets the glass's own commands run without asking, in every folder
//   npm run skill -- --hook --allow  both (what we recommend; ask the person first, it changes ~/.claude/settings.json)
//   npm run skill -- --remove        takes all of it back out
// Why: an AI whose chats open in another folder never reads this repo's CLAUDE.md, so it never knows to start a watch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const slash = p => p.split(path.sep).join('/');
const GLASS = slash(path.join(here, 'glass.js')), TOOLS = slash(here);
const NODE = slash(process.execPath);
const args = process.argv.slice(2), has = f => args.includes(f);
const claude = path.join(os.homedir(), '.claude'), skillDir = path.join(claude, 'skills', 'the-glass'), settingsFile = path.join(claude, 'settings.json');
const hookCmd = `"${NODE}" "${GLASS}" hello`;
const RUN = `"${NODE}" "${GLASS}"`; // the real node.exe by full path, so a wrapper first on PATH never gets in the way
const MIRROR = slash(path.join(here, 'mirror.js')), CARD = `"${NODE}" "${MIRROR}"`;
const rules = [`Bash(${RUN}:*)`, `Bash(${RUN} *)`, `Bash(node "${GLASS}":*)`, `Bash(${CARD}:*)`, `Bash(node "${MIRROR}":*)`, `Bash(powershell -NoProfile -ExecutionPolicy Bypass -File "${TOOLS}/show.ps1":*)`, `Read(${slash(path.join(here, '..', 'glass', 'data', 'shots'))}/**)`];

const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`couldn't read ${settingsFile} (${e.message}); left it alone`); } };
const writeSettings = s => {
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, settingsFile + '.before-glass');
  fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
};
// The bubble hears every chat through three hooks: a message in, the AI's hands as it works, its reply when it's done.
const BUBBLE = slash(path.join(here, 'bubble-hook.mjs'));
const BUBBLE_EVENTS = { UserPromptSubmit: 'start', PostToolUse: 'tool', Stop: 'done' };
const isBubble = h => (h.hooks || []).some(x => String(x.command || '').includes('bubble-hook.mjs'));
const dropBubble = s => { for (const ev of Object.keys(BUBBLE_EVENTS)) if (s.hooks?.[ev]) { s.hooks[ev] = s.hooks[ev].filter(h => !isBubble(h)); if (!s.hooks[ev].length) delete s.hooks[ev]; } };
const isOurs = h => (h.hooks || []).some(x => String(x.command || '').includes('glass.js') && String(x.command || '').includes(' hello'));

if (has('--remove')) {
  fs.rmSync(skillDir, { recursive: true, force: true });
  const s = readSettings();
  if (s.hooks?.SessionStart) { s.hooks.SessionStart = s.hooks.SessionStart.filter(h => !isOurs(h)); if (!s.hooks.SessionStart.length) delete s.hooks.SessionStart; }
  dropBubble(s);
  if (s.permissions?.allow) s.permissions.allow = s.permissions.allow.filter(r => !rules.includes(r));
  if (s.env?.GLASS_PORT) delete s.env.GLASS_PORT;
  writeSettings(s);
  console.log("Removed the glass skill, its start-of-chat note, the bubble's hooks and its allow rules.");
  process.exit(0);
}

const tmpl = fs.readFileSync(path.join(here, '..', 'skill', 'SKILL.md'), 'utf8');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), tmpl.replaceAll('node "{{GLASS}}"', RUN).replaceAll('{{GLASS}}', GLASS).replaceAll('{{TOOLS}}', TOOLS));
console.log(`The glass skill is in ${slash(skillDir)}. Claude Code loads it in any folder.`);

if (has('--hook') || has('--allow')) {
  const s = readSettings();
  if (has('--hook')) {
    s.hooks ??= {}; s.hooks.SessionStart = (s.hooks.SessionStart || []).filter(h => !isOurs(h));
    s.hooks.SessionStart.push({ hooks: [{ type: 'command', command: hookCmd, timeout: 15 }] });
    console.log('Every new chat now starts with a note saying whether the glass is running, so the AI starts its watch.');
    dropBubble(s);
    for (const [ev, m] of Object.entries(BUBBLE_EVENTS)) (s.hooks[ev] ??= []).push({ hooks: [{ type: 'command', command: `"${NODE}" "${BUBBLE}" ${m}`, timeout: 5 }] });
    console.log("The bubble now hears every chat: amber when a message comes in, what the AI is doing as it works, green with its reply when it's done.");
  }
  if (process.env.GLASS_PORT) { s.env ??= {}; s.env.GLASS_PORT = process.env.GLASS_PORT; console.log(`Every chat now uses this glass's port, ${process.env.GLASS_PORT}.`); }
  if (has('--allow')) {
    s.permissions ??= {}; s.permissions.allow ??= [];
    for (const r of rules) if (!s.permissions.allow.includes(r)) s.permissions.allow.push(r);
    console.log("The glass's own commands run without asking, in every folder (only this glass's tool, its show.ps1, and reading its screenshots).");
  }
  writeSettings(s);
  console.log(`Changed ${slash(settingsFile)}${fs.existsSync(settingsFile + '.before-glass') ? ` (the old one is saved as settings.json.before-glass)` : ''}. Takes effect in the next new chat. To undo: npm run skill -- --remove`);
}
