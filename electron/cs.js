// Backend: contas, gcloud, ssh. As contas ficam em ~/.cloudshell-accounts.json (fora do app e do repositório).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG = path.join(os.homedir(), '.cloudshell-accounts.json');
const KEY = path.join(os.homedir(), '.ssh', 'google_compute_engine');
const EMAIL_RE = /^[^\s@"'`$&|;<>()]+@[^\s@"'`$&|;<>()]+\.[^\s@"'`$&|;<>()]+$/;
const NAME_RE = /^[\w.\-]{1,32}$/;
const SESSION_RE = /^[\w.\-]{1,32}$/;

// ---------- armazenamento ----------
function load() {
  try {
    const raw = fs.readFileSync(CONFIG, 'utf8').replace(/^﻿/, '').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}
function save(list) {
  fs.writeFileSync(CONFIG, JSON.stringify(list, null, 2), 'utf8');
}
function find(list, id) {
  return list.find((a) => a.Name === id || a.Email === id);
}

// ---------- processos ----------
function run(cmd, args, { timeout = 60000, shell = false, input, onChild, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    try {
      if (shell) {
        // Node 24 desaconselha args + shell: monta a linha de comando ja com aspas
        const q = (a) => (/[\s"()&|<>^%!]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : a);
        child = spawn([cmd, ...args.map(q)].join(' '), { shell: true, windowsHide: true, ...(env ? { env } : {}) });
      } else {
        child = spawn(cmd, args, { windowsHide: true });
      }
    } catch (e) {
      return resolve({ code: -1, out: String(e) });
    }
    if (onChild) onChild(child);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(-2);
    }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => { out += String(e); finish(-1); });
    child.on('close', (code) => finish(code));
    if (input) child.stdin.end(input);
  });
}
const gcloud = (args, opts) => run('gcloud', args, { shell: true, ...opts });

// ---------- gcloud ----------
async function loggedAccounts() {
  const r = await gcloud(['auth', 'list', '--format=value(account)'], { timeout: 20000 });
  if (r.code !== 0) return [];
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// ---------- Chrome com perfil próprio por conta ----------
// Cada conta abre num Chrome só dela (pasta de perfil separada, sem usuário do Chrome logado): a conta é sempre a 0 (authuser=0).
function chromeExe() {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const b of pf) { const p = path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'); if (fs.existsSync(p)) return p; }
  return null;
}
function profileDir(email) {
  return path.join(process.env.LOCALAPPDATA || os.homedir(), 'CloudShellHub', 'chrome', String(email).toLowerCase().replace(/[^a-z0-9._-]/g, '_'));
}
const fwd = (p) => p.replace(/\\/g, '/');
const chromeFlags = (email) => ['--user-data-dir=' + profileDir(email), '--no-first-run', '--no-default-browser-check'];
// abre uma página no Chrome desta conta (cria o perfil na primeira vez)
function openWeb(email, url) {
  const exe = chromeExe();
  if (!exe) return { ok: false, noChrome: true };
  try { spawn(exe, [...chromeFlags(email), url], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); return { ok: true, perfil: profileDir(email) }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

async function ensureLogin(email) {
  if ((await loggedAccounts()).includes(email)) return true;
  // abre o login do Google no Chrome desta conta (gcloud respeita a variável BROWSER); espera o usuario concluir
  const exe = chromeExe();
  const env = exe ? { ...process.env, BROWSER: `"${fwd(exe)}" --user-data-dir="${fwd(profileDir(email))}" --no-first-run --no-default-browser-check %s` } : undefined;
  await gcloud(['auth', 'login', email], { env, timeout: 5 * 60000, onChild: (ch) => { loginChild = ch; } });
  loginChild = null;
  return (await loggedAccounts()).includes(email);
}
// interrompe o login que estiver esperando o navegador (botão Parar do cadastro em lote)
let loginChild = null;
function cancelLogin() {
  const ch = loginChild;
  if (!ch) return { ok: true, none: true };
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { windowsHide: true });
    else ch.kill();
  } catch { /* já terminou */ }
  return { ok: true };
}

// get-mount-command nao existe no Windows: usa a API do Cloud Shell (a mesma que o gcloud usa)
const API = 'https://cloudshell.googleapis.com/v1/users/me/environments/default';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken(email) {
  const r = await gcloud(['auth', 'print-access-token', `--account=${email}`], { timeout: 30000 });
  const t = r.out.trim().split(/\r?\n/).pop();
  if (r.code !== 0 || !t || /\s/.test(t)) throw new Error('Não consegui obter o token do gcloud para ' + email + ': ' + r.out.trim().slice(-300));
  return t;
}

async function api(token, method, suffix, body) {
  const res = await fetch(API + suffix, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { status: res.status, json, text };
}

async function ensureKeyFiles() {
  if (fs.existsSync(KEY) && fs.existsSync(KEY + '.pub')) return;
  fs.mkdirSync(path.dirname(KEY), { recursive: true });
  const r = await run('ssh-keygen', ['-t', 'rsa', '-b', '3072', '-N', '', '-f', KEY, '-q'], { timeout: 30000 });
  if (r.code !== 0 || !fs.existsSync(KEY + '.pub')) throw new Error('Não consegui gerar a chave SSH: ' + r.out.trim());
}

async function resolveEndpoint(acc) {
  try {
    await ensureKeyFiles();
    const pub = fs.readFileSync(KEY + '.pub', 'utf8').trim();
    const parts = pub.split(/\s+/);
    const keyBody = parts[1] || pub;
    const pubClean = parts.slice(0, 2).join(' ');   // tipo + conteudo, sem comentario
    const token = await accessToken(acc.Email);

    // 1) estado do ambiente; inicia se estiver suspenso
    let env = await api(token, 'GET', '');
    if (env.status >= 400) return { ok: false, error: 'API do Cloud Shell (' + env.status + '): ' + env.text.slice(0, 400) };

    if (env.json.state !== 'RUNNING') {
      const st = await api(token, 'POST', ':start', {});
      if (st.status >= 400) return { ok: false, error: 'Não consegui iniciar o Cloud Shell (' + st.status + '): ' + st.text.slice(0, 400) };
      for (let i = 0; i < 45; i++) {          // ate ~90 s
        await sleep(2000);
        env = await api(token, 'GET', '');
        if (env.json.state === 'RUNNING') break;
      }
    }
    if (env.json.state !== 'RUNNING' || !env.json.sshHost) {
      return { ok: false, error: 'Cloud Shell não ficou ativo (estado: ' + (env.json.state || '?') + ')' };
    }

    // 2) registra a chave publica so se ainda nao estiver la (com novas tentativas)
    const keys = Array.isArray(env.json.publicKeys) ? env.json.publicKeys : [];
    const has = keys.some((k) => String(k).includes(keyBody));
    let warn = '';
    if (!has) {
      let last = null;
      for (let i = 0; i < 3; i++) {
        last = await api(token, 'POST', ':addPublicKey', { key: pubClean });
        if (last.status < 400 || last.status === 409 || /ALREADY_EXISTS/i.test(last.text)) { last = null; break; }
        await sleep(3000);
      }
      if (last) {
        warn = 'addPublicKey (' + last.status + '): ' + last.text.replace(/\s+/g, ' ').slice(0, 200);
        // fallback: o gcloud registra a chave ao preparar a conexao (--dry-run nao conecta)
        const g = await gcloud(['cloud-shell', 'ssh', '--dry-run', '--authorize-session', `--account=${acc.Email}`], { timeout: 90000 });
        warn += ' | fallback gcloud: ' + (/Pushing your public key[\s\S]*done/i.test(g.out) ? 'chave enviada' : g.out.replace(/\s+/g, ' ').slice(-160));
      }
      await sleep(3000);                        // tempo para a chave propagar
    }

    return { ok: true, User: env.json.sshUsername, Host: env.json.sshHost, Port: env.json.sshPort || 6000, warn };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

// ---------- ssh ----------
function knownHosts(acc) {
  return path.join(os.homedir(), '.ssh', `known_hosts_cs_${acc.Name}`);
}
function sshBase(acc, extra = []) {
  return [
    '-i', KEY,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHosts(acc)}`,
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=4',
    '-o', 'LogLevel=ERROR',
    ...extra,
    '-p', String(acc.Port),
    `${acc.User}@${acc.Host}`
  ];
}
async function sshAlive(acc) {
  if (!acc.Host) return false;
  const r = await run('ssh', sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6']).concat(['exit']), { timeout: 12000 });
  return r.code === 0;
}
function remoteFor(acc, mode, command) {
  const m = mode || acc.Mode || 'agydirect';
  if (command) return command;
  if (m === 'agy') return `(sed -i '/set -g mouse on/d' ~/.tmux.conf 2>/dev/null || true) && (tmux set -g mouse off 2>/dev/null || true) && tmux new -A -s ${acc.Session || 'agy'} agy`;
  if (m === 'agydirect') return 'agy';
  if (m === 'custom') return acc.Command || '';
  return '';
}
function fullCommand(acc, mode, command) {
  const remote = remoteFor(acc, mode, command);
  const a = ['-t', ...sshBase(acc)];
  const q = (s) => (/[\s"]/.test(s) ? `"${s}"` : s);
  return ['ssh', ...a.map(q), ...(remote ? [`"${remote}"`] : [])].join(' ');
}

// ---------- API usada pela interface ----------
async function list() {
  return load().map((a) => ({ ...a }));
}

async function status(id) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { error: 'Conta não encontrada' };
  const logged = (await loggedCached()).includes(acc.Email);
  if (!logged) return { logged: false };
  try {
    const e = await envState(acc);
    if (e.state === 'RUNNING' && e.sshHost && (e.sshHost !== acc.Host || (e.sshPort || 6000) !== acc.Port)) {
      acc.Host = e.sshHost; acc.Port = e.sshPort || 6000; acc.User = e.sshUsername || acc.User;
      save(l);
    }
    return { logged: true, state: e.state || 'UNKNOWN', weekHours: weekUsage(acc.Email) };
  } catch (err) {
    return { logged: true, state: 'ERROR', error: String(err && err.message || err), weekHours: weekUsage(acc.Email) };
  }
}

const AUTH_RE = /^\d{1,2}$/;
async function add({ email, name, mode, session, command, authUser }) {
  email = (email || '').trim();
  name = (name || '').trim() || email.split('@')[0];
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido' };
  if (!NAME_RE.test(name)) return { ok: false, error: 'Apelido: use letras, números, ponto, hífen ou sublinhado' };
  session = (session || 'agy').trim();
  if (!SESSION_RE.test(session)) return { ok: false, error: 'Nome de sessão tmux inválido' };
  authUser = String(authUser == null ? '' : authUser).trim();
  if (authUser && !AUTH_RE.test(authUser)) return { ok: false, error: 'O número da conta no navegador deve ser de 0 a 99' };
  const l = load();
  if (l.some((a) => a.Name === name || a.Email === email)) return { ok: false, error: 'Já existe conta com esse apelido ou e-mail' };
  if (!(await ensureLogin(email))) return { ok: false, error: 'Login no gcloud não concluído' };
  l.push({ Name: name, Email: email, Mode: ['agy', 'agydirect', 'shell', 'custom'].includes(mode) ? mode : 'agydirect', Session: session, Command: command || '', ...(authUser ? { AuthUser: authUser } : {}), User: '', Host: '', Port: 0 });
  save(l);
  loggedCache.at = 0;
  return { ok: true };
}

async function remove(id, logout) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  save(l.filter((a) => a !== acc));
  try { fs.unlinkSync(knownHosts(acc)); } catch {}
  if (logout) await gcloud(['auth', 'revoke', acc.Email], { timeout: 20000 });
  return { ok: true };
}

async function update(id, patch) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  if (typeof patch.Name === 'string' && patch.Name.trim() && patch.Name.trim() !== acc.Name) {
    const nn = patch.Name.trim();
    if (!NAME_RE.test(nn)) return { ok: false, error: 'Apelido: use letras, números, ponto, hífen ou sublinhado (até 32)' };
    if (l.some((a) => a !== acc && a.Name === nn)) return { ok: false, error: 'Já existe uma conta com esse apelido' };
    try { fs.renameSync(knownHosts(acc), path.join(os.homedir(), '.ssh', `known_hosts_cs_${nn}`)); } catch {}
    acc.Name = nn;
  }
  if (patch.Mode && ['agy', 'agydirect', 'shell', 'custom'].includes(patch.Mode)) acc.Mode = patch.Mode;
  if (patch.Session && SESSION_RE.test(patch.Session)) acc.Session = patch.Session;
  if (typeof patch.Command === 'string') acc.Command = patch.Command;
  if (patch.AuthUser !== undefined) {
    const n = String(patch.AuthUser == null ? '' : patch.AuthUser).trim();
    if (n && !AUTH_RE.test(n)) return { ok: false, error: 'O número da conta no navegador deve ser de 0 a 99' };
    if (n) acc.AuthUser = n; else delete acc.AuthUser;
  }
  if (typeof patch.Reserved === 'string') {
    const r = patch.Reserved.replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (r) acc.Reservada = r; else delete acc.Reservada;
  }
  save(l);
  return { ok: true, name: acc.Name };
}

