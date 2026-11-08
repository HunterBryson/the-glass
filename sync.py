# Brings this public copy up to date with the glass on Hunter's PC (homebase/glass + homebase/tools),
# then applies the few changes that let it stand alone. Run from this folder: python sync.py
import os, shutil, json

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.join(HERE, '..', 'homebase')
GLASS = ['main.js', 'glass.html', 'note.html', 'puck.html', 'preload.js', 'odie.png', 'package-lock.json']
TOOLS = ['glass.js', 'ocr.ps1', 'uia.ps1', 'where.ps1', 'clickwait.ps1', 'front-window.ps1']

for f in GLASS: shutil.copyfile(os.path.join(HOME, 'glass', f), os.path.join(HERE, 'glass', f))
for f in TOOLS: shutil.copyfile(os.path.join(HOME, 'tools', f), os.path.join(HERE, 'tools', f))

def patch(rel, pairs):
    p = os.path.join(HERE, rel); s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (rel, a[:70]); s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8').write(s)

patch('glass/main.js', [
 ("const PORT = 7931;",
  "const PORT = Number(process.env.GLASS_PORT) || 7931;\n"
  "// Two parts are wired to our own setup and stay off unless you point them somewhere (see README, \"Optional parts\"):\n"
  "// GLASS_DEN_URL: a workspace that takes dropped marks (ours was the Den, inside Homebase).\n"
  "// GLASS_EAR_DIR: a local speech-to-text folder with .venv and dump_transcribe.py (ours was the Ear). Windows dictation (Win+H) works in the note box without it.\n"
  "const DEN_ON = !!process.env.GLASS_DEN_URL, EAR_ON = !!process.env.GLASS_EAR_DIR;\n"
  "const hideOff = w => w && !w.isDestroyed() && w.webContents.executeJavaScript(`for (const id of [${[!DEN_ON && \"'den'\", !DEN_ON && \"'t-den'\", !EAR_ON && \"'mic'\"].filter(Boolean).join(',')}]) document.getElementById(id)?.remove();`).catch(() => {});"),
 ("  puck.loadFile(path.join(__dirname, 'puck.html'));", "  puck.loadFile(path.join(__dirname, 'puck.html')).then(() => hideOff(puck));"),
 ("  noteWin.loadFile(path.join(__dirname, 'note.html'), { query:",
  "  const nw = noteWin; nw.webContents.once('did-finish-load', () => hideOff(nw));\n  noteWin.loadFile(path.join(__dirname, 'note.html'), { query:"),
 ("const EAR = path.join(__dirname, '..', '..', 'ear');", "const EAR = process.env.GLASS_EAR_DIR || path.join(__dirname, '..', '..', 'ear');"),
 ("const HOMEBASE = process.env.HOMEBASE_URL || 'http://127.0.0.1:7930';", "const HOMEBASE = process.env.GLASS_DEN_URL || 'http://127.0.0.1:7930';"),
])
patch('tools/glass.js', [("const BASE = 'http://127.0.0.1:7931';", "const BASE = `http://127.0.0.1:${Number(process.env.GLASS_PORT) || 7931}`;")])
for rel in ['glass/note.html', 'glass/main.js']:
    p = os.path.join(HERE, rel); s = open(p, encoding='utf-8').read().replace('Type or tap the mic.', 'Type, or talk with Win+H.'); open(p, 'w', encoding='utf-8').write(s)
pj = os.path.join(HERE, 'glass', 'package.json'); j = json.load(open(pj)); j['name'] = 'the-glass'; json.dump(j, open(pj, 'w'))
print('synced from homebase')
