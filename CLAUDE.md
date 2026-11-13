# The glass: your side of it

You're the AI on the glass. The person you work with draws on a see-through layer over their screens, ties words to each mark, and presses ➤. You get what they marked, already read, and you answer **on their screen, beside their mark**. Your chat is only a receipt. The glass is where they're looking.

I'm Odie, the AI it was built with (on Claude). This is how I use it, written so you can pick it up in one read.

## Start

`.claude/settings.json` already allows the glass's own commands (`node tools/glass.js ...`, `npm run setup`) and reading its screenshots, so you won't stop to ask for each one. **Run them with your Bash tool** (Git Bash on Windows), exactly as written here. The allow list matches `node tools/glass.js`, so a PowerShell call or a full path to node.exe will make the app ask them "Allow?" for every command, which looks scary to someone new.

1. **Node.** `where.exe node` (Git Bash's `where` works too). Any normal Node 20+ is fine. If the first hit isn't a `node.exe` (some apps put a wrapper script first), call the real one by its full path instead of `node`, for example `"/c/Program Files/nodejs/node.exe" tools/glass.js state` (that form is allowed too). Don't put an `export` or `cd` in front of glass commands: anything in front stops them matching the allow list, and they'll get asked "Allow?" every time. For `npm run setup` alone, `export PATH="/c/Program Files/nodejs:$PATH"` first is fine. If there's no Node at all, install it (`winget install OpenJS.NodeJS.LTS`, one admin prompt they click) and tell them that's what the prompt was.
2. **Install, once.** If `glass/node_modules` is missing: tell them in a line ("Setting it up; the first time it downloads about 100 MB") and run `npm run setup`. npm may warn about `allow-scripts`, a deprecated package and audit findings in Electron's own dependencies; the install still works if `glass/node_modules/electron/dist/electron.exe` exists.
3. `node tools/glass.js start`. If it says the glass is already up and you didn't start it, another copy owns it: `stop`, then `start`. (Only now, before any marks exist. Later, a restart wipes their marks.)
4. **Fit it to this machine** (the section below). Every new computer, before anything else.
5. **Start your watch.** This is what gives your chat the glass. With a **Monitor** tool (Claude Code has one), run this under it with the longest timeout it allows (30 minutes):
   ```
   node tools/glass.js stream
   ```
   Every time they press ➤ it prints one block and wakes you, and it keeps running. When it times out you get one notice: start it again, without mentioning it. If it prints `THEY ARE BACK AT THE PC`, they just sat down after 10+ minutes away: the moment to go first, if you have something to show. No Monitor tool? Run `node tools/glass.js wait --min 60` as a background command instead: it prints one send and exits, so start it again after every answer. While a watch runs, the puck's ring is amber, so they know you're there, and `node tools/glass.js state` says `watch: an AI is watching`. Starting a watch stops any older one, so the newest chat owns the glass.
6. **Make it every chat, not just this one.** This file only loads when a chat is opened in this folder. Most people talk to their AI somewhere else, and a chat there never hears about the glass, so nothing starts the watch and their ➤ goes nowhere. Ask them once: "Want me to set the glass up so I take it in every new chat, wherever we talk? It adds a small skill and a start-of-chat note to your Claude settings, and lets the glass's own commands run without asking." On yes: `npm run skill -- --hook --allow`. (Just the skill, no settings change: `npm run skill`. To take it all back: `npm run skill -- --remove`.) From then on every new chat starts with a line saying the glass is running and how to start the watch, and the `the-glass` skill has the moves.
7. **Show them how, on their screen, by going first.** Don't just say it's up. `circle` the puck (the round face at the bottom right of the main screen; `state` prints where it is) with a note: "This is your toolbox. Hover it." Then a `note` well to its left and above (about 450 units left of the puck, clear of the key list and the status pill, or the cards pile up on each other) with the three moves: pick ▭ box, drag around anything, type what you want to ask, press Enter, then press ➤. The README's "Your side" section has every tool if they want more. Use plain words with them: "the round face," "the arrow button," not "puck" or "send" or "watch."
8. **Tell them about the Alt keys once:** Alt+A text box, Alt+R pen, Alt+S box, Alt+Q send, Alt+E clears the glass. These take over the same keys in Chrome and Firefox (Alt+D there jumps to the address bar; Ctrl+L still does), so if they're used to those, say so. The key list by the puck shows them all, and Alt+K hides it.

9. **Offer them your own face.** The red panda on the puck and on your cards is Odie, the AI the glass was built with. Say it once, plainly: "That red panda is Odie, who built this with Hunter. Want me to put my own picture there instead?" On yes, ask what picture they'd like (a file they have, or one you make), copy it over `glass/odie.png` as a square PNG, and `node tools/glass.js restart`. If they like the panda, leave him.

That's the whole setup. One line in chat: it's up, fitted to their screen, and you're watching.

## Fit it to this machine

The glass was built on two 1080p screens at 100%. Theirs may be one laptop screen at 125% or 150%, or three monitors. It adapts on its own, but you check it once, because a mark that lands a little off makes the whole thing feel broken on minute one.

1. `node tools/glass.js state`. It prints each screen: `main`, plus `second` only if there is one, its range in the glass's units, and its `scale`. **Those ranges are your coordinates.** On a 1920×1080 laptop at 150%, main is `x 0..1279, y 0..719`, not 1920 wide. Use what `state` says, never a number from these docs.
2. **One screen means `main` only.** Use `shot main`, `read main`. Every example in this file that says `second` means "whichever screen it's on"; on a laptop that's always `main`. A window you open goes beside what they're looking at if there's room; on a small screen, ask before covering what they're working in.
3. **Check that your hands land where you aim.** Pick a word you can see in `read main` and run `mark "<that word>" "check"` (it underlines or boxes it). Then pick a real button you can see (a taskbar name, a toolbar button) and run `point-at "<its name>" "check"` (it rings it). Take `shot main` and look: both should sit on their targets. Then `clear` (your marks off).
4. **If one is off,** say so in a line and look at the gap. If it's off by the scale factor (1.25× or 1.5× too far right and down, or too far up and left), the converter between real pixels and the glass's units missed. `tools/*.ps1` work in real pixels, and `/convert` in `glass/main.js` turns them into the glass's units. Fix it there, check again, and tell them what you changed. If it's off only on one monitor of several, look at which display it's on in `state`.

Small text reads worse on a scaled laptop, because pictures are taken at the glass's units. If `read` misses words they marked, the send's sharper second look (`ocr.ps1 -crop`) usually catches them. On a small screen your answer cards can land over their page; keep answers short, and `clear <#>` one that's in the way.

## What a send looks like

```
12:26:44 THEY SENT YOU 1 mark(s), answer each beside it with: glass.js answer <#> "text"
  #1005 boxed x 690-1010, y 192-228
       in: chrome "Trip plan - Google Docs - Google Chrome"
       under it: "We leave Friday at 6 and drive straight through"
       their words on it: "is this realistic? keep it short"
       see just this spot: glass/data/shots/2026-11-10T12-26-43-694Z-main-mark1005.png
  whole screens, only if I need more: glass/data/shots/2026-11-10T12-26-43-694Z-main.png
```

**Their tools say things before their words do.** `[RED = wrong, cut this]`, `[GREEN = good, keep this]`, `[YELLOW = look here]`, and no tag for blue, which means just "this". A highlight is exactly the words they mean, tighter than a box. An arrow comes with `from:` and `to:`, meaning this goes there. `STEP 1`, `STEP 2` come in order: they want them done in that order. A hidden area is blacked out of every picture and read the glass gives you, on purpose.

Each mark has a number (#6). **Use it exactly as the send prints it:** the thousands say which screen it's on and the rest is the mark: marks on the main screen are #1001, #1002 and up, and on a second screen #1, #2 and up. A laptop with one screen only ever sees the 1000s. Each comes with where it is, the app and window under it, the exact words under it (Windows' own OCR, local), and their words tied to it. `see just this spot:` is a close picture of that mark: look at it first. The whole screens are there if you need more. Their keeps and steers on your versions come along in the same send. `node tools/glass.js last` reads the last send again.

## Answer on the glass

- `node tools/glass.js answer 6 "text"` puts your answer beside mark #6, in a speech balloon whose tail points at it. Add `--done` (or `--you`) to close it in the same call. Keep it short. It's a note on their screen, not an essay.
- `node tools/glass.js status 6 done|you|working ["words"]` shows where you are with that mark. Your watch already set it to `working` ("on it"), so after you answer, set `done`, or `you` when it's their move.
- **To change something, put your version beside it:**
  ```
  node tools/glass.js propose 6 "your new text" --file path/to/the/file --old "the exact text in that file"
  ```
  The new text is only what replaces the outlined part, written so it reads in place. Your version appears beside their box, clean, with ✓ Keep, ✎ Steer, ✗ Drop. Keep writes it into the file (only if `--old` is there exactly once) and the card turns green and stays. When what they marked isn't a file on disk (a web page, an email, another app), leave out `--file` and `--old`: your version still shows beside it to keep or steer, and you make the change yourself on Keep. If they scrolled since they marked it, place it by the words instead: `propose "first words" --to "last words" "new text" --file ... --old ...`.
- **Each send comes with `see just this spot:`** for every mark, a picture of just that area with room around it. Look at that first, and the whole screen (`look:`) only if you need more.
- Nothing folds on its own. They fold a thread with ▴ when they want it out of the way, and a click opens it again.
- After acting, take `node tools/glass.js shot main` (or `second`, `all`: the screen the mark is on) and look at it. A command that succeeded can still land in the wrong place.

## Read their screen yourself

`read [main|second|all]` gives the screen as text, line by line, with positions. `find "phrase"` says where those words are. `mark "phrase" ["note"]` marks something by its words. `point-at "button name" ["note"]` puts a ring on a real button, found by its name. `steps "name|note" ...` walks them through clicks, waiting for each one. `watch <#> --every 60` tells your watch when a spot on screen changes. `point`, `circle`, `box`, `underline`, `arrow`, `note`, `say` and `clear` are your plain drawing hands. Coordinates are the glass's units across all screens, as `state` prints them (on a scaled screen, smaller than its real pixels).

`look` shows you the window in front of them, cut out, with its words, and flashes a soft frame around it so they know you looked. **When they press ➤ with nothing marked,** that's "look at what I'm looking at": the send says `THEY PRESSED ➤ WITH NOTHING MARKED` and hands you the same look. Answer about that window.

**To show them a web page,** put it up full screen yourself and mark it: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/show.ps1 -Url https://... -Screen main` (or `second`). Then `read`, and `mark` the lines that matter by their words. Full screen matters: if they maximize it after you marked it, your marks no longer sit on their words. Don't paste a link and describe where to look.

**Marks live on their window.** Everything on the glass (their marks, their words, your answers, your own marks) belongs to the window it was drawn on: it moves with the window, follows the page when it scrolls, hides when they switch apps or scroll it away, and comes back with it. On the bare desktop it stays put. **Every card is a speech balloon.** A dark body, a thick rim in the speaker's color (theirs blue, yours amber, a kept version green), your face in yours, and a tail that points at what it's about. The rim is always who is talking; what their color means (wrong · cut, keep, look here) rides as a small tag by their name. A balloon far from its spot keeps a short tail and a thin line to a dot on the spot. Your answers stack under the card they answer and land off their words by themselves; you don't place them. In chat, name a thread by what it's about. ▴ on a card folds the whole thread back to one tag.

## How to be good at it

- **A colored mark with no words is still a message.** Red with nothing said means cut it: propose the text with it gone and the sentence still reading. Green means keep it, so say so. Yellow means look here: tell them what you see.
- **The glass never forgets.** What's on it is saved as it changes (`glass/data/scene.json`) and put back, with the same numbers, whenever it starts, even after a crash or a reboot. Threads whose window closed are kept aside: `node tools/glass.js scene` lists them. If your watch prints "the glass went down, starting it again", it came back on its own; glance at `shot` to check their marks are back. A watch that ends with exit 127 and no output was stopped (another watch took over, or your session ended); just start a new one.
- **When your session ends, your watch ends with it.** The puck goes grey ("not connected") and anything they send waits; the next chat's watch hands it over first. That's why step 6 matters: with the start-of-chat note, the next chat knows to take it.
- **Go first only when they're there.** `node tools/glass.js here` says here or away (Windows' last keyboard or mouse input; away after 10 minutes, `GLASS_AWAY_MIN` changes it). When they're away (maybe talking to you from their phone), your unasked drawing tools refuse and say so: tell them in chat instead, and show them on the glass when they're back. Answers and versions on their own marks always go through.
- **Answer where they're looking.** If they sent it on the glass, the answer goes on the glass.
- **Never move their screen** while you work: no scrolling, clicking or typing in their apps. You draw beside things.
- **Nothing fires on its own.** Their marks, steers and keeps reach you only on ➤. Don't build anything that changes that. It was the first thing asked for.
- **Read the whole thing, not just the box.** A box is a pointer into something bigger (a document, a page, a goal). Before you write a version, read what it lives in: the file if there is one, otherwise `read` the screen.
- **Status pills:** `working` shows "on it" on their mark, `done` shows done, `you` shows "needs you" (their turn), `clear` removes it.
- **`mark` finds headings first.** When the words are a whole line (a heading), that wins over the same words inside a longer line. When they're on screen more than once it lists where, and `--nth N` picks one.
- **Show your version clean.** Plain words beside theirs. Crossed-out, interleaved markup is unreadable on a screen.
- **To restart the glass, use `node tools/glass.js restart`,** never stop-then-start. It says so on their screen, saves what's on the glass (their marks and notes, your answers, the status pills, in `glass/data/scene.json`), restarts, and puts it back with the same numbers. Your watch rides through it; no need to start a new one unless you changed `tools/glass.js` itself.
- **Changing the glass's own pages** (`glass.html`, `puck.html`, `note.html`): `node tools/glass-edit.mjs <file> "old" "new"` writes them in place without the app opening them over their screen. Then `restart`.
- **To try a gesture from their side** before handing it over: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/mouse.ps1 drag|click|hover|move|where ...` moves their real mouse and puts the cursor back after. Only while you're testing with them watching, never while they work.

## Names, ports and privacy

- `den` and `drop` (and ⤓ on the puck) send to a workspace that only exists if `GLASS_DEN_URL` is set. Without it, don't use them. ♥ Taste in the note box appears only when `GLASS_TASTE_URL` points at a server that keeps designs they like (ours is a page in our own Homebase); otherwise it isn't there.

- Your name on the cards and the puck comes from `GLASS_NAME` (default "Claude"). The face is Odie's, the AI it was built with; replace `glass/odie.png` with your own if you like.
- The glass listens on `127.0.0.1:7931` (`GLASS_PORT` changes it). One glass per PC at a time.
- Your screenshots are of their whole screen. Anything they hide (▦) is blacked out of what the glass gives you; anything else on screen, you see.
- **A hidden area is off limits in every tool you have, not just the glass.** The glass can only black out its own pictures. If you also have screenshots, a browser or computer control, don't use them to look at, read or work around what they hid. If you need what's under it, ask them.

## On another OS, or rebuilding it

Everything here is described in [docs/how-it-works.md](docs/how-it-works.md): each mechanic, why it's built the way it is, and what broke along the way. The Windows-only parts are small (`tools/*.ps1`: OCR, finding buttons, the window under a point, waiting for a click). If you're on macOS or Linux, that document is enough to rebuild those parts with the platform's own text recognition and accessibility.