// garante login e endereco valido; devolve a conta pronta
async function prepare(id, { refresh = false } = {}) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  if (!(await ensureLogin(acc.Email))) return { ok: false, error: 'Login no gcloud não concluído' };
  let alive = false;
  if (!refresh && acc.Host) alive = await sshAlive(acc);
  if (!alive) {
    try { fs.unlinkSync(knownHosts(acc)); } catch {}
    const ep = await resolveEndpoint(acc);
    if (!ep.ok) return { ok: false, error: ep.error };
    acc.User = ep.User; acc.Host = ep.Host; acc.Port = ep.Port;
    save(l);
    // confirma que o SSH aceita a chave (ela pode demorar a propagar)
    let accepted = false;
    for (let i = 0; i < 6 && !accepted; i++) {
      accepted = await sshAlive(acc);
      if (!accepted) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!accepted) {
      return { ok: false, error: 'O Cloud Shell de ' + acc.Email + ' (' + acc.Host + ') recusou a chave SSH.' + (ep.warn ? '\nRegistro da chave: ' + ep.warn : '') + '\nSe esta conta nunca abriu o Cloud Shell, abra shell.cloud.google.com com ela uma vez e tente de novo.' };
    }
  }
  return { ok: true, acc };
}

async function refreshEndpoint(id) {
  const p = await prepare(id, { refresh: true });
  return p.ok ? { ok: true, Host: p.acc.Host, Port: p.acc.Port } : p;
}

