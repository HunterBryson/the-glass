---
name: the-glass
description: How to work on the person's screen with them through the glass, a see-through layer where they mark things and you answer beside their marks. Use at the start of every chat when the glass is running on this PC (a start-of-chat note says so), whenever a glass send wakes you ("THEY SENT YOU", "THEY PRESSED ➤"), whenever you're about to show them something, point them somewhere or tell them where to click, and whenever they say the glass, the puck, "I sent you something" or "look at this".
---

# The glass

The person you work with has a see-through layer over their screens. They box or circle something, tie a few words to it, and press ➤. You get what they marked, already read, and you answer **on their screen, beside their mark**. You can also go first: circle, box and point at things to show them what you mean. When it works, they barely have to say anything.

Written by Odie, the AI it was built with. These are the moves that made it work for us.

Every command here is the glass's command tool, run by the real Node by its full path (so a wrapper that comes first on PATH can't get in the way). Run them with your Bash tool exactly as written, from any folder, with nothing in front of them, so they match the allow list. `node "{{GLASS}}" state` prints their screens and the coordinates to use (on a scaled laptop they're smaller than real pixels).

## Sitting down (the start of every chat)
1. `node "{{GLASS}}" state`. If it doesn't answer and they want the glass: `node "{{GLASS}}" start`.
2. **Start your watch. This is what gives this chat the glass**, so do it every chat, even if the last chat already did. Only the newest watch gets their sends.
   - With a **Monitor** tool (Claude Code has one; if it's listed as a deferred tool, load it first): run `node "{{GLASS}}" stream` under it with the longest timeout (30 minutes). Every send prints one block and wakes you, and the watch keeps running. When it times out, start it again without mentioning it.
   - Without one: run `node "{{GLASS}}" wait --min 60` as a background command. It prints one send and exits. Answer, then start it again, every time.
   While a watch runs, the round face on their screen (the puck) has an amber ring, so they know you're there. Grey means nobody is listening. To check, run `state` again: it should say `watch: an AI is watching`.
3. `node "{{GLASS}}" here`. **Here** means answer on the glass. **Away** means they're on their phone or gone: answer in chat.

One message, no narration. One line in chat at most: "I'm on the glass."

## When they send
They just pressed ➤ and they're looking at their mark, waiting. Speed is the whole feeling.

1. **Answer beside the mark first.** `node "{{GLASS}}" answer <#> "text"`. If it needs work, the first card says what you're about to do, within seconds, then do it. Never leave them looking at a silent mark.
2. **Look at `see just this spot:` first** (a close-up of each mark). The whole screens only if that isn't enough.
3. **Colors are sentences:** blue = this, red = wrong / cut it, green = good / keep it, yellow = look here. An arrow means this goes there. Numbered steps mean in this order. A colored mark with no words still says something.
4. **To change something, put your version beside it:** `node "{{GLASS}}" propose <#> "new text" --file <path> --old "<exact text in the file>"`. They tap Keep (it writes the file), Steer, or Drop. Not a file? Leave out `--file`/`--old` and make the change yourself on Keep.
5. **Close each mark:** `node "{{GLASS}}" status <#> done` (it folds to a small tag after 20 s), or `status <#> you` when it's their move.
6. **Chat gets one line,** as a receipt. The answer lives on the glass.

- Their cards are blue glass and yours amber glass. In chat, name a thread by what it's about ("your note on the heading"), and they'll find it.
- ➤ with nothing marked means "look at what I'm looking at": you get the window in front of them. Answer about that.
- `REPLY on the thread at #N`: they answered one of your cards. `answer N` again.
- Several marks in one send: one answer beside each.

## Going first
Don't wait to be marked at. When you have something to show, put it on their screen, already pointed at.

- **See what they see:** `node "{{GLASS}}" look` (the window in front of them, with its words; a soft frame tells them you looked), `read main` (the screen as text with positions), `find "phrase"`.
- **Mark by words, not pixels:** `node "{{GLASS}}" mark "exact words on their screen" "your note"`. Take the words from `read`, not from memory. Marks follow their window when it moves or scrolls, and hide when it's covered.
- **Showing something new: a numbered show.** One card per piece ("1 · …", "2 · …"), each on the real thing, then a last card that hands them the next move ("3 · press Alt+Q to send").
- **A real button:** `point-at "Button name" "why"` rings it. A few clicks in a row: `steps "Name|note" "Name|note"` waits for each click.
- **No words to aim at:** `box x1 y1 x2 y2 "note"`, `circle x y "note"`, `arrow x1 y1 x2 y2 "note"`, `note x y "text"`.
- **A web page:** put it up full screen yourself and mark it: `powershell -NoProfile -ExecutionPolicy Bypass -File "{{TOOLS}}/show.ps1" -Url https://... -Screen main` (or `second`). Don't paste a link and describe where to look.
- **After you draw, look once:** wait 3 seconds, then `node "{{GLASS}}" shot main` and read the picture. A command that worked can still land in the wrong place.
- **When they're stuck or just clicked the wrong thing,** point at the right thing first, and explain after. That's the moment it matters most.
- `clear` takes your marks off; `clear <#>` one; `clear all` everything.

## Keeping their screen theirs
- Never move, scroll, click or type in what they're looking at while you work. You draw beside it.
- When they're away, your unasked drawing holds back by itself. Answers to their marks always go through.
- Anything they painted over with ▦ (hide) is off limits in every tool you have, not just the glass. If you need what's under it, ask.
- To restart the glass: `node "{{GLASS}}" restart` (it saves everything on it and puts it back). Never stop-then-start while their marks are up.
- Nothing reaches you until they press ➤. Don't build anything that changes that.

## Making it better
After a real session, ask yourself one thing: what slowed them down, or you? Change how you do it next time, here in this skill.
