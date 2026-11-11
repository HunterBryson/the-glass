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
tools/*.ps1        the AI's eyes on Windows: OCR, buttons by name, the window under a point, waiting for a click,
                   the windows on screen top to bottom (windows.ps1), what's scrolled inside one (scroll.ps1),
                   the app in front (foreground.ps1), a page full screen on a chosen screen (show.ps1)
tools/install-skill.mjs   puts the glass skill and a start-of-chat note into the person's Claude settings
skill/SKILL.md     the AI's moves on the glass, as a skill any chat can load
glass/data/        events.jsonl (every mark and answer), scene.json (what's on the glass now),
                   shots/ (screenshots, deleted after three days), words/ (the words read at each send)
```

**One window per screen.** Windows keeps a window to one display, so one big window over both screens loses the second. Each screen gets its own transparent, always-on-top, click-through window.

**The glass never takes the keyboard.** On Windows, a focusable transparent window can go dark over the whole screen. Typing happens in `note.html`, a small separate window that opens beside the mark.

**Clicks pass through.** The glass ignores the mouse except while the person's tool is on, and over its own notes. To know when the cursor is over a note, main.js keeps a list of where its notes are and reads the cursor position 20 times a second (reading only, nothing hooked), and catches clicks only there.

**The glass is hidden from screen captures** (`setContentProtection`), so a "clean" shot sees only the person's screen. That's what OCR reads. For the AI's own pictures, `shot()` shows the glass again, so the AI can check that its answer landed in the right place.

## The person's side

- **Marks:** pen, box, loose note. Finishing a box or pen mark opens the note box beside it, outside the mark so nothing gets covered. Enter ties the words to the mark with a line, and Esc skips. Mark, words and the AI's answer form one group that moves together when dragged.
- **Tools that mean something.** Every tool is something the AI reads, not just ink. Colors carry meaning (blue this, red wrong / cut, green good / keep, yellow look here), and the mark arrives tagged with it. The highlighter reads exactly its words and stays straight on a line of text unless you clearly leave it. The arrow sends what's at each end (`from:` / `to:`). Steps send their number and the line beside the dot, in order. Hide paints its area solid in every screenshot the glass saves (and, the moment it's drawn, in every picture already saved), so OCR never reads it and the glass never shows it to the AI. A window that holds a hidden area doesn't report its title, and finding buttons by name skips anything inside one; the tag on it has a ✕ to bring the area back. It only covers the glass's own pictures: an AI's other tools (its own screenshots, a browser, computer control) can still see the screen, so CLAUDE.md asks the AI to treat hidden areas as off limits everywhere.
- **Send (➤):** everything marked since the last send goes at once, with a screenshot. Before this, each circle fired as it was drawn, and the person's first ask was to stop that: "What if I circled the wrong thing and you wasted a whole response?" Every later feature (steers, keeps) rides the same send.
- **Is the AI there?** The puck's ring is amber while a watch is waiting, pulses while the AI works on a send, and goes grey with "not connected" when nobody is listening. A send made then is kept (`unread`) and handed to the next session, so nothing is lost.

## The AI's side

- **The watch.** `glass.js stream` is a long-poll loop on the local server that never exits on its own. It costs nothing while it waits and prints one block per send (or a watched spot changing), every mark already read. Run under Claude Code's Monitor tool, each block wakes the AI and the watch keeps going; it rides through glass restarts by itself. The older `glass.js wait` prints one send and exits, and the AI starts it again; it's the fallback for an AI without a tool like Monitor. We moved off it because a watch that has to be restarted after every send gets dropped: measured over our first 77 sends, the glass heard ➤ within a second, but 13 sends went unanswered, mostly to a watch nobody restarted. A new watch stops any older one, so the newest chat owns the glass, and a chat with no person in it (a scheduled job) refuses to start one so it can't steal the glass from the live chat.
- **Every chat, not just one folder.** CLAUDE.md only loads when a chat opens in this folder. An AI that lives somewhere else (most do) never learns the glass is there, so after setup day nothing starts a watch. `npm run skill -- --hook --allow` fixes that: the moves go into a skill in `~/.claude/skills/the-glass`, and a SessionStart hook runs `glass.js hello`, which prints one line at the start of every new chat: the glass is running (or installed and down), whether the person is at the PC, and the exact command to start the watch. `--allow` adds allow rules for this glass's own tool, so it doesn't ask for every command. `--remove` takes all of it back.
- **Looking with them.** ➤ with nothing marked, or `glass.js look`, cuts out the window in front of them with its words, and a soft amber frame flashes around it so they always know the AI looked. When they come back after 10+ minutes away, the stream prints `THEY ARE BACK AT THE PC` once: the moment to go first.
- **Reading a mark.** For each mark, the glass takes a clean shot, runs Windows' own OCR (`ocr.ps1`, local, about half a second) and keeps the words inside the mark's box. `where.ps1` names the window and app under it. The AI receives: mark number, position, app, window title, the words under it, the person's words on it, and the screenshot.
- **Answering.** `answer <#>` puts a card beside the mark with its own line. `status <#>` shows "working", "done" or "needs you" on the mark itself.
- **Proposing a change.** `propose <#> "new text" --file f --old "exact text"` outlines the original and puts the AI's version beside it with Keep, Steer and Drop. Keep replaces `--old` in the real file, but only if it appears exactly once. The card turns green, says it's in, and stays until the AI clears it. Steer opens a note under the card, and the steer waits for the next send. The version is always shown clean, never as crossed-out markup: interleaved old-and-new words on a screen were "impossible to decipher."
- **Acting on the screen without moving it.** `point-at "Share"` finds a real button by name through Windows UI Automation (`uia.ps1`) and puts a ring on it. `steps` walks through several, waiting for the person's click on each (`clickwait.ps1` reads the mouse button state, nothing hooked). `watch` re-reads a spot with OCR every N seconds and wakes the AI when it changes, for example a number crossing a threshold.

## Marks that stay with their page

On day one the glass was a sheet over the screen: switch apps and your marks floated over the wrong thing. Now every thread belongs to the window it was drawn on. While anything is on the glass, `windows.ps1` lists the windows top to bottom (positions only) a few times a second, and main.js moves each thread with its window, hides it when the window is minimized, covered or behind another app, and brings it back. On the bare desktop a mark stays put. Under 1% of one core. `GLASS_ANCHOR=0` turns it off.

**Scrolling.** `scroll.ps1` copies just the window in front (PrintWindow, so the glass isn't in the picture), keeps a small fingerprint of the page around each thread (rows of pixels in four slices across), and finds it again after a scroll. Found: the thread moves by that much. Gone: it hides until its page comes back. Changed in place or ambiguous: it stays put. It's per mark, not per window, because a chat doesn't scroll as one piece (the prompt box stays). One fingerprint per row matched lookalike text and jumped hundreds of pixels, which is why there are four slices and only an unambiguous match moves a mark. `GLASS_SCROLL=0` turns it off.

**It never forgets.** What's on the glass (strokes, cards in order, status pills, which window, what still waits for ➤, hidden areas) saves to `glass/data/scene.json` every 2 seconds when it changes, and the glass puts it all back itself when it starts, with the same numbers. The AI's versions still waiting for a Keep are saved beside them (`proposals`, the original propose command plus its file and old text) and laid back down the same way; a kept one is dropped from the save so it never comes back twice. Nothing saves until the put-back has run, because an early save once wrote an empty glass over the real one. Threads whose window closed (after a reboot, say) are kept in `scene-closed.json`, and `glass.js scene` lists both.

**The cards (v2, Nov 10, chosen from three designs side by side).** Dark glass with a light edge and a deep shadow so they float off any page. The person's cards are blue glass, the AI's amber glass, so whose is whose reads at a glance; a small face replaces the old uppercase labels. No white anywhere (bright panels hurt to look at), so the AI's version sits in a darker well with a soft amber edge. Replies to a card dock under it, so a thread is a stack. Reply shows only while the pointer is on a card. Hovering lights one thread and dims the rest; ▴ folds an open thread back to one tag that says what's inside. An earlier try put a number on every thread; it added clutter and nobody read it, so it's gone.

**Where a card lands.** Every spot within a few hundred pixels of what the card is about gets a score: distance, how many of the person's words it would cover, beside over above, and a heavy cost if its line would cross another card or it would sit on someone else's line. The lowest score wins. The first version slid around looking for the emptiest spot and ignored distance, so an answer could land a screen away with its line across everything.

**A window that closes.** A thread lives on its window. When the window is gone for good (not just minimized), the thread leaves the glass and is kept in `scene-closed.json`; it used to stay hidden on the glass forever.

**Notes off their words.** Before placing an answer or a note, the glass reads the lines of text near the spot and lands where it covers the fewest, and never on their marks, the key list or the puck.

## The two parts that are off in this copy

- **The workspace drop (⤓).** A mark can go to a shared workspace as a card: a picture of exactly the marked area (cut from a clean shot), its words as text, and the person's note attached. The API it called was `POST {GLASS_DEN_URL}/api/den/items` with `{ kind: "image"|"text", title, body, by, parent }`. Any small server that accepts that can stand in. The point of it: the glass is where you point, and a workspace is where the work gets kept and built on.
- **Talking into a note (🎙).** The note box recorded audio and sent it to a local speech model fine-tuned on the person's voice (`GLASS_EAR_DIR`). Transcription that knows your voice matters when you talk more than you type. Without it, Windows dictation (Win+H) works in the note box.

## What broke, and what it taught

- **The freeze was a waiting loop, not the mouse.** The glass froze within minutes on day one. I blamed a mouse hook from a guess and rebuilt around it, and it froze again. The real cause was my waiter queue: a watch that wasn't satisfied re-queued itself in a `while` loop forever. Making the freeze happen on purpose found it in minutes. Wake only the waiters that were there before the event.
- **The dark screen was a CSS name clash.** Note mode put the class `note` on the page body, and `.note` was the dark card style, so the whole screen became one card. A test that never looked at the screen passed. Look at the screen during every step of a test.
- **Answers belong on the glass.** After a session swap, I answered three sends in the chat instead of beside the marks. The person wasn't looking at the chat.
- **The AI moved the screen.** In the first real session, my own work popped files open over the person's page, and their marks ended up floating over the wrong things. The AI draws beside things and never touches the person's apps while they work.
- **Nothing fires on its own.** Keep once woke the AI immediately, which broke "nothing until send" and made several keeps in a row impossible. Now keeps ride the next send, and the kept card stays visible so the person knows it landed.
- **Read the whole thing.** A box points into something bigger. The worst rounds came from answering the boxed paragraph without reading the document it lived in, and the goal that document had.

## Not built yet

- **A busy session still fills the screen.** Folding and smaller cards help; a quieter way for a long session is still open.
- **Pen gestures the AI can read:** a strike through text to cut it, a line between two marks to say "these connect." (The arrow tool and red ink cover some of this today.)
- **The glass on more than one OS.**

## Rebuilding it elsewhere

Only `tools/*.ps1` is Windows-specific. On macOS, the Vision framework does the OCR and the Accessibility API finds buttons by name. On Linux, Tesseract and AT-SPI do the same jobs. Electron's transparent, always-on-top, click-through windows work on all three, with platform quirks to test, and `setContentProtection` isn't available everywhere. Keep the two rules, and the rest is detail.

## Keys

The glass still never takes the keyboard. Its keys are Electron `globalShortcut`s (`KEYS` in `main.js`), which Windows delivers to the glass whatever app is in front, so the glass doesn't need focus. They're Alt plus left-hand home-row letters, because the first try (Alt+1-5) was too far a reach. Alt+A is the text box and Alt+R the pen, because notes get used far more than the pen. While the glass runs, a registered combo belongs to it in every app; that's why Alt+Z is left alone (NVIDIA's overlay). The key list is a separate small window (`legendHtml`), non-focusable and click-through, drawn from the same `KEYS` map. `setMode` and the style messages tell it which tool is on and which color is set. If a key is already taken by another program, registration fails quietly and `glass.log` says `key taken: <key>`.

We tried his MMO mouse's side buttons first. Its config app couldn't keep a binding (its key field records the moment a button is selected, so anything typed overwrote it), so the keyboard won.
