// The talking bubble's only ties to the glass: tell main its size, and start/stop a drag (main follows the real cursor).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('host', {
  size: (w, h) => ipcRenderer.send('mirror-size', w, h),
  drag: (k, x, y) => ipcRenderer.send('mirror-drag', k, x, y),
  rects: r => ipcRenderer.send('mirror-rects', r),
  // His tools live in the card now (the puck folded in, Nov 13).
  mode: m => ipcRenderer.send('mode', m),
  style: s => ipcRenderer.send('style', s),
  send: () => ipcRenderer.send('send'),
  undo: () => ipcRenderer.send('undo'),
  clear: () => ipcRenderer.send('clear'),
  drop: t => ipcRenderer.send('drop', t),
  keys: () => ipcRenderer.send('legend-toggle'),
  lock: on => ipcRenderer.send('mirror-lock', !!on),
  on: (ch, fn) => { if (['tools', 'mode', 'style', 'pending', 'link', 'legend', 'lock'].includes(ch)) ipcRenderer.on(ch, (_e, v) => fn(v)); },
});
