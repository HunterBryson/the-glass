#!/usr/bin/env node
// My voice and my arms on the talking bubble (the glass). The hooks already say what my hands are doing and when I'm
// done; this says it like I'd say it to him, which part of the job we're on, and brings the bubble to where he is.
//   node tools/mirror.js plan "Look at how it works|Build it|Try it" ["what I'm doing, in my words"]   (starts at part 1)
//   node tools/mirror.js step 2 ["what I'm doing now"]
//   node tools/mirror.js say "Making the ring breathe while I work"
//   node tools/mirror.js come [front|cursor|x y]   glide onto the window he's using (default), beside his cursor, or a spot
//   node tools/mirror.js show
const BASE = `http://127.0.0.1:${process.env.GLASS_PORT || 7931}/mirror`;
const [cmd, a, b] = process.argv.slice(2);
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const out = r => { const p = r.mirror || {}; console.log(p.plan ? `part ${p.step} of ${p.plan.length}: ${p.plan[(p.step || 1) - 1] || 'all done'}` : 'no plan', '|', p.state, '|', p.say || p.doing); };
(async () => {
  if (cmd === 'plan' && a) out(await post(BASE, { state: 'working', plan: a.split('|'), step: 1, ...(b ? { say: b } : {}) }));
  else if (cmd === 'step' && a) out(await post(BASE, { state: 'working', step: Number(a), ...(b ? { say: b } : {}) }));
  else if (cmd === 'say' && a) out(await post(BASE, { state: 'working', say: a }));
  else if (cmd === 'come') {
    const r = Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? await post(BASE + '/come', { where: 'spot', x: Number(a), y: Number(b) }) : await post(BASE + '/come', { where: a || 'front' });
    console.log(r.at ? `came to ${r.at.x},${r.at.y}` : 'the bubble is not up');
  }
  else if (cmd === 'show') out(await (await fetch(BASE)).json());
  else console.log('mirror.js plan "a|b|c" ["say"] · step N ["say"] · say "text" · come [front|cursor|x y] · show');
})().catch(e => { console.log('The glass is not answering:', e.message); process.exit(0); });
