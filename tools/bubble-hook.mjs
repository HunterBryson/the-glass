// The talking bubble on the glass hears the AI's turn from three Claude Code hooks (installed by `npm run skill -- --hook`):
//   node tools/bubble-hook.mjs start   (UserPromptSubmit) a message is in: amber, "You asked: <their words>"
//   node tools/bubble-hook.mjs tool    (PostToolUse)      what the AI's hands just did, at most one line every 2 s
//   node tools/bubble-hook.mjs done    (Stop)             green, the AI's reply to read
// The AI's own words (a plan, a step, a sentence) come from tools/mirror.js. Never blocks: short timeout, silent when the
// glass is down, exit 0. A chat nobody is watching (a scheduled job) stays out of it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GLASS = `http://127.0.0.1:${process.env.GLASS_PORT || 7931}/mirror`;
const STAMP = path.join(os.tmpdir(), 'glass-bubble-tool.stamp');
const mode = process.argv[2];

const name = p => String(p || 'a file').split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
const clip = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const oneLine = s => String(s || '').replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/\s+/g, ' ').trim();

function handsFor(tool, i = {}) {
  if (/^mcp__ccd_|^ToolSearch$|^ReadNotifications$|^TaskStop$/.test(tool)) return null;
  if (tool === 'Bash' || tool === 'PowerShell') { if (/tools[\\/]mirror\.js/.test(i.command || '')) return null; return i.description ? clip(i.description) : 'Running a command'; }
  return ({ Read: `Reading ${name(i.file_path)}`, Edit: `Editing ${name(i.file_path)}`, Write: `Writing ${name(i.file_path)}`,
    Grep: `Searching for “${clip(i.pattern, 40)}”`, Glob: 'Looking for files', Agent: `Sending a helper: ${clip(i.description, 60)}`,
    Artifact: 'Working on a page', WebSearch: `Searching the web: ${clip(i.query, 60)}`, WebFetch: 'Reading a page on the web',
    Skill: `Opening the ${clip(i.skill, 40)} skill`, Monitor: 'Starting a watch' })[tool]
    || (/^mcp__Claude_Browser__|^mcp__claude-in-chrome__/.test(tool) ? 'Looking at a page in the browser'
    : /^mcp__computer-use__/.test(tool) ? 'Working on the screen' : null);
}

function lastReply(transcript) {
  try {
    const lines = fs.readFileSync(transcript, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      if (e.type === 'user' && typeof e.message?.content === 'string') break;
      if (e.type !== 'assistant') continue;
      const c = e.message?.content;
      const t = Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n\n') : (typeof c === 'string' ? c : '');
      if (t.trim()) return t.trim();
    }
  } catch {}
  return '';
}

try {
  if (process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') process.exit(0);
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const ev = JSON.parse(raw || '{}');
  let body = null;
  // A background task's notice arrives like a message but isn't the person's: the bubble keeps what it was saying.
  if (mode === 'start' && /^\s*(\[SYSTEM NOTIFICATION|<task-notification|<system-reminder)/.test(String(ev.prompt || ''))) process.exit(0);
  if (mode === 'start') body = { state: 'working', fresh: true, doing: 'Reading your message', asked: oneLine(ev.prompt) };
  else if (mode === 'done') {
    let said = (typeof ev.last_assistant_message === 'string' && ev.last_assistant_message.trim()) || lastReply(ev.transcript_path), from = said ? 'first read' : '';
    if (!said) { await new Promise(r => setTimeout(r, 500)); said = lastReply(ev.transcript_path); from = said ? 'second read' : 'nothing'; } // the last words can land a moment after Stop
    fs.appendFile(path.join(os.tmpdir(), 'glass-bubble.log'), `${new Date().toISOString()} done ${from} ${said.length} chars
`, () => {});
    body = { state: 'done', said };
  }
  else if (mode === 'tool') {
    let last = 0; try { last = Number(fs.readFileSync(STAMP, 'utf8')) || 0; } catch {}
    const img = ev.tool_name === 'Read' && /\.(png|jpe?g|webp)$/i.test(ev.tool_input?.file_path || '') ? ev.tool_input.file_path : '';
    const doing = img ? (/shots[\\/]/.test(img) ? (/second/.test(img) ? 'Looking at your second screen' : /main/.test(img) ? 'Looking at your main screen' : 'Looking at your screen') : `Looking at ${name(img)}`)
      : Date.now() - last >= 2000 && handsFor(ev.tool_name, ev.tool_input);
    if (doing) { fs.writeFileSync(STAMP, String(Date.now())); body = { state: 'working', doing }; if (img) body.peek = img; }
  }
  if (body) body.sid = ev.session_id;
  if (body) await fetch(GLASS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) });
} catch { /* glass down or odd input */ }
process.exit(0);
