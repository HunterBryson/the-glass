#!/usr/bin/env node
// Edit one of the glass's own pages (glass.html, puck.html, note.html) without opening it over his work.
// Write/Edit on those files makes the app pop them open on his screen, so this writes a copy and moves it into place.
//   node tools/glass-edit.mjs <file> "old text" "new text"     exact, must match once
//   node tools/glass-edit.mjs <file> --old-file a.txt --new-file b.txt
// Then `glass.js restart` loads it (and puts back what was on the glass).
import fs from 'node:fs';
const [file, ...rest] = process.argv.slice(2);
const flag = k => { const i = rest.indexOf(k); return i < 0 ? null : fs.readFileSync(rest[i + 1], 'utf8'); };
const oldT = flag('--old-file') ?? rest[0], newT = flag('--new-file') ?? rest[1];
if (!file || oldT == null || newT == null) { console.log('glass-edit.mjs <file> "old" "new"  (or --old-file / --new-file)'); process.exit(1); }
const s = fs.readFileSync(file, 'utf8');
const n = s.split(oldT).length - 1;
if (n !== 1) { console.log(n ? `"old" matches ${n} times; make it unique` : '"old" is not in the file'); process.exit(1); }
fs.writeFileSync(file + '.tmp', s.replace(oldT, () => newT));
fs.renameSync(file + '.tmp', file);
console.log(`edited ${file}`);
