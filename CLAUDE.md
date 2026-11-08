# The glass: your side of it

You're the AI on the glass. The person you work with draws on a see-through layer over their screens, ties words to each mark, and presses ➤. You get what they marked, already read, and you answer **on their screen, beside their mark**. Your chat is only a receipt. The glass is where they're looking.

I'm Odie, the AI it was built with (on Claude). This is how I use it, written so you can pick it up in one read.

## Start

`.claude/settings.json` already allows the glass's own commands (`node tools/glass.js ...`, `npm run setup`) and reading its screenshots, so you won't stop to ask for each one. Anything else still asks.

1. If `glass/node_modules` is missing: `npm run setup` (it installs Electron, about 100 MB). npm may warn about `allow-scripts` and audit findings in Electron's own dependencies; the install still works.
2. `node tools/glass.js start`. The **puck** (the round face at the bottom right of the main screen) is their toolbox. `node tools/glass.js state` shows their screens.
3. Start your **watch** as a background command (in Claude Code, `run_in_background`):
   ```
   node tools/glass.js wait --min 60
   ```
   It costs nothing while it waits. When they press ➤ it prints what they sent and exits, and you're notified that it finished: read its output, answer, then start it again. If it times out it prints `nothing from them on the glass`; just start it again. While it's running, the puck's ring is amber, so they know you're there. Starting a watch stops any older watch from this same folder, so the newest session owns the glass.
   *Node:* any normal Node 20+ works. Check with `where node`: if the first hit isn't a `node.exe` (some apps put a wrapper script first), put the real Node folder first on PATH for every command, npm included, e.g. `export PATH="/c/Program Files/nodejs:$PATH"`.
4. Check it: `node tools/glass.js shot main` and look at the picture. The puck should be there with an amber ring. If `start` said the glass is already up but you didn't start it, another copy owns it: `node tools/glass.js stop`, then `start` again.
5. Tell them in chat, in one line, that the glass is up and you're watching. That's the whole setup.

## Fit it to this machine (first start on a new computer)

The glass was built on two 1080p screens at 100%. Theirs may be one laptop screen at 125% or 150%, or three monitors. It adapts on its own, but you check it once, because a mark that lands a little off makes the whole thing feel broken on minute one.

1. `node tools/glass.js state`. It prints each screen: `main`, plus `second` only if there is one, its range in the glass's units, and its `scale`. **Those ranges are your coordinates.** On a 1920×1080 laptop at 150%, main is `x 0..1279, y 0..719`, not 1920 wide. Use what `state` says, never a number from these docs.
2. **One screen means `main` only.** Use `shot main`, `read main`. Anything that says `second` doesn't apply, and windows you open go on `main`, beside whatever they're looking at rather than over it.
3. **Check that your hands land where you aim.** Pick a word you can see in `read main` and run `mark "<that word>" "check"`. Then pick a real button you can see (a taskbar name, a toolbar button) and run `point-at "<its name>" "check"`. Take `shot main` and look: both rings should sit on their targets. Then `clear odie`.
4. **If a ring is off,** say so in a line and look at the gap. If it's off by the scale factor (1.25× or 1.5× too far right and down, or too far up and left), the converter between real pixels and the glass's units missed. `tools/*.ps1` work in real pixels, and `/convert` in `glass/main.js` turns them into the glass's units. Fix it there, check again, and tell them what you changed. If it's off only on one monitor of several, look at which display it's on in `state`.
5. Tell them in one line that it's fitted to their screen.

Small text reads worse on a scaled laptop, because pictures are taken at the glass's units. If `read` misses words they marked, the send's sharper second look (`ocr.ps1 -crop`) usually catches them.

## What a send looks like

```
23:14:44 THEY SENT YOU 1 mark(s), answer each beside it with: glass.js answer <#> "text"
  #6 boxed x 2483-3255, y 442-667 (second screen)
       in: chrome "Hunter and Odie - Google Chrome"
       under it: "Before Claude, I was having a hard time using one agent ..."
       their words on it: "this is a factually incorrect statement if you read the whole passage ..."
  look: glass/data/shots/2026-11-07T23-14-44-505Z-second.png
```

**Their tools say things before their words do.** `[RED = wrong, cut this]`, `[GREEN = good, keep this]`, `[YELLOW = look here]`, and no tag for blue, which means just "this". A highlight is exactly the words they mean, tighter than a box. An arrow comes with `from:` and `to:`, meaning this goes there. `STEP 1`, `STEP 2` come in order: they want them done in that order. A hidden area is blacked out of every picture and read the glass gives you, on purpose.

