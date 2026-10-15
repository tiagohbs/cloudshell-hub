const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const listen = (ch) => (cb) => {
  const h = (_e, ...a) => cb(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('cs', {
  list: call('cs:list'),
  overview: call('cs:overview'),
  liveTask: call('cs:liveTask'),
  status: call('cs:status'),
  add: call('cs:add'),
  cancelLogin: call('cs:cancelLogin'),
  remove: call('cs:remove'),
  update: call('cs:update'),
  refresh: call('cs:refresh'),
  tmux: call('cs:tmux'),
  open: call('cs:open'),
  copy: call('cs:copy'),
  metrics: call('cs:metrics'),
  quota: call('cs:quota'),
  quotaCached: call('cs:quotaCached'),
  stop: call('cs:stop'),
  webShell: call('cs:shellweb')
});

contextBridge.exposeInMainWorld('skill', {
  status: call('skill:status'),
  install: call('skill:install'),
  setDir: call('skill:setDir'),
  pickDir: call('skill:pickDir')
});

contextBridge.exposeInMainWorld('term', {
  open: call('term:open'),
  write: (id, data) => ipcRenderer.send('term:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('term:kill', id),
  onData: listen('term:data'),
  onExit: listen('term:exit')
});

contextBridge.exposeInMainWorld('proj', {
  list: call('proj:list'),
  add: call('proj:add'),
  update: call('proj:update'),
  remove: call('proj:remove'),
  setup: call('proj:setup'),
  status: call('proj:status'),
  sync: call('proj:sync'),
  pane: call('proj:pane'),
  github: call('proj:github'),
  pr: call('proj:pr')
});

contextBridge.exposeInMainWorld('mirror', {
  send: call('mirror:send'),
  last: call('mirror:last'),
  fetch: call('mirror:fetch'),
  translate: call('mirror:translate'),
  pane: call('mirror:pane'),
  openDir: call('mirror:openDir')
});

contextBridge.exposeInMainWorld('clip', {
  read: call('clip:read'),
  write: (t) => ipcRenderer.send('clip:write', t)
});

contextBridge.exposeInMainWorld('appctl', {
  getSettings: call('app:getSettings'),
  setSettings: call('app:setSettings'),
  closeChoice: (c) => ipcRenderer.send('app:close-choice', c),
  onCloseAsk: (cb) => { const h = () => cb(); ipcRenderer.on('app:close-ask', h); return () => ipcRenderer.removeListener('app:close-ask', h); },
  testNotify: call('app:testNotify'),
  onAviso: (cb) => { const h = (_e, a) => cb(a); ipcRenderer.on('app:aviso', h); return () => ipcRenderer.removeListener('app:aviso', h); },
  onSettings: (cb) => { const h = (_e, s) => cb(s); ipcRenderer.on('app:settings', h); return () => ipcRenderer.removeListener('app:settings', h); }
});
