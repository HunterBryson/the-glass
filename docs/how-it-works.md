# How the glass works

Written by Odie, the AI it was built with, for whoever (or whatever) picks it up next. It covers every mechanic, including the two that are off in this copy, why each one is built the way it is, and what broke while we built it. If you're an AI rebuilding this on another platform, this is your spec.

## The idea in one paragraph

A person and an AI both work on the person's real screen. The person marks something and ties words to it, so the AI never has to guess *where* or *what*. The AI gets each mark already read (the app, the window, the words under it), and answers beside the mark, tied to it with a line. When the job is a change, the AI puts its version beside the original, and the person keeps, steers or drops it. Two rules hold everything up: **nothing reaches the AI until the person presses send**, and **the AI never moves the person's screen.**

## The pieces

```
glass/main.js      Electron main process: windows, the local server, sends, reading marks, Keep/Steer, watches
glass/glass.html   one see-through window per screen: the person's marks, the AI's cards, the lines between them
glass/puck.html    the AI's face at the bottom right: the person's tools and whether the AI is listening
glass/note.html    the small window the person types into (the glass itself never takes the keyboard)
tools/glass.js     the AI's hands: a command line that talks to main.js over http://127.0.0.1:7931
tools/*.ps1        the AI's eyes on Windows: OCR, buttons by name, the window under a point, waiting for a click
glass/data/        events.jsonl (every mark and answer), shots/ (screenshots, deleted after three days)
```

**One window per screen.** Windows keeps a window to one display, so one big window over both screens loses the second. Each screen gets its own transparent, always-on-top, click-through window.

**The glass never takes the keyboard.** On Windows, a focusable transparent window can go dark over the whole screen. Typing happens in `note.html`, a small separate window that opens beside the mark.

**Clicks pass through.** The glass ignores the mouse except while the person's tool is on, and over its own notes. To know when the cursor is over a note, main.js keeps a list of where its notes are and reads the cursor position 20 times a second (reading only, nothing hooked), and catches clicks only there.

**The glass is hidden from screen captures** (`setContentProtection`), so a "clean" shot sees only the person's screen. That's what OCR reads. For the AI's own pictures, `shot()` shows the glass again, so the AI can check that its answer landed in the right place.

## The person's side

- **Marks:** pen, box, loose note. Finishing a box or pen mark opens the note box beside it, outside the mark so nothing gets covered. Enter ties the words to the mark with a dashed line, and Esc skips. Mark, words and the AI's answer form one group that moves together when dragged.
- **Tools that mean something.** Every tool is something the AI reads, not just ink. Colors carry meaning (blue this, red wrong / cut, green good / keep, yellow look here), and the mark arrives tagged with it. The highlighter reads exactly its words and stays straight on a line of text unless you clearly leave it. The arrow sends what's at each end (`from:` / `to:`). Steps send their number and the line beside the dot, in order. Hide paints its area solid in every screenshot the glass saves, so OCR never reads it and the glass never shows it to the AI; the tag on it has a ✕ to bring the area back. It only covers the glass's own pictures: an AI's other tools (its own screenshots, a browser, computer control) can still see the screen, so CLAUDE.md asks the AI to treat hidden areas as off limits everywhere.
- **Send (➤):** everything marked since the last send goes at once, with a screenshot. Before this, each circle fired as it was drawn, and the person's first ask was to stop that: "What if I circled the wrong thing and you wasted a whole response?" Every later feature (steers, keeps) rides the same send.
- **Is the AI there?** The puck's ring is amber while a watch is waiting, pulses while the AI works on a send, and goes grey with "not connected" when nobody is listening. A send made then is kept (`unread`) and handed to the next session, so nothing is lost.

## The AI's side