async function tmuxList(id) {
  const p = await prepare(id);
  if (!p.ok) return p;
  const r = await run('ssh', sshBase(p.acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']).concat(['tmux ls 2>&1 || true']), { timeout: 20000 });
  const sessions = r.out.split(/\r?\n/).filter((s) => /^\S+:\s+\d+ windows?/.test(s)).map((s) => {
    const name = s.split(':')[0];
    return { name, info: s.slice(name.length + 1).trim(), attached: /\(attached\)/.test(s) };
  });
  return { ok: true, sessions };
}

async function open(id, { mode, command, refresh } = {}) {
  const p = await prepare(id, { refresh });
  if (!p.ok) return p;
  const acc = p.acc;
  const remote = remoteFor(acc, mode, command);
  const args = ['-t', ...sshBase(acc)];
  if (remote) args.push(remote);
  const title = `Cloud Shell: ${acc.Name}`;

  // 1) Windows Terminal em nova aba; 2) fallback: janela do PowerShell
  const tryWt = await new Promise((resolve) => {
    const c = spawn('wt.exe', ['-w', '0', 'new-tab', '--title', title, 'ssh.exe', ...args], { detached: true, stdio: 'ignore', windowsHide: false });
    c.on('error', () => resolve(false));
    c.on('spawn', () => { c.unref(); resolve(true); });
  });
  if (tryWt) return { ok: true, via: 'wt' };

  const quoted = ['ssh.exe', ...args].map((s) => `'${String(s).replace(/'/g, "''")}'`);
  const ps = `$Host.UI.RawUI.WindowTitle='${title}'; & ${quoted[0]} ${quoted.slice(1).join(' ')}`;
  spawn('powershell.exe', ['-NoExit', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, via: 'powershell' };
}

async function copyCommand(id, { mode, command } = {}) {
  const p = await prepare(id);
  if (!p.ok) return p;
  return { ok: true, text: fullCommand(p.acc, mode, command) };
}

// ---------- estado, uso e recursos ----------
const USAGE = path.join(os.homedir(), '.cloudshell-usage.json');
const tokenCache = new Map();
let loggedCache = { at: 0, list: [] };

async function loggedCached() {
  if (Date.now() - loggedCache.at < 60000) return loggedCache.list;
  const list = await loggedAccounts();
  loggedCache = { at: Date.now(), list };
  return list;
}
async function cachedToken(email) {
  const c = tokenCache.get(email);
  if (c && c.exp > Date.now()) return c.t;
  const t = await accessToken(email);
  tokenCache.set(email, { t, exp: Date.now() + 40 * 60000 });
  return t;
}
async function envState(acc) {
  let r = await api(await cachedToken(acc.Email), 'GET', '');
  if (r.status === 401) { tokenCache.delete(acc.Email); r = await api(await cachedToken(acc.Email), 'GET', ''); }
  if (r.status >= 400) throw new Error('API do Cloud Shell (' + r.status + ')');
  return r.json;
}

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE, 'utf8')); } catch { return {}; }
}
// cada boot da VM vira um intervalo [boot, ultima vez vista ligada]
function recordUsage(email, boot, now) {
  const u = loadUsage();
  const list = u[email] || [];
  const it = list.find((x) => Math.abs(x.boot - boot) < 120000);
  if (it) it.last = Math.max(it.last, now);
  else list.push({ boot, last: now });
  u[email] = list.filter((x) => x.last > now - 8 * 86400000);
  try { fs.writeFileSync(USAGE, JSON.stringify(u)); } catch {}
}
function weekUsage(email) {
  const now = Date.now();
  const from = now - 7 * 86400000;
  let ms = 0;
  for (const x of loadUsage()[email] || []) {
    const a = Math.max(x.boot, from);
    const b = Math.min(x.last, now);
    if (b > a) ms += b - a;
  }
  return ms / 3600000;
}

