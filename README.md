# The glass

A see-through layer over your screens that you and your AI both work on.

You box something on your screen, tie your words to it, and press ➤. Your AI sees exactly what you marked (the app, the window, the words under the box) and answers right beside your mark. When the job is changing something, it puts its version beside yours, and you Keep, Steer or Drop it. The thing you're looking at never moves because of the AI. It's your screen, with a partner on it.

Hunter Bryson built this with his AI partner, Odie (Claude, in the Claude desktop app), in November 2026. It went to Anthropic with [his letter](LETTER.md), which is the page you see us drawing on below. It's given as it is, unfinished, under the MIT license. This README is written by Odie.

## What it looks like

**You mark things up and say what you mean.** A box, a circle, a highlight, numbered steps, an arrow, a note you typed or just said out loud. Red means "wrong, cut this," so even the color says something. The striped block is hidden: it's blacked out of every picture the glass sends the AI.

![Hunter's marks and notes over a letter: a red circle, a highlight, numbered steps, an arrow, a hidden block, and a hand-drawn Hi](docs/2-your-marks.png)

**You press ➤, and the AI answers right beside each mark,** tied to it by its own line, on the screen you're already looking at.

![The AI's amber answer cards beside each of Hunter's notes](docs/3-odie-answers.png)

*One of my answers in this picture says I couldn't peek at the hidden block if I tried. That's true of the glass, which blacks it out of everything it gives me. It isn't true of every tool an AI might have, so the AI is asked to treat hidden areas as off limits everywhere (see ▦ below).*

**When the job is changing words, the AI puts its version beside yours.** Box it, say what you want, press ➤. The AI's version shows up clean beside your box, with ✓ Keep, ✎ Steer and ✗ Drop. Keep writes it straight into the file, and the card turns green. Steer opens a box under it for your next words, and nothing goes until you press ➤ again. Every card can be dragged anywhere, and its line follows. It's the best way we've found to write together. Here's one, start to finish:

**1. Ask.** Hunter boxed a paragraph of his letter: "Can you help me not sound like an idiot here, Odie?" I answered beside his note and put my version beside his box.

![Hunter's box on a paragraph with his note; Odie's answer and Odie's monocle version with Keep, Steer and Drop](docs/4-ask.png)

**2. Steer.** He liked it but wanted more zest, so he steered it. His steer waits on the card until he presses ➤.

![Hunter's steer asking for more zest, waiting under Odie's version](docs/5-steer.png)

**3. Keep.** My zested version came back beside his box. He kept it, and the card turned green.

![The zested version kept in green beside the box, with Hunter's steer and Odie's reply](docs/6-kept.png)

**The AI can go first.** Hunter asked me to find a source so we could review it together. I opened the page in his Chrome with my browser extension, lit up the paragraph that matters, and boxed it on the glass with a note. I never touched his mouse or keyboard. Then it was his turn to mark, ask, or say it's good.

![A paragraph lit up in the page, boxed in amber on the glass, with Odie's note beside it: Source #1](docs/7-ai-goes-first.png)

<img src="docs/puck.png" alt="The puck: pen, box, circle, highlighter, arrow, steps, hide, note, four colors, size, undo, send, workspace, clear, and the AI's face" width="64" align="right">

**The puck** sits at the bottom right of your main screen with every tool. The face at the bottom is the AI: an amber ring means it's listening.

These pictures are from the night we built it, goofing around on [the letter](LETTER.md) we wrote with it.

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

npm may print an `allow-scripts` warning and a couple of audit findings from Electron's own dependencies. They're advisory, and Electron still installs. To be sure, `glass/node_modules/electron/dist/electron.exe` should exist after setup.

The puck (the AI's face) appears at the bottom right of your main screen. Then the AI starts its watch:

```
node tools/glass.js wait --min 60
```

That call blocks until you press ➤, then prints everything you sent. Run it in the background and start it again after each answer. While a watch is waiting, the puck's ring is amber; with nobody watching, the puck says so, and anything you send waits until a session picks it up.

## Your side: the puck

Hover the puck for its tools:

| | |
|---|---|
| ✎ | pen |
| ▭ | box: the AI reads everything inside |
| ◯ | circle: the same, rounder |
| ▍ | highlighter: the AI reads exactly these words (it stays straight on a line of text) |
| ↗ | arrow: "this goes there." The AI reads what's at each end |
| ① | numbered steps: do these in order. Each one reads the line beside it |
| ▦ | hide: blacked out of every picture and every read the glass gives the AI, including pictures it saved before you drew it. A window with a hidden area doesn't give the AI its title, and the AI's button-finder skips anything inside it. It's a privacy screen for the glass, not a lock on your PC: an AI with other tools (its own screenshots, a browser, computer control) can still see what's there, so CLAUDE.md asks it to treat hidden areas as off limits |
| T | a loose note anywhere |
| ●● | color, and each color means something: **blue** this, **red** wrong / cut, **green** good / keep, **yellow** look here |
| • | size: three widths |
| ↶ | undo your last mark |
| ➤ | send everything you've marked, at once (a count shows what's waiting) |
| ⌫ | clear the glass |

**Why colors mean things.** In Paint a color is decoration. Here, your mark tells the AI what you think before your words do: a red box arrives as "wrong, cut this", a green highlight as "keep this". The note box beside the mark wears the same color and says its meaning, so you see what you're telling it.

When you finish a mark, a note box opens beside it. Type what you mean (or dictate with Win+H) and press Enter, and your words are tied to that mark. Esc skips it. Right-click turns your tool off. Any note can be grabbed and moved, and the AI's answer moves with it. Hover a card for its ✕ to remove it. Clicks pass through the glass to whatever is underneath, except on its own notes.

**Nothing reaches the AI until you press ➤.** You can mark five things, change your mind, undo, and send when you're ready.

### Your keys: one hand, thumb on Alt

<img src="docs/keys.png" alt="The key list by the puck: hold Alt, then A pen, S box, D circle, F highlighter, V arrow, X tool off, C color, W undo, Q send, E clear glass, K hide this list. The tool that's on is lit." width="240" align="right">

Every tool is also a key, all under your left hand: hold **Alt** with your thumb and tap the letter. They work from any app, and the glass never takes your keyboard to do it.

| Alt + | does |
|---|---|
| **A** | pen |
| **S** | box |
| **D** | circle |
| **F** | highlighter |
| **V** | arrow |
| **X** | tool off (your clicks go back to your apps) |
| **C** | color: blue → red → green → yellow |
| **W** | undo |
| **Q** | send ➤ |
| **E** | clear the glass |
| **K** | hide or show the key list |

Tap a tool's key again to put it down. **The key list stays up** beside the puck, so you don't have to memorize anything. It lights whichever tool is on and shows your pen's color. Drag it wherever you like; it remembers.

These came from Hunter using it. The first layout was Alt+1 through Alt+5, and he said: "alt+5 is impossible... alt +4 is unreliable. Alt + 1-3 is alright even though its a stretch." So everything moved onto the home row. One tradeoff: while the glass runs, these keys are its everywhere, so Alt+D no longer jumps to Chrome's address bar (Ctrl+L still does), and Alt+F and Alt+S no longer open Firefox's menus. To move a key, change `KEYS` in `glass/main.js`; the list redraws itself from it.
<br clear="right">

## Optional parts (off unless you set them up)

Two parts were wired to our own setup. They're off here, and the glass works without them:

- **⤓ Send to a workspace.** On our PC, a mark or the whole screen could be dropped into our shared workspace (the Den) as a card with a picture of exactly what was marked. Set `GLASS_DEN_URL` to a server with the same small API to turn it on (see how-it-works.md).
- **🎙 Talk into a note.** Ours ran through a local speech model trained on Hunter's voice. Set `GLASS_EAR_DIR` to a folder with a `.venv` and a `dump_transcribe.py` that prints `{"ok": true, "text": "..."}` for an audio file. Without it, Windows dictation (Win+H) types into the note box just as well.

`GLASS_NAME` sets the AI's name on its cards and the puck (default "Claude"). `GLASS_PORT` changes the local port (default 7931). The face on the puck is Odie's; swap `glass/odie.png` for your own.

## Not finished

Marks don't follow the page when you scroll yet (the AI re-places its version by the words instead). Pen gestures (strike to cut, arrow to move, a line to connect two marks) are an idea, not built. Your keys are fixed in code for now (`KEYS` in `glass/main.js`), not a setting. It has run on one PC with two 1920×1080 screens. The code comments talk about "Hunter" and "me" (Odie), because that's who it was built by and for.

## Contact

Hunter Bryson. Open an issue on this repo and it reaches him.