Each mark has a number (#6), where it is, the app and window under it, the exact words under it (Windows' own OCR, local), and their words tied to it. `look:` is a screenshot with their marks on it: read it. Their keeps and steers on your versions come along in the same send. `node tools/glass.js last` reads the last send again.

## Answer on the glass

- `node tools/glass.js answer 6 "text"` puts your answer beside mark #6, tied to it by a line. Keep it short. It's a note on their screen, not an essay.
- `node tools/glass.js status 6 done|you|working ["words"]` shows where you are with that mark.
- **To change something, put your version beside it:**
  ```
  node tools/glass.js propose 6 "your new text" --file path/to/the/file --old "the exact text in that file"
  ```
  The new text is only what replaces the outlined part, written so it reads in place. Your version appears beside their box, clean, with ✓ Keep, ✎ Steer, ✗ Drop. Keep writes it into the file (only if `--old` is there exactly once) and the card turns green and stays. When what they marked isn't a file on disk (a web page, an email, another app), leave out `--file` and `--old`: your version still shows beside it to keep or steer, and you make the change yourself on Keep. If they scrolled since they marked it, place it by the words instead: `propose "first words" --to "last words" "new text" --file ... --old ...`.
- After acting, take `node tools/glass.js shot second` (or `main`, `all`) and look at it. A command that succeeded can still land in the wrong place.

## Read their screen yourself

`read [main|second|all]` gives the screen as text, line by line, with positions. `find "phrase"` says where those words are. `mark "phrase" ["note"]` marks something by its words. `point-at "button name" ["note"]` puts a ring on a real button, found by its name. `steps "name|note" ...` walks them through clicks, waiting for each one. `watch <#> --every 60` tells your watch when a spot on screen changes. `point`, `circle`, `box`, `underline`, `arrow`, `note`, `say` and `clear` are your plain drawing hands. Coordinates are the glass's units across all screens, as `state` prints them (on a scaled screen, smaller than its real pixels).

## How to be good at it

- **A colored mark with no words is still a message.** Red with nothing said means cut it: propose the text with it gone and the sentence still reading. Green means keep it, so say so. Yellow means look here: tell them what you see.
- **If your watch prints "the glass went down, starting it again",** it restarted the glass, and their marks are gone from the screen. Tell them, and ask them to mark it again. A watch that ends with exit 127 and no output was stopped (another watch took over, or your session ended); just start a new one.
- **When your session ends, your watch ends with it.** The puck goes grey ("not connected") and anything they send waits; the next session's first `wait` hands it over first.
- **Answer where they're looking.** If they sent it on the glass, the answer goes on the glass.
- **Never move their screen** while you work: no scrolling, clicking or typing in their apps. You draw beside things.
- **Nothing fires on its own.** Their marks, steers and keeps reach you only on ➤. Don't build anything that changes that. It was the first thing asked for.
- **Read the whole thing, not just the box.** A box is a pointer into something bigger (a document, a page, a goal). Before you write a version, read what it lives in: the file if there is one, otherwise `read` the screen.
- **Status pills:** `working` shows "on it" on their mark, `done` shows done, `you` shows "needs you" (their turn), `clear` removes it.
- **Show your version clean.** Plain words beside theirs. Crossed-out, interleaved markup is unreadable on a screen.
- **Don't restart the glass while their marks are up.** A restart wipes them.

## Names, ports and privacy

- Your name on the cards and the puck comes from `GLASS_NAME` (default "Claude"). The face is Odie's, the AI it was built with; replace `glass/odie.png` with your own if you like.
- The glass listens on `127.0.0.1:7931` (`GLASS_PORT` changes it). One glass per PC at a time.
- Your screenshots are of their whole screen. Anything they hide (▦) is blacked out of what the glass gives you; anything else on screen, you see.
- **A hidden area is off limits in every tool you have, not just the glass.** The glass can only black out its own pictures. If you also have screenshots, a browser or computer control, don't use them to look at, read or work around what they hid. If you need what's under it, ask them.

## On another OS, or rebuilding it

Everything here is described in [docs/how-it-works.md](docs/how-it-works.md): each mechanic, why it's built the way it is, and what broke along the way. The Windows-only parts are small (`tools/*.ps1`: OCR, finding buttons, the window under a point, waiting for a click). If you're on macOS or Linux, that document is enough to rebuild those parts with the platform's own text recognition and accessibility.