const METRICS_SH = "head -1 /proc/stat; sleep 0.5; head -1 /proc/stat; nproc; cat /proc/loadavg; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; df -P -B1 \"$HOME\" | tail -1; cat /proc/uptime";

function parseMetrics(out) {
  const L = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const cpuL = L.filter((x) => /^cpu\s/.test(x));
  let cpu = null;
  if (cpuL.length >= 2) {
    const p = (x) => x.split(/\s+/).slice(1).map(Number);
    const a = p(cpuL[0]); const b = p(cpuL[1]);
    const idle = (x) => x[3] + (x[4] || 0);
    const tot = (x) => x.reduce((s2, v) => s2 + v, 0);
    const dt = tot(b) - tot(a); const di = idle(b) - idle(a);
    cpu = dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt)))) : 0;
  }
  const rest = L.filter((x) => !/^cpu\s/.test(x));
  const ncpu = parseInt(rest[0], 10) || null;
  const load = rest[1] ? parseFloat(rest[1].split(/\s+/)[0]) : null;
  const kb = (k) => { const m = out.match(new RegExp(k + ':\\s+(\\d+)')); return m ? Number(m[1]) * 1024 : null; };
  const memTotal = kb('MemTotal'); const memAvail = kb('MemAvailable');
  const df = rest.find((x) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+%/.test(x));
  let diskTotal = null; let diskUsed = null;
  if (df) { const c = df.split(/\s+/); diskTotal = Number(c[1]); diskUsed = Number(c[2]); }
  const up = rest.find((x) => /^\d+(\.\d+)?\s+\d+(\.\d+)?$/.test(x));
  const uptime = up ? parseFloat(up) : null;
  return { cpu, ncpu, load, memTotal, memUsed: memTotal != null && memAvail != null ? memTotal - memAvail : null, diskTotal, diskUsed, uptime };
}

