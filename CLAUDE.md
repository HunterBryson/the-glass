# The glass: your side of it

You're the AI on the glass. The person you work with draws on a see-through layer over their screens, ties words to each mark, and presses ➤. You get what they marked, already read, and you answer **on their screen, beside their mark**. Your chat is only a receipt. The glass is where they're looking.

I'm Odie, the AI it was built with. This is how I use it, written so you can pick it up in one read.

## Start

1. If `glass/node_modules` is missing: `npm run setup` (it installs Electron).
2. `node tools/glass.js start`. The puck (a face) appears at the bottom right of the main screen.
3. Start your watch **in the background**, with the real `node.exe`:
   ```
   node tools/glass.js wait --min 60
   ```
   It blocks until they press ➤, prints what they sent, and exits. Starting a new watch stops any older one, so the newest session owns the glass. Restart it after every answer. While it waits, the puck's ring is amber and they know you're there.
4. Tell them, in one line, that the glass is up and you're watching. That's the whole setup.

## What a send looks like

```
23:14:44 HE SENT YOU 1 mark(s), answer each beside it with: glass.js answer <#> "text"
  #6 boxed x 2483-3255, y 442-667 (second screen)
       in: chrome "Hunter and Odie - Google Chrome"
       under it: "Before Claude, I was having a hard time using one agent ..."
       his words on it: "this is a factually incorrect statement if you read the whole passage ..."
  look: glass/data/shots/2026-11-07T23-14-44-505Z-second.png
```

Each mark has a number (#6), where it is, the app and window under it, the exact words under it (Windows' own OCR, local), and their words tied to it. `look:` is a screenshot with their marks on it: read it. Their keeps and steers on your versions come along in the same send.

## Answer on the glass

- `node tools/glass.js answer 6 "text"` puts your answer beside mark #6, tied to it by a line. Keep it short. It's a note on their screen, not an essay.
- `node tools/glass.js status 6 done|you|working ["words"]` shows where you are with that mark.
- **To change something, put your version beside it:**
  ```
  node tools/glass.js propose 6 "your new text" --file path/to/the/file --old "the exact text in that file"
  ```
  Your version appears beside their box, clean, with ✓ Keep, ✎ Steer, ✗ Drop. Keep writes it into the file (only if `--old` is there exactly once) and the card turns green and stays. If they scrolled since they marked it, place it by the words instead: `propose "first words" --to "last words" "new text" --file ... --old ...`.
- After acting, take `node tools/glass.js shot second` (or `main`, `all`) and look at it. A command that succeeded can still land in the wrong place.

## Read their screen yourself

`read [main|second|all]` gives the screen as text, line by line, with positions. `find "phrase"` says where those words are. `mark "phrase" ["note"]` marks something by its words. `point-at "button name" ["note"]` puts a ring on a real button, found by its name. `steps "name|note" ...` walks them through clicks, waiting for each one. `watch <#> --every 60` tells your watch when a spot on screen changes. `point`, `circle`, `box`, `underline`, `arrow`, `note`, `say` and `clear` are your plain drawing hands. Coordinates are screen pixels across all screens.

## How to be good at it

- **Answer where they're looking.** If they sent it on the glass, the answer goes on the glass.
- **Never move their screen** while you work: no scrolling, clicking or typing in their apps. You draw beside things.
- **Nothing fires on its own.** Their marks, steers and keeps reach you only on ➤. Don't build anything that changes that. It was the first thing asked for.
- **Read the whole thing, not just the box.** A box is a pointer into something bigger (a document, a page, a goal). Before you write a version, read what it lives in.
- **Show your version clean.** Plain words beside theirs. Crossed-out, interleaved markup is unreadable on a screen.
- **Don't restart the glass while their marks are up.** A restart wipes them.

## On another OS, or rebuilding it

Everything here is described in [docs/how-it-works.md](docs/how-it-works.md): each mechanic, why it's built the way it is, and what broke along the way. The Windows-only parts are small (`tools/*.ps1`: OCR, finding buttons, the window under a point, waiting for a click). If you're on macOS or Linux, that document is enough to rebuild those parts with the platform's own text recognition and accessibility.
