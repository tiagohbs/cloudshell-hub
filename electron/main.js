const { app, BrowserWindow, ipcMain, clipboard, shell, Menu } = require('electron');
const path = require('path');
const cs = require('./cs');
const term = require('./term');
const proj = require('./projects');
const mirror = require('./mirror');
const quota = require('./quota');
const skill = require('./skill');
const errors = require('./errors');
const tasks = require('./tasks');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0e1116',
    title: 'Cloud Shell Hub',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { term.killAll(); win = null; });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

const wrap = (fn) => async (_e, ...a) => {
  try { return errors.tag(await fn(...a)); } catch (e) { return errors.tag({ ok: false, error: String(e && e.message || e) }); }
};

// skill do Claude/Maestri
ipcMain.handle('skill:status', wrap(() => skill.status()));
ipcMain.handle('skill:install', wrap(() => skill.install()));

// contas
ipcMain.handle('cs:overview', wrap(() => tasks.accountsOverview()));
ipcMain.handle('cs:list', wrap(() => cs.list()));
ipcMain.handle('cs:status', wrap((id) => cs.status(id)));
ipcMain.handle('cs:add', wrap((d) => cs.add(d)));
ipcMain.handle('cs:remove', wrap((id, logout) => cs.remove(id, logout)));
ipcMain.handle('cs:update', wrap((id, patch) => cs.update(id, patch)));
ipcMain.handle('cs:refresh', wrap((id) => cs.refreshEndpoint(id)));
ipcMain.handle('cs:tmux', wrap((id) => cs.tmuxList(id)));
ipcMain.handle('cs:open', wrap((id, o) => cs.open(id, o)));
ipcMain.handle('cs:copy', wrap(async (id, o) => {
  const r = await cs.copyCommand(id, o);
  if (r.ok) clipboard.writeText(r.text);
  return r;
}));
ipcMain.handle('cs:quota', wrap((id) => quota.check(id)));
ipcMain.handle('cs:quotaCached', wrap((id) => quota.cached(id)));
ipcMain.handle('cs:metrics', wrap((id) => cs.metrics(id)));
ipcMain.handle('cs:stop', wrap((id) => cs.stopVm(id)));
// abre o Cloud Shell no navegador, ja na conta indicada (authuser)
ipcMain.handle('cs:shellweb', wrap((email) => {
  const ok = typeof email === 'string' && /^[^@\s"'<>]+@[^@\s"'<>]+\.[^@\s"'<>]+$/.test(email);
  return shell.openExternal('https://shell.cloud.google.com/?show=terminal' + (ok ? '&authuser=' + encodeURIComponent(email) : ''));
}));

// projetos (Git por conta)
ipcMain.handle('proj:list', wrap(() => proj.list()));
ipcMain.handle('proj:add', wrap((d) => proj.add(d)));
ipcMain.handle('proj:update', wrap((n, d) => proj.update(n, d)));
ipcMain.handle('proj:remove', wrap((n) => proj.remove(n)));
ipcMain.handle('proj:setup', wrap((n, acc) => proj.setup(n, acc)));
ipcMain.handle('proj:status', wrap((n, acc) => proj.status(n, acc)));
ipcMain.handle('proj:sync', wrap((n, acc) => proj.sync(n, acc)));
ipcMain.handle('proj:pane', wrap((n, acc, kind) => proj.paneCommand(n, acc, kind)));
ipcMain.handle('proj:github', wrap(() => ({ ok: true, command: proj.githubCommand() })));
ipcMain.handle('proj:pr', wrap(async (n, acc) => {
  const r = proj.prUrl(n, acc);
  if (r.ok) await shell.openExternal(r.url);
  return r;
}));

// espelho do PC (copia direta, sem Git)
ipcMain.handle('mirror:send', wrap((n, acc, o) => mirror.send(n, acc, o || {})));
ipcMain.handle('mirror:last', wrap((n, acc) => mirror.lastSend(n, acc)));
ipcMain.handle('mirror:fetch', wrap((n, acc) => mirror.fetchResults(n, acc)));
ipcMain.handle('mirror:translate', wrap((n, p, acc) => mirror.translate(n, p, acc)));
ipcMain.handle('mirror:pane', wrap((n, kind) => mirror.paneCommand(n, kind)));
ipcMain.handle('mirror:openDir', wrap(async (d) => {
  if (typeof d !== 'string' || !require('fs').existsSync(d)) return { ok: false, error: 'Pasta não encontrada' };
  const e = await shell.openPath(d);
  return e ? { ok: false, error: e } : { ok: true };
}));

// terminais embutidos
ipcMain.handle('term:open', wrap(async (name, o = {}) => {
  const p = await cs.prepare(name, { refresh: !!o.refresh });
  if (!p.ok) return p;
  const remote = cs.remoteFor(p.acc, o.mode, o.command);
  const args = ['-t', ...cs.sshBase(p.acc)];
  if (remote) args.push(remote);
  const r = term.spawnSsh(send, args, o.cols, o.rows);
  return r.ok ? { ...r, host: p.acc.Host, port: p.acc.Port } : r;
}));
ipcMain.on('term:write', (_e, id, data) => term.write(id, data));
ipcMain.on('term:resize', (_e, id, cols, rows) => term.resize(id, cols, rows));
ipcMain.on('term:kill', (_e, id) => term.kill(id));

// area de transferencia
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text || '')));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => term.killAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