async function metrics(id) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  if (!acc.Host) return { ok: false, error: 'Endereço da VM ainda não conhecido' };
  const r = await run('ssh', sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']).concat([METRICS_SH]), { timeout: 20000 });
  if (r.code !== 0) return { ok: false, error: 'A VM não respondeu' };
  const m = parseMetrics(r.out);
  if (m.uptime != null) recordUsage(acc.Email, Date.now() - m.uptime * 1000, Date.now());
  return { ok: true, ...m, weekHours: weekUsage(acc.Email), at: Date.now() };
}

// Nao ha "desligar" na API do Cloud Shell: encerramos tudo que roda na VM para ela ficar ociosa e ser suspensa.
const STOP_SH = 'me=$$; tmux kill-server 2>/dev/null; pkill -u "$USER" -x agy 2>/dev/null; for p in $(pgrep -u "$USER" -x bash); do [ "$p" != "$me" ] && [ "$p" != "$PPID" ] && kill -HUP "$p" 2>/dev/null; done; echo encerrado';

async function stopVm(id) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  if (!acc.Host) return { ok: true, note: 'Nada para encerrar' };
  try {
    const e = await envState(acc);
    if (e.state !== 'RUNNING') return { ok: true, note: 'A VM já estava ' + (e.state === 'SUSPENDED' ? 'suspensa' : (e.state || 'parada')) };
  } catch {}
  const m = await metrics(id);   // registra o uso ate agora
  const r = await run('ssh', sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8']).concat([STOP_SH]), { timeout: 20000 });
  if (!/encerrado/.test(r.out)) return { ok: false, error: 'Não consegui encerrar as sessões na VM' + (r.out.trim() ? ': ' + r.out.trim().slice(-200) : ` (o ssh terminou com código ${r.code} e sem resposta)`) };
  return { ok: true, note: 'Sessões encerradas. O Google suspende a VM depois de um período sem uso.', weekHours: m.weekHours };
}