- **The watch.** `glass.js wait` is a long-poll on the local server. It costs nothing while it waits, wakes the AI only on a send (or a watched spot changing), prints every mark already read, and exits. The AI answers, then starts it again. A new watch stops any older one, so the newest session owns the glass.
- **Reading a mark.** For each mark, the glass takes a clean shot, runs Windows' own OCR (`ocr.ps1`, local, about half a second) and keeps the words inside the mark's box. `where.ps1` names the window and app under it. The AI receives: mark number, position, app, window title, the words under it, the person's words on it, and the screenshot.
- **Answering.** `answer <#>` puts a card beside the mark with its own line. `status <#>` shows "working", "done" or "needs you" on the mark itself.
- **Proposing a change.** `propose <#> "new text" --file f --old "exact text"` outlines the original and puts the AI's version beside it with Keep, Steer and Drop. Keep replaces `--old` in the real file, but only if it appears exactly once. The card turns green, says it's in, and stays until the AI clears it. Steer opens a note under the card, and the steer waits for the next send. The version is always shown clean, never as crossed-out markup: interleaved old-and-new words on a screen were "impossible to decipher."
- **Acting on the screen without moving it.** `point-at "Share"` finds a real button by name through Windows UI Automation (`uia.ps1`) and puts a ring on it. `steps` walks through several, waiting for the person's click on each (`clickwait.ps1` reads the mouse button state, nothing hooked). `watch` re-reads a spot with OCR every N seconds and wakes the AI when it changes, for example a number crossing a threshold.

## The two parts that are off in this copy

- **The workspace drop (⤓).** On our PC, a mark could go to our shared workspace (the Den, inside an app called Homebase) as a card: a picture of exactly the marked area (cut from a clean shot), its words as text, and the person's note attached. The API it called was `POST {GLASS_DEN_URL}/api/den/items` with `{ kind: "image"|"text", title, body, by, parent }`. Any small server that accepts that can stand in. The point of it: the glass is where you point, and a workspace is where the work gets kept and built on.
- **Talking into a note (🎙).** The note box recorded audio and sent it to a local speech model fine-tuned on the person's voice (`GLASS_EAR_DIR`). Transcription that knows your voice matters when you talk more than you type. Without it, Windows dictation (Win+H) works in the note box.

## What broke, and what it taught

- **The freeze was a waiting loop, not the mouse.** The glass froze within minutes on day one. I blamed a mouse hook from a guess and rebuilt around it, and it froze again. The real cause was my waiter queue: a watch that wasn't satisfied re-queued itself in a `while` loop forever. Making the freeze happen on purpose found it in minutes. Wake only the waiters that were there before the event.
- **The dark screen was a CSS name clash.** Note mode put the class `note` on the page body, and `.note` was the dark card style, so the whole screen became one card. A test that never looked at the screen passed. Look at the screen during every step of a test.
- **Answers belong on the glass.** After a session swap, I answered three sends in the chat instead of beside the marks. The person wasn't looking at the chat.
- **The AI moved the screen.** In the first real session, my own work popped files open over the person's page, and their marks ended up floating over the wrong things. The AI draws beside things and never touches the person's apps while they work.
- **Nothing fires on its own.** Keep once woke the AI immediately, which broke "nothing until send" and made several keeps in a row impossible. Now keeps ride the next send, and the kept card stays visible so the person knows it landed.
- **Read the whole thing.** A box points into something bigger. The worst rounds came from answering the boxed paragraph without reading the document it lived in, and the goal that document had.

## Not built yet

- **Marks that follow the page when it scrolls.** We built it (find the patch under each mark in a small grey look at the screen, move the group with it; `GLASS_TRACK=1`) and parked it: full-size looks matched cleanly, but it wasn't the angle that mattered. The AI re-places a version by its words instead.
- **Pen gestures the AI can read:** a strike through text to cut it, a line between two marks to say "these connect." (The arrow tool and red ink cover some of this today.)
- **Keyboard shortcuts.** The glass never takes the keyboard (a focused transparent window goes dark on Windows), so single-key shortcuts would need a global hotkey that doesn't steal typing.
- **Keybinds** for the tools, and the glass on more than one OS.

## Rebuilding it elsewhere

Only `tools/*.ps1` is Windows-specific. On macOS, the Vision framework does the OCR and the Accessibility API finds buttons by name. On Linux, Tesseract and AT-SPI do the same jobs. Electron's transparent, always-on-top, click-through windows work on all three, with platform quirks to test, and `setContentProtection` isn't available everywhere. Keep the two rules, and the rest is detail.
