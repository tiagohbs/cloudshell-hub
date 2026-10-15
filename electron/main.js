const { dialog, app, BrowserWindow, ipcMain, clipboard, shell, Menu, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const cs = require('./cs');
const term = require('./term');
const proj = require('./projects');
const mirror = require('./mirror');
const quota = require('./quota');
const skill = require('./skill');
const errors = require('./errors');
const tasks = require('./tasks');
const monitor = require('./monitor');

// Só uma cópia do app por vez. Com a bandeja, uma cópia escondida continua rodando; abrir outra
// brigava pela mesma pasta de cache do Chromium (erros "Unable to move the cache / Acesso negado").
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => showWindow());

let win = null;
// No Windows a barra de tarefas respeita melhor o .ico; nos outros sistemas usa o .png
const APP_ICON = nativeImage.createFromPath(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
let tray = null;
let quitting = false;

// ---------- preferências do app (userData/settings.json) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function getSettings() {
  try { const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); return { closeAction: ['ask', 'tray', 'quit'].includes(s.closeAction) ? s.closeAction : 'ask', notifyTasks: s.notifyTasks !== false, hideWelcome: s.hideWelcome === true }; }
  catch { return { closeAction: 'ask', notifyTasks: true, hideWelcome: false }; }
}
function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch { /* sem permissão: segue com o valor em memória */ }
  buildTrayMenu();
  send('app:settings', s);
  return s;
}

