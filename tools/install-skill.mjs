#!/usr/bin/env node
// Shared skill installer. The exact same file ships in every public build (Homebase, the Den, the glass, UI Taste).
// Reads this build's own skill/SKILL.md and optional skill/install.json manifest — zero hardcoded repo names.
// Installs for Claude Code (~/.claude/skills/<name>), Antigravity (~/.gemini/antigravity/skills/<name> and/or
// <brain>/.agents/skills/<name>), or both automatically.
//
//   node tools/install-skill.mjs                     install the skill for detected AI app(s)
//   node tools/install-skill.mjs --claude            install for Claude only
//   node tools/install-skill.mjs --agy               install for Antigravity only (alias: --antigravity)
//   node tools/install-skill.mjs --brain "<dir>"     also install into a Shelves brain's .agents/skills/ & hooks
//   node tools/install-skill.mjs --hook              also wire this build's hooks (from skill/install.json)
//   node tools/install-skill.mjs --allow             also add this build's Claude allow rules (from skill/install.json)
//   node tools/install-skill.mjs --remove            cleanly remove skill, hooks and allow rules
//   node tools/install-skill.mjs --home "<dir>"      sandbox home directory (also SKILL_HOME)
//
// Made by Odie, Rivet and Hunter.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(TOOLS, '..');
const argv = process.argv.slice(2);
const hasFlag = f => argv.includes(f);
const optVal = f => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const slash = p => p.split(path.sep).join('/');

const HOME_DIR = path.resolve(optVal('--home') || process.env.SKILL_HOME || os.homedir());
const BRAIN_DIR = optVal('--brain') ? path.resolve(optVal('--brain')) : null;
const ONLY_CLAUDE = hasFlag('--claude');
const ONLY_AGY = hasFlag('--agy') || hasFlag('--antigravity');
const WANT_HOOK = hasFlag('--hook');
const WANT_ALLOW = hasFlag('--allow');
const REMOVE = hasFlag('--remove');
const NODE = slash(process.execPath);

const SKILL_SRC = path.join(ROOT, 'skill', 'SKILL.md');
const MANIFEST_SRC = path.join(ROOT, 'skill', 'install.json');

if (!fs.existsSync(SKILL_SRC)) {
  console.error(`No skill/SKILL.md found in ${slash(ROOT)}.`);
  process.exit(1);
}

const rawSkill = fs.readFileSync(SKILL_SRC, 'utf8');
let manifest = {};
if (fs.existsSync(MANIFEST_SRC)) {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8')); }
  catch (e) { console.error(`skill/install.json doesn't read as JSON (${e.message}).`); process.exit(1); }
}

const frontName = rawSkill.match(/^---[\s\S]*?^name:\s*([^\r\n]+)/m)?.[1]?.trim();
const SKILL_NAME = manifest.name || frontName || path.basename(ROOT);
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(SKILL_NAME)) {
  console.error(`Invalid skill name "${SKILL_NAME}".`);
  process.exit(1);
}

// Built-in token context + optional manifest tokens.
const vars = {
  ROOT: slash(ROOT),
  TOOLS: slash(TOOLS),
  NODE,
};
const autoTools = {
  GLASS: 'glass.js',
  MIRROR: 'mirror.js',
  DEN: 'den.js',
  HOMEBASE: 'flags.js',
  TASTE: 'taste.mjs',
};
for (const [k, file] of Object.entries(autoTools)) {
  const full = path.join(TOOLS, file);
  if (fs.existsSync(full)) vars[k] = slash(full);
}
const expandVars = str => String(str).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => vars[k] ?? '');
for (const [k, v] of Object.entries(manifest.tokens || {})) vars[k] = expandVars(v);

function renderSkill(text) {
  let out = text;
  // Upgrade `node "{{TOKEN}}"` to full real node path so wrapper `node` on PATH never hijacks commands.
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'NODE' || k === 'ROOT' || k === 'TOOLS') continue;
    out = out.replaceAll(`node "{{${k}}}"`, `"${NODE}" "${v}"`);
  }
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

const claudeDir = path.join(HOME_DIR, '.claude');
const claudeSkillDir = path.join(claudeDir, 'skills', SKILL_NAME);
const claudeSettings = path.join(claudeDir, 'settings.json');
const agyGlobalDir = path.join(HOME_DIR, '.gemini', 'antigravity');
const agySkillDir = path.join(agyGlobalDir, 'skills', SKILL_NAME);
const brainAgentsDir = BRAIN_DIR ? path.join(BRAIN_DIR, '.agents') : null;
const brainSkillDir = brainAgentsDir ? path.join(brainAgentsDir, 'skills', SKILL_NAME) : null;
const brainHooksFile = brainAgentsDir ? path.join(brainAgentsDir, 'hooks.json') : null;

const hasClaude = fs.existsSync(claudeDir);
const hasAgy = fs.existsSync(path.join(HOME_DIR, '.gemini')) || Boolean(brainAgentsDir);
const targets = {
  claude: ONLY_CLAUDE ? true : ONLY_AGY ? false : (hasClaude || !hasAgy),
  agyGlobal: ONLY_AGY ? true : ONLY_CLAUDE ? false : fs.existsSync(path.join(HOME_DIR, '.gemini')),
  agyBrain: ONLY_CLAUDE ? false : Boolean(brainSkillDir),
};