// executa um script na VM da conta (acorda a VM se preciso)
// conta em uso no PC (agentes locais do orquestrador): a reserva acompanha a troca de conta.
// A marca automatica comeca com "[PC]"; reservas manuais nao sao tocadas.
const LOCAL_TAG = '[PC]';
const LOCAL_FILE = path.join(os.homedir(), '.cshub', 'conta-local.json');
function setLocal(idOrEmail, motivo) {
  const l = load();
  const key = String(idOrEmail || '').trim();
  const acc = key ? l.find((a) => a.Name === key || (a.Email || '').toLowerCase() === key.toLowerCase()) : null;
  if (key && !acc && !EMAIL_RE.test(key)) return { ok: false, error: 'Conta não encontrada: ' + key + ' (use o apelido ou o e-mail)' };
  let antes = null;
  for (const a of l) {
    if (!a.Reservada || !a.Reservada.includes(LOCAL_TAG)) continue;
    antes = a.Name;
    const manual = a.Reservada.split(' | ').filter((x) => !x.startsWith(LOCAL_TAG)).join(' | ').trim();
    if (manual) a.Reservada = manual; else delete a.Reservada;
  }
  const texto = `${LOCAL_TAG} em uso no PC: ${motivo || 'agentes locais do orquestrador (cota do Gemini compartilhada)'}`;
  if (acc) {
    if (acc.Reservada && !acc.Reservada.startsWith(LOCAL_TAG)) acc.Reservada = acc.Reservada + ' | ' + texto;
    else acc.Reservada = texto;
  }
  save(l);
  const estado = { email: acc ? acc.Email : (key || null), conta: acc ? acc.Name : null, desde: new Date().toISOString() };
  try { fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true }); fs.writeFileSync(LOCAL_FILE, JSON.stringify(estado, null, 2)); } catch {}
  return { ok: true, antes, agora: estado.conta, email: estado.email, cadastrada: !!acc };
}
function getLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return null; }
}

// motivo da reserva (conta usada por outro agente, cota compartilhada), ou null
function reservedReason(id) {
  const acc = find(load(), id);
  return acc && acc.Reservada ? acc.Reservada : null;
}

async function sshExec(id, script, { timeout = 180000 } = {}) {
  const p = await prepare(id);
  if (!p.ok) return p;
  const r = await run('ssh', sshBase(p.acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']).concat([script]), { timeout });
  return { ok: true, code: r.code, out: r.out };
}

module.exports = { openWeb, chromeExe, profileDir, cancelLogin, list, status, add, remove, update, refreshEndpoint, tmuxList, open, copyCommand, prepare, sshBase, remoteFor, metrics, stopVm, parseMetrics, sshExec, reservedReason, setLocal, getLocal };