// ---------- bandeja do sistema ----------
function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function quitApp() { quitting = true; app.quit(); }
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Cloud Shell Hub', click: showWindow },
    { type: 'separator' },
    { label: 'Sempre perguntar ao fechar', type: 'checkbox', checked: getSettings().closeAction === 'ask', click: (i) => setSettings({ closeAction: i.checked ? 'ask' : 'tray' }) },
    { type: 'separator' },
    { label: 'Sair', click: quitApp }
  ]));
}
function ensureTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Cloud Shell Hub (terminais continuam abertos)');
  tray.on('click', showWindow);
  buildTrayMenu();
}
function hideToTray() { ensureTray(); if (win) win.hide(); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0e1116',
    title: 'Cloud Shell Hub',
    icon: APP_ICON,
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
  win.on('close', (e) => {
    if (quitting) return;
    const act = getSettings().closeAction;
    if (act === 'quit') return;
    e.preventDefault();
    if (act === 'tray') hideToTray();
    else { showWindow(); send('app:close-ask'); }
  });
  win.on('closed', () => { term.killAll(); win = null; });
  if (!APP_ICON.isEmpty()) win.setIcon(APP_ICON);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

const wrap = (fn) => async (_e, ...a) => {
  try { return errors.tag(await fn(...a)); } catch (e) { return errors.tag({ ok: false, error: String(e && e.message || e) }); }
};

// skill do Claude/Maestri
ipcMain.handle('skill:status', wrap(() => skill.status()));
ipcMain.handle('skill:install', wrap(() => skill.install()));
ipcMain.handle('skill:setDir', wrap((dir) => skill.setBase(dir || null)));
ipcMain.handle('skill:pickDir', wrap(async () => {
  const r = await dialog.showOpenDialog(win || undefined, { title: 'Pasta de skills do seu orquestrador', defaultPath: skill.baseDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelado: true };
  return skill.setBase(r.filePaths[0]);
}));

// contas
ipcMain.handle('cs:overview', wrap(() => tasks.accountsOverview()));
ipcMain.handle('cs:liveTask', wrap((name) => tasks.liveForAccount(name)));
ipcMain.handle('cs:list', wrap(() => cs.list()));
ipcMain.handle('cs:status', wrap((id) => cs.status(id)));
ipcMain.handle('cs:add', wrap((d) => cs.add(d)));
ipcMain.handle('cs:cancelLogin', wrap(() => cs.cancelLogin()));
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
ipcMain.handle('cs:shellweb', wrap(async (email) => {
  const ok = typeof email === 'string' && /^[^@\s"'<>]+@[^@\s"'<>]+\.[^@\s"'<>]+$/.test(email);
  // com e-mail: abre no Chrome só dessa conta (perfil próprio, conta 0). Sem Chrome instalado, cai no navegador padrão.
  if (ok) { const r = cs.openWeb(email, 'https://shell.cloud.google.com/?authuser=0&show=terminal'); if (r.ok) return r; }
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

// preferências e fechamento
ipcMain.handle('app:getSettings', () => getSettings());
ipcMain.handle('app:setSettings', (_e, patch) => {
  const p = {};
  if (patch && ['ask', 'tray', 'quit'].includes(patch.closeAction)) p.closeAction = patch.closeAction;
  if (patch && typeof patch.notifyTasks === 'boolean') p.notifyTasks = patch.notifyTasks;
  if (patch && typeof patch.hideWelcome === 'boolean') p.hideWelcome = patch.hideWelcome;
  return setSettings(p);
});
ipcMain.handle('app:testNotify', () => { notifyWin('Cloud Shell Hub', 'Os avisos do Windows estão funcionando.', true); return { ok: true }; });
ipcMain.on('app:close-choice', (_e, choice) => { if (choice === 'tray') hideToTray(); else if (choice === 'quit') quitApp(); });

// area de transferencia
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text || '')));

// ---------- monitor de tarefas: avisa no Windows quando termina, falha ou a VM some ----------
function notifyWin(title, body, force = false) {
  try {
    if (!Notification.isSupported()) return;
    if (!force && win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return;   // já está olhando
    const n = new Notification({ title, body, icon: APP_ICON });
    n.on('click', showWindow);
    n.show();
  } catch { /* notificação é opcional */ }
}
const MOTIVO_TXT = {
  cota: 'a cota do Gemini acabou',
  travada: 'o agy travou e foi encerrado',
  'tempo-maximo': 'passou do tempo máximo e foi encerrada',
  servidor: 'falha do servidor do Gemini/Antigravity',
  rede: 'a VM ficou sem rede para o Gemini',
  login: 'a conta perdeu o login',
  'sem-resposta': 'terminou sem resposta',
  'segundo-plano': 'o agy parou esperando tarefas em segundo plano e não entregou o RESUMO.md',
  'sem-resumo': 'terminou sem entregar o RESUMO.md',
  falhou: 'terminou com erro',
  'comando-nao-encontrado': 'um comando do script não existe na VM (node/npx fora do PATH?)',
  reiniciou: 'a VM reiniciou no meio da tarefa',
  morreu: 'o agy parou sem terminar (a VM pode ter reiniciado)'
};
function announce(t, kind, title, body, code) {
  monitor.update(t, { notificado: true });
  if (getSettings().notifyTasks) notifyWin(title, body + (code ? ` (código ${code})` : ''));
  send('app:aviso', { kind, msg: body + (code ? ` (código ${code})` : ''), title });
}
let monBusy = false;
async function checkTasks() {
  if (monBusy) return;
  monBusy = true;
  try {
    const pend = monitor.pending();
    const groups = new Map();
    for (const t of pend) { const k = t.projeto + '\n' + t.conta; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    for (const [k, items] of groups) {
      const [projeto, conta] = k.split('\n');
      const r = await tasks.peek(projeto, conta);
      if (!r.ok) continue;
      if (!r.tasks) {                                   // VM parada, suspensa ou sem resposta
        for (const t of items) {
          const n = (t.falhasVm || 0) + 1;
          monitor.update(t, { falhasVm: n });
          if (n >= 3) announce(t, 'warn', 'VM fora do ar', `A VM de ${conta} não está ativa (${r.vm}). A tarefa ${t.id} pode ter parado: veja "cshub tarefas".`, errors.MOTIVO_CODE.morreu);
        }
        continue;
      }
      for (const t of items) {
        monitor.update(t, { falhasVm: 0 });
        const x = r.tasks.find((y) => y.id === t.id);
        if (!x) { const n = (t.sumiu || 0) + 1; monitor.update(t, { sumiu: n }); if (n >= 5) monitor.update(t, { notificado: true }); continue; }
        if (x.state === 'rodando') continue;
        const ref = `${projeto} · ${conta} (${t.id})`;
        if (x.state === 'concluida') announce(t, 'ok', 'Tarefa concluída', `Tarefa concluída: ${ref}`);
        else if (x.state === 'cancelada') announce(t, 'ok', 'Tarefa cancelada', `Tarefa cancelada: ${ref}`);
        else {
          const mot = x.state === 'reiniciou' ? 'reiniciou' : x.state === 'parou' ? 'morreu' : (x.motivo || (x.state === 'travada' || x.state === 'tempo-maximo' ? x.state : 'falhou'));
          announce(t, 'err', 'Tarefa com falha', `Tarefa com falha em ${ref}: ${MOTIVO_TXT[mot] || MOTIVO_TXT.falhou}.`, errors.MOTIVO_CODE[mot]);
        }
      }
    }
  } catch { /* tenta de novo no próximo ciclo */ } finally { monBusy = false; }
}

app.whenReady().then(() => {
  if (!gotLock) return;
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('io.github.tiagohbs.cloudshellhub');
  createWindow();
  setTimeout(checkTasks, 20000);
  setInterval(checkTasks, 60000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { quitting = true; term.killAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