function readJsonStrict(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`Couldn't read ${slash(file)} (${e.message}); left it alone.`);
  }
}
function writeJsonBackup(file, obj, suffix) {
  if (fs.existsSync(file) && suffix) {
    const back = file + suffix;
    if (!fs.existsSync(back)) fs.copyFileSync(file, back);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const claudeHooks = manifest.hooks || {};
const agyHooks = manifest.agyHooks || {};
const allowRules = (manifest.allow || []).map(expandVars);
const envKeys = manifest.envKeys || [];
const hookTag = manifest.hookMatch || slash(ROOT);

const matchesHook = cmdStr => {
  const norm = String(cmdStr || '').replace(/\\/g, '/').toLowerCase();
  const patterns = Array.isArray(manifest.hookMatches) ? manifest.hookMatches : [hookTag];
  return patterns.some(p => norm.includes(expandVars(p).replace(/\\/g, '/').toLowerCase()));
};

function stripClaudeSettings(s) {
  if (s.hooks) {
    for (const ev of Object.keys(s.hooks)) {
      if (!Array.isArray(s.hooks[ev])) continue;
      s.hooks[ev] = s.hooks[ev]
        .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !matchesHook(h.command)) }))
        .filter(g => g.hooks.length > 0);
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  if (s.permissions?.allow && allowRules.length) {
    s.permissions.allow = s.permissions.allow.filter(r => !allowRules.includes(r));
  }
  if (s.env && envKeys.length) {
    for (const k of envKeys) delete s.env[k];
  }
  return s;
}

if (REMOVE) {
  const removed = [];
  for (const [label, dir] of [['Claude', claudeSkillDir], ['Antigravity', agySkillDir], ['brain (.agents)', brainSkillDir]]) {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(`${label} skill (${slash(dir)})`);
    }
  }
  if (fs.existsSync(claudeSettings)) {
    const s = stripClaudeSettings(readJsonStrict(claudeSettings));
    writeJsonBackup(claudeSettings, s, `.before-${SKILL_NAME}`);
    removed.push(`Claude settings hooks/rules`);
  }
  if (brainHooksFile && fs.existsSync(brainHooksFile)) {
    const h = readJsonStrict(brainHooksFile);
    if (h[`${SKILL_NAME}-build`]) {
      delete h[`${SKILL_NAME}-build`];
      writeJsonBackup(brainHooksFile, h, `.before-${SKILL_NAME}`);
      removed.push(`Antigravity brain hooks`);
    }
  }
  console.log(removed.length ? `Removed ${SKILL_NAME}: ${removed.join(', ')}.` : `Nothing installed for ${SKILL_NAME} to remove.`);
  process.exit(0);
}

// 1 · Install rendered SKILL.md to each selected target.
const rendered = renderSkill(rawSkill);
const installed = [];
if (targets.claude) {
  fs.mkdirSync(claudeSkillDir, { recursive: true });
  fs.writeFileSync(path.join(claudeSkillDir, 'SKILL.md'), rendered);
  installed.push(`Claude → ${slash(claudeSkillDir)}`);
}
if (targets.agyGlobal) {
  fs.mkdirSync(agySkillDir, { recursive: true });
  fs.writeFileSync(path.join(agySkillDir, 'SKILL.md'), rendered);
  installed.push(`Antigravity → ${slash(agySkillDir)}`);
}
if (targets.agyBrain && brainSkillDir) {
  fs.mkdirSync(brainSkillDir, { recursive: true });
  fs.writeFileSync(path.join(brainSkillDir, 'SKILL.md'), rendered);
  installed.push(`Antigravity brain → ${slash(brainSkillDir)}`);
}
console.log(`Installed ${SKILL_NAME} skill:\n  ` + installed.join('\n  '));

// 2 · Optional --hook / --allow wiring (from skill/install.json).
if ((WANT_HOOK || WANT_ALLOW) && targets.claude) {
  const hasAnyHook = Object.keys(claudeHooks).length > 0;
  const hasAnyAllow = allowRules.length > 0;
  const hasAnyEnv = envKeys.some(k => Boolean(process.env[k]));
  if ((WANT_HOOK && hasAnyHook) || (WANT_ALLOW && hasAnyAllow) || hasAnyEnv) {
    const s = readJsonStrict(claudeSettings);
    if (WANT_HOOK && hasAnyHook) {
      s.hooks ??= {};
      for (const [ev, entries] of Object.entries(claudeHooks)) {
        s.hooks[ev] = (s.hooks[ev] || [])
          .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !matchesHook(h.command)) }))
          .filter(g => g.hooks.length > 0);
        for (const entry of entries) {
          s.hooks[ev].push({
            hooks: [{
              type: 'command',
              command: expandVars(entry.command),
              timeout: entry.timeout || 10,
            }],
          });
        }
      }
      console.log(`Wired ${SKILL_NAME} Claude hooks in ${slash(claudeSettings)}.`);
    }
    if (hasAnyEnv) {
      s.env ??= {};
      for (const k of envKeys) if (process.env[k]) s.env[k] = process.env[k];
    }
    if (WANT_ALLOW && hasAnyAllow) {
      s.permissions ??= {};
      s.permissions.allow ??= [];
      for (const r of allowRules) if (!s.permissions.allow.includes(r)) s.permissions.allow.push(r);
      console.log(`Added ${allowRules.length} Claude allow rule(s) for ${SKILL_NAME}.`);
    }
    writeJsonBackup(claudeSettings, s, `.before-${SKILL_NAME}`);
  }
}

if (WANT_HOOK && brainHooksFile && Object.keys(agyHooks).length > 0) {
  const h = readJsonStrict(brainHooksFile);
  const block = { enabled: true };
  for (const [ev, entries] of Object.entries(agyHooks)) {
    block[ev] = entries.map(entry => ({
      type: 'command',
      command: expandVars(entry.command),
      timeout: entry.timeout || 10,
    }));
  }
  h[`${SKILL_NAME}-build`] = block;
  writeJsonBackup(brainHooksFile, h, `.before-${SKILL_NAME}`);
  console.log(`Wired ${SKILL_NAME} Antigravity hooks in ${slash(brainHooksFile)}.`);
}
