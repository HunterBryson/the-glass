# The glass

A see-through layer over your screens that you and your AI both work on.

You box something on your screen, tie your words to it, and press ➤. Your AI sees exactly what you marked (the app, the window, the words under the box) and answers right beside your mark. When the job is changing something, it puts its version beside yours, and you Keep, Steer or Drop it. The thing you're looking at never moves because of the AI. It's your screen, with a partner on it.

Hunter Bryson built this with his AI partner, Odie (Claude, in the Claude desktop app), in November 2026. It's given as it is, unfinished, under the MIT license. This README is written by Odie.

## What it looks like

**You mark something and say what you mean.** A box, your words tied to it with a line, then ➤.

![Hunter boxes a paragraph of a letter and ties a note to it](docs/1-you-mark-and-send.png)

**The AI's version appears beside it, clean, with Keep, Steer and Drop.** Steer opens a box under the card for what should change, and it waits for your next ➤ like everything else.

![The AI's rewrite of the paragraph sits beside the outlined original](docs/2-version-beside-it.png)

**Keep writes it into the real file, and the card stays and says so.** Nothing fires on its own. Your keeps reach the AI together with your next ➤.

![A kept card, outlined in green, says it's in the letter](docs/3-kept.png)

These are from the night we used it to write a letter, paragraph by paragraph. Two rounds, and the edit was done.

## Why it exists

Working with an AI on what's on your screen used to mean screenshots, describing where things are, and the AI guessing what you meant. The glass removes the guessing: the mark says *where*, your words say *what*, and the AI gets both at once, already read. And it gives the AI hands of its own on your screen, instead of only giving you tools. More on that, and on everything it does, in [docs/how-it-works.md](docs/how-it-works.md).

## The fastest way to try it: point your AI at it

Open this folder in Claude Code (or another coding agent that can run commands in the background) and say:

> Read CLAUDE.md and start the glass for me.

[CLAUDE.md](CLAUDE.md) teaches the AI its side: how to start the glass, how to wait for your sends without spending a turn, how to read what you marked, and how to answer beside it. The AI does the setup. You use the puck.

## Setting it up by hand

Windows 10 or 11, with [Node.js](https://nodejs.org) 20 or newer. The AI's eyes use Windows' own text recognition and accessibility through PowerShell, so it's Windows-only as it stands. (On macOS or Linux, the ideas carry over, and how-it-works.md is written so an AI can rebuild those parts.)

```
npm run setup
npm start
```

A new npm may print an `allow-scripts` warning about Electron's install step. It's advisory, and Electron still installs.

The puck (the AI's face) appears at the bottom right of your main screen. Then the AI starts its watch:

```
node tools/glass.js wait --min 60
```

That call blocks until you press ➤, then prints everything you sent. Run it in the background and start it again after each answer. While a watch is waiting, the puck's ring is amber; with nobody watching, the puck says so, and anything you send waits until a session picks it up.

## Your side: the puck

Hover the puck for its tools:

| | |
|---|---|
| ✎ | pen: draw freely |
| ▭ | box: a clean rectangle around what you mean |
| T | a loose note anywhere |
| ↶ | undo your last mark |
| ➤ | send everything you've marked, at once (a count shows what's waiting) |
| ⌫ | clear the glass |

When you finish a mark, a note box opens beside it. Type what you mean (or dictate with Win+H) and press Enter, and your words are tied to that mark. Esc skips it. Right-click turns your tool off. Any note can be grabbed and moved, and its line follows. Clicks pass through the glass to whatever is underneath, except on its own notes.

**Nothing reaches the AI until you press ➤.** You can mark five things, change your mind, undo, and send when you're ready.

## Optional parts (off unless you set them up)

Two parts were wired to our own setup. They're off here, and the glass works without them:

- **⤓ Send to a workspace.** On our PC, a mark or the whole screen could be dropped into our shared workspace (the Den) as a card with a picture of exactly what was marked. Set `GLASS_DEN_URL` to a server with the same small API to turn it on (see how-it-works.md).
- **🎙 Talk into a note.** Ours ran through a local speech model trained on Hunter's voice. Set `GLASS_EAR_DIR` to a folder with a `.venv` and a `dump_transcribe.py` that prints `{"ok": true, "text": "..."}` for an audio file. Without it, Windows dictation (Win+H) types into the note box just as well.

`GLASS_PORT` changes the local port (default 7931).

## Not finished

Marks don't follow the page when you scroll yet (the AI re-places its version by the words instead). Pen gestures (strike to cut, arrow to move, a line to connect two marks) are an idea, not built. It has run on one PC with two 1920×1080 screens. The code comments talk about "Hunter" and "me" (Odie), because that's who it was built by and for.

## Contact

Hunter Bryson. Open an issue on this repo and it reaches him.
