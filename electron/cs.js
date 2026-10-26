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
// Fora do Windows cada comando roda no próprio grupo de processos: no estouro do prazo (ou se o cshub sair)
// o grupo inteiro morre. Antes só o "sh" intermediário morria e o gcloud (python) seguia órfão, gastando CPU.
const POSIX = process.platform !== 'win32';
const liveGroups = new Set();
const killTree = (child) => {
  try { if (POSIX && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill(); } catch { try { child.kill(); } catch {} }
};
process.on('exit', () => { for (const pid of liveGroups) { try { process.kill(-pid, 'SIGKILL'); } catch {} } });
function run(cmd, args, { timeout = 60000, shell = false, input, onChild, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    try {
      if (shell) {
        // Node 24 desaconselha args + shell: monta a linha de comando ja com aspas
        const q = (a) => (/[\s"()&|<>^%!]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : a);
        child = spawn([cmd, ...args.map(q)].join(' '), { shell: true, windowsHide: true, detached: POSIX, ...(env ? { env } : {}) });
      } else {
        child = spawn(cmd, args, { windowsHide: true, detached: POSIX });
      }
    } catch (e) {
      return resolve({ code: -1, out: String(e) });
    }
    if (onChild) onChild(child);
    if (POSIX && child.pid) liveGroups.add(child.pid);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      liveGroups.delete(child.pid);
      resolve({ code, out });
    };
    const timer = setTimeout(() => {
      killTree(child);
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
// Cada conta tem a própria config do gcloud (CLOUDSDK_CONFIG), para os logins não se misturarem.
// Conta sem pasta própria (cadastrada antes disso) continua usando o gcloud global.
const GCLOUD_DIR = path.join(os.homedir(), '.cshub', 'gcloud');
const configDir = (email) => path.join(GCLOUD_DIR, String(email).toLowerCase().replace(/[^a-z0-9._@-]/g, '_'));
function gcloudEnv(email) {
  const d = configDir(email);
  return fs.existsSync(d) ? { ...process.env, CLOUDSDK_CONFIG: d } : undefined;
}
const gcloudFor = (email, args, opts = {}) => gcloud(args, { ...opts, env: opts.env || gcloudEnv(email) });

async function loggedAccounts(email) {
  const r = await gcloudFor(email, ['auth', 'list', '--format=value(account)'], { timeout: 20000 });
  if (r.code !== 0) return [];
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// Projeto do GCP da conta: um só, "cshub-<conta de e-mail>", marcado com o rótulo cshub=1 para ser reencontrado.
const PROJECT_FILTER = 'labels.cshub=1';
function projectBase(email) {
  const s = String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ('cshub-' + s).slice(0, 30).replace(/-+$/, '');
}
const PROJECT_PREFIX = 'cshub-';
// Projetos da conta com o rótulo cshub=1. "validos" também têm o ID começando com cshub-; os demais ficam em "ignorados" (nunca são apagados).
async function listCshubProjects(email) {
  const r = await gcloudFor(email, ['projects', 'list', `--filter=${PROJECT_FILTER}`, '--format=csv[no-heading](projectId,name,createTime)'], { timeout: 120000 });
  if (r.code !== 0) return { ok: false, error: r.out.trim().slice(-160) };
  return { ok: true, ...parseProjectsCsv(r.out) };
}
// csv sem cabeçalho (projectId,name,createTime) → válidos (prefixo cshub-) e ignorados
function parseProjectsCsv(out) {
  const todos = String(out).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((l) => { const [id, name, t] = l.split(','); return { id, name: name || '', criado: (t || '').slice(0, 10) }; });
  return { validos: todos.filter((x) => x.id.startsWith(PROJECT_PREFIX)), ignorados: todos.filter((x) => !x.id.startsWith(PROJECT_PREFIX)) };
}
async function ensureProject(email) {
  const g = (args) => gcloudFor(email, args, { timeout: 120000 });
  const setDefault = (id) => g(['config', 'set', 'project', id]);
  const ex = await listCshubProjects(email);
  const found = ex.ok && ex.validos[0] ? ex.validos[0].id : null;
  if (found) { await setDefault(found); return { ok: true, project: found, created: false }; }
  const base = projectBase(email);
  let last = '';
  for (let i = 0; i < 4; i++) {
    const id = i === 0 ? base : base.slice(0, 25).replace(/-+$/, '') + '-' + Math.random().toString(36).slice(2, 6);
    const r = await g(['projects', 'create', id, `--name=${base}`, '--labels=cshub=1']);
    if (r.code === 0) { await setDefault(id); return { ok: true, project: id, created: true }; }
    last = r.out.trim().slice(-300);
    if (/Terms of Service/i.test(last)) return { ok: false, error: `${email} ainda não aceitou os Termos de Serviço do Google Cloud. Abra https://console.cloud.google.com com essa conta, aceite os termos e rode: cshub login --importar ${email}` };
    if (!/already exists|ALREADY_EXISTS|not available|in use/i.test(last)) break;   // id ocupado: tenta de novo com sufixo
  }
  return { ok: false, error: 'Não consegui criar o projeto do GCP: ' + last };
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
  if ((await loggedAccounts(email)).includes(email)) return true;
  // abre o login do Google no Chrome desta conta (gcloud respeita a variável BROWSER); espera o usuario concluir
  const exe = chromeExe();
  fs.mkdirSync(configDir(email), { recursive: true, mode: 0o700 });
  const env = { ...process.env, CLOUDSDK_CONFIG: configDir(email) };
  if (exe) env.BROWSER = `"${fwd(exe)}" --user-data-dir="${fwd(profileDir(email))}" --no-first-run --no-default-browser-check %s`;
  await gcloud(['auth', 'login', email], { env, timeout: 5 * 60000, onChild: (ch) => { loginChild = ch; } });
  loginChild = null;
  return (await loggedAccounts(email)).includes(email);
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
  const r = await gcloudFor(email, ['auth', 'print-access-token', `--account=${email}`], { timeout: 30000 });
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

async function resolveEndpoint(acc, log = () => {}) {
  try {
    await ensureKeyFiles();
    const pub = fs.readFileSync(KEY + '.pub', 'utf8').trim();
    const parts = pub.split(/\s+/);
    const keyBody = parts[1] || pub;
    const pubClean = parts.slice(0, 2).join(' ');   // tipo + conteudo, sem comentario
    log('pedindo o token do gcloud (no celular pode levar ~1 min)…');
    const token = await accessToken(acc.Email);

    // 1) estado do ambiente; inicia se estiver suspenso
    let env = await api(token, 'GET', '');
    if (env.status >= 400) return { ok: false, error: 'API do Cloud Shell (' + env.status + '): ' + env.text.slice(0, 400) };

    if (env.json.state !== 'RUNNING') {
      log('VM suspensa: ligando (até ~90 s)…');
      const st = await api(token, 'POST', ':start', {});
      if (st.status >= 400) return { ok: false, error: 'Não consegui iniciar o Cloud Shell (' + st.status + '): ' + st.text.slice(0, 400) };
      for (let i = 0; i < 45; i++) {          // ate ~90 s
        await sleep(2000);
        if (i && i % 10 === 0) log(`  ainda ligando… ${i * 2} s`);
        env = await api(token, 'GET', '');
        if (env.json.state === 'RUNNING') break;
      }
    }
    if (env.json.state !== 'RUNNING' || !env.json.sshHost) {
      return { ok: false, error: 'Cloud Shell não ficou ativo (estado: ' + (env.json.state || '?') + '). Se esta conta nunca abriu o Cloud Shell ou não aceitou os termos, abra https://shell.cloud.google.com com ela, espere o terminal carregar e tente de novo.' };
    }

    // 2) registra a chave publica so se ainda nao estiver la (com novas tentativas)
    const keys = Array.isArray(env.json.publicKeys) ? env.json.publicKeys : [];
    const has = keys.some((k) => String(k).includes(keyBody));
    let warn = '';
    if (!has) {
      let last = null;
      for (let i = 0; i < 3; i++) {
        if (i === 0) log('registrando a chave SSH deste aparelho na VM…');
        last = await api(token, 'POST', ':addPublicKey', { key: pubClean });
        if (last.status < 400 || last.status === 409 || /ALREADY_EXISTS/i.test(last.text)) { last = null; break; }
        await sleep(3000);
      }
      if (last) {
        warn = 'addPublicKey (' + last.status + '): ' + last.text.replace(/\s+/g, ' ').slice(0, 200);
        // fallback: o gcloud registra a chave ao preparar a conexao (--dry-run nao conecta)
        log('o registro direto falhou; tentando pelo gcloud (até ~90 s)…');
        const g = await gcloudFor(acc.Email, ['cloud-shell', 'ssh', '--dry-run', '--authorize-session', `--account=${acc.Email}`], { timeout: 90000 });
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
  const logged = (await loggedCached(acc.Email)).includes(acc.Email);
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
  const proj = await ensureProject(email);   // preparação: cada conta ganha o próprio projeto cshub-<conta>; falha não impede o cadastro
  l.push({ Name: name, Email: email, Mode: ['agy', 'agydirect', 'shell', 'custom'].includes(mode) ? mode : 'agydirect', Session: session, Command: command || '', ...(authUser ? { AuthUser: authUser } : {}), ...(proj.ok ? { Project: proj.project } : {}), User: '', Host: '', Port: 0 });
  save(l);
  loggedCache.delete(email);
  return { ok: true, ...(proj.ok ? { project: proj.project } : { aviso: proj.error }) };
}

// ---------- login pelo terminal (cshub login) ----------
// gcloud auth login --no-launch-browser roda numa pasta temporária; quando termina, a pasta vira ~/.cshub/gcloud/<e-mail>,
// o projeto cshub-<conta> é garantido e a conta é cadastrada.
//   cshub login [apelido]              interativo: mostra o link e espera o código no próprio terminal
//   cshub login --link                 para quem não tem terminal interativo (agentes): mostra o link e deixa um ajudante esperando o código
//   cshub login --codigo <código> [apelido]   entrega o código ao ajudante e termina o cadastro
//   cshub login --importar <e-mail>    só cadastra um login que já está guardado
const PENDING = path.join(os.homedir(), '.cshub', 'login-pendente');
const CODE_RE = /^[\w\-./~]{10,300}$/;
const LINK_RE = /https:\/\/accounts\.google\.com\/\S+/;
const gcloudAuthEnv = (dir) => ({ ...process.env, CLOUDSDK_CONFIG: dir });
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const LOGIN_ANTES = 'Uma vez por conta Google, antes de usar: aceite os Termos de Serviço em https://console.cloud.google.com e abra https://shell.cloud.google.com até o terminal carregar (ativa o Cloud Shell). Sem isso o projeto não é criado e a VM não liga.';

// confere o login feito na pasta temporária e a move para a pasta da conta (se a conta já existia, troca só as credenciais)
async function adoptLogin(tmp) {
  const r = await gcloud(['auth', 'list', '--format=value(account)'], { env: gcloudAuthEnv(tmp), timeout: 20000 });
  const who = r.code === 0 ? r.out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) : null;
  if (!who || !EMAIL_RE.test(who)) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, error: 'Login no gcloud não concluído' }; }
  const dest = configDir(who);
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  fs.cpSync(tmp, dest, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  try { fs.chmodSync(dest, 0o700); } catch {}
  return { ok: true, email: who };
}

// garante o projeto da conta e cadastra (ou atualiza) a conta
async function registerAccount(email, name) {
  name = (name || '').trim() || email.split('@')[0];
  if (!NAME_RE.test(name)) return { ok: false, error: 'Apelido: use letras, números, ponto, hífen ou sublinhado' };
  const proj = await ensureProject(email);
  const l = load();
  let acc = l.find((a) => (a.Email || '').toLowerCase() === email.toLowerCase());
  if (!acc && l.some((a) => a.Name === name)) return { ok: false, error: 'Já existe uma conta com o apelido ' + name };
  if (!acc) {
    acc = { Name: name, Email: email, Mode: 'agydirect', Session: 'agy', Command: '', User: '', Host: '', Port: 0 };
    l.push(acc);
  }
  if (proj.ok) acc.Project = proj.project;
  save(l);
  loggedCache.delete(email);
  return { ok: true, conta: acc.Name, email, config: configDir(email), project: proj.ok ? proj.project : null, projetoCriado: !!proj.created, ...(proj.ok ? {} : { aviso: proj.error }) };
}

async function loginCli({ name, importar } = {}) {
  const nome = (name || '').trim();
  if (nome && !NAME_RE.test(nome)) return { ok: false, error: 'Apelido: use letras, números, ponto, hífen ou sublinhado' };
  if (importar) {
    const email = String(importar).trim();
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'E-mail inválido' };
    if (!fs.existsSync(configDir(email)) || !(await loggedAccounts(email)).includes(email)) return { ok: false, error: 'Não há login guardado para ' + email + ' em ' + configDir(email) + '. Rode cshub login sem --importar.' };
    return registerAccount(email, nome);
  }
  process.stdout.write('Lembrete: ' + LOGIN_ANTES + '\n\n');
  fs.mkdirSync(GCLOUD_DIR, { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(path.join(GCLOUD_DIR, '.login-'));
  const code = await new Promise((resolve) => {
    const ch = spawn('gcloud', ['auth', 'login', '--no-launch-browser'], { stdio: 'inherit', shell: process.platform === 'win32', env: gcloudAuthEnv(tmp) });
    ch.on('error', () => resolve(-1));
    ch.on('close', resolve);
  });
  if (code !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, error: 'Login no gcloud não concluído' }; }
  const a = await adoptLogin(tmp);
  return a.ok ? registerAccount(a.email, nome) : a;
}

// Ajudante (processo separado, iniciado por loginLink): segura o gcloud esperando o código, que chega por arquivo.
async function loginHelper() {
  fs.mkdirSync(GCLOUD_DIR, { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(path.join(GCLOUD_DIR, '.login-'));
  const f = (n) => path.join(PENDING, n);
  fs.writeFileSync(f('estado.json'), JSON.stringify({ pid: process.pid, tmp, desde: Date.now() }));
  const ch = spawn('gcloud', ['auth', 'login', '--no-launch-browser'], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: gcloudAuthEnv(tmp) });
  let saida = '';
  let linkOk = false;
  const onData = (d) => {
    saida += d;
    const m = !linkOk && saida.match(LINK_RE);
    if (m) { linkOk = true; fs.writeFileSync(f('link.txt'), m[0]); }
  };
  ch.stdout.on('data', onData);
  ch.stderr.on('data', onData);
  const fim = (code, erro) => {
    try { fs.writeFileSync(f('fim.json'), JSON.stringify({ code, ...(erro ? { erro } : {}) })); } catch {}
    process.exit(0);
  };
  ch.on('error', (e) => fim(-1, String(e)));
  ch.on('close', (code) => fim(code, code === 0 ? '' : saida.trim().slice(-300)));
  const stop = () => { try { ch.kill(); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); };
  process.on('SIGTERM', stop);
  const deadline = Date.now() + 10 * 60000;
  const timer = setInterval(() => {
    if (fs.existsSync(f('codigo.txt'))) {
      clearInterval(timer);
      const c = fs.readFileSync(f('codigo.txt'), 'utf8').trim();
      try { fs.rmSync(f('codigo.txt'), { force: true }); } catch {}
      ch.stdin.end(c + '\n');
    } else if (Date.now() > deadline) { clearInterval(timer); stop(); }
  }, 500);
}

// passo 1: inicia o ajudante e devolve o link de login
async function loginLink() {
  fs.mkdirSync(path.dirname(PENDING), { recursive: true, mode: 0o700 });
  const old = readJson(path.join(PENDING, 'estado.json'));
  if (old && old.pid) { try { process.kill(old.pid); } catch {} }   // login pendente anterior: descarta (só pelo PID dele)
  if (old && old.tmp && path.dirname(old.tmp) === GCLOUD_DIR) fs.rmSync(old.tmp, { recursive: true, force: true });
  fs.rmSync(PENDING, { recursive: true, force: true });
  fs.mkdirSync(PENDING, { recursive: true, mode: 0o700 });
  spawn(process.execPath, [path.join(__dirname, '..', 'cli', 'cshub.js'), '_login-ajudante'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 80; i++) {          // até ~40 s
    await sleep(500);
    const link = fs.existsSync(path.join(PENDING, 'link.txt')) && fs.readFileSync(path.join(PENDING, 'link.txt'), 'utf8').trim();
    if (link) return { ok: true, link, antes: LOGIN_ANTES, proximo: 'Abra o link, entre com a conta e rode: cshub login --codigo "<código>" [apelido] --json (o e-mail e o apelido da conta só aparecem depois do código)' };
    if (fs.existsSync(path.join(PENDING, 'fim.json'))) break;
  }
  const fim = readJson(path.join(PENDING, 'fim.json'));
  return { ok: false, error: 'Não consegui obter o link de login do gcloud' + (fim && fim.erro ? ': ' + fim.erro : '') };
}

// passo 2: entrega o código ao ajudante, espera o gcloud terminar e cadastra a conta
async function loginCode({ code, name } = {}) {
  code = String(code || '').trim();
  if (!CODE_RE.test(code)) return { ok: false, error: 'Código de verificação inválido' };
  const nome = (name || '').trim();
  if (nome && !NAME_RE.test(nome)) return { ok: false, error: 'Apelido: use letras, números, ponto, hífen ou sublinhado' };
  const st = readJson(path.join(PENDING, 'estado.json'));
  if (!st || !fs.existsSync(path.join(PENDING, 'link.txt'))) return { ok: false, error: 'Não há login pendente. Rode cshub login --link primeiro.' };
  fs.writeFileSync(path.join(PENDING, 'codigo.txt'), code, { mode: 0o600 });
  let fim = null;
  for (let i = 0; i < 120 && !fim; i++) {   // até ~60 s
    await sleep(500);
    fim = readJson(path.join(PENDING, 'fim.json'));
  }
  if (!fim) return { ok: false, error: 'O gcloud não respondeu ao código a tempo. Rode cshub login --link de novo.' };
  fs.rmSync(PENDING, { recursive: true, force: true });
  if (fim.code !== 0) { fs.rmSync(st.tmp, { recursive: true, force: true }); return { ok: false, error: 'Login no gcloud não concluído' + (fim.erro ? ': ' + fim.erro : '') + '. O código vale uma vez só: rode cshub login --link de novo.' }; }
  const a = await adoptLogin(st.tmp);
  return a.ok ? registerAccount(a.email, nome) : a;
}

// ---------- preparação do agy na VM ----------
// Preferências do cshub para contas novas (~/.cshub/preferencias.json). toolPermission: valor gravado no settings.json do agy
// ("always-proceed" = o agy não pede aprovação a cada ferramenta); null = o cshub não mexe.
const PREFS = path.join(os.homedir(), '.cshub', 'preferencias.json');
const PERM_RE = /^[\w-]{1,40}$/;
const DEFAULT_PREFS = { toolPermission: 'always-proceed', trustedFolders: ['~/espelho'] };   // trustedFolders: além da pasta pessoal, o que o cshub marca como confiável
function getPrefs() { return { ...DEFAULT_PREFS, ...(readJson(PREFS) || {}) }; }
function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  fs.mkdirSync(path.dirname(PREFS), { recursive: true });
  fs.writeFileSync(PREFS, JSON.stringify(next, null, 2));
  return next;
}
// Mescla no ~/.gemini/antigravity-cli/settings.json da VM, sem tocar nas credenciais nem em outras chaves.
// Sem forcar, nao sobrescreve um toolPermission que a pessoa ja escolheu; trustedWorkspaces so ganha pastas.
const AGY_MERGE_PY = `import json,os,sys
mode,force=sys.argv[1],sys.argv[2]=='1'
d=os.path.expanduser('~/.gemini/antigravity-cli'); os.makedirs(d,exist_ok=True); f=os.path.join(d,'settings.json')
s={}
if os.path.exists(f):
    try: s=json.load(open(f))
    except Exception as e: print(json.dumps({'erro':'settings.json do agy ilegivel: '+str(e)})); sys.exit(0)
ch=[]
if mode!='-' and s.get('toolPermission')!=mode and (force or 'toolPermission' not in s): s['toolPermission']=mode; ch.append('toolPermission='+mode)
tw=s.setdefault('trustedWorkspaces',[])
for p in sys.argv[3:]:
    p=os.path.expanduser(p)
    if p not in tw: tw.append(p); ch.append('confiar '+p)
if ch:
    open(f+'.tmp','w').write(json.dumps(s,indent=2)); os.replace(f+'.tmp',f)
print(json.dumps({'mudou':ch,'toolPermission':s.get('toolPermission')}))
`;
async function prepareAgy(acc, { permissao, confiar = [] } = {}) {
  const force = permissao !== undefined && permissao !== null;
  const mode = force ? permissao : getPrefs().toolPermission;
  if (mode && !PERM_RE.test(mode)) return { ok: false, error: 'Valor de permissão inválido: use letras, números e hífen (ex.: always-proceed)' };
  const dirs = [...new Set(['~', ...(getPrefs().trustedFolders || []), ...confiar])];
  if (dirs.some((d) => /[\s"'`$&|;<>()\\]/.test(d))) return { ok: false, error: 'Pasta inválida para confiar' };
  const r = await run('ssh', sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']).concat([`python3 - ${mode || '-'} ${force ? 1 : 0} ${dirs.join(' ')}`]), { timeout: 60000, input: AGY_MERGE_PY });
  const j = (r.out.trim().split(/\r?\n/).filter(Boolean).pop() || '');
  let out;
  try { out = JSON.parse(j); } catch { return { ok: false, error: 'Não consegui preparar o agy na VM: ' + r.out.trim().slice(-200) }; }
  if (out.erro) return { ok: false, error: out.erro };
  return { ok: true, mudou: out.mudou, toolPermission: out.toolPermission };
}
// cshub preparar <conta>: acorda a VM e aplica as preferências (ou o que foi pedido) no agy dela
async function preparar(id, opts = {}) {
  const p = await prepare(id);
  if (!p.ok) return p;
  const a = await prepareAgy(p.acc, opts);
  if (!a.ok) return a;
  const l = load();
  const acc = find(l, id);
  if (acc) { acc.Agy = { toolPermission: a.toolPermission || null, em: new Date().toISOString() }; save(l); }
  return { ok: true, conta: p.acc.Name, ...a };
}

async function remove(id, logout) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  save(l.filter((a) => a !== acc));
  try { fs.unlinkSync(knownHosts(acc)); } catch {}
  if (logout) {
    await gcloudFor(acc.Email, ['auth', 'revoke', acc.Email], { timeout: 20000 });
    try { fs.rmSync(configDir(acc.Email), { recursive: true, force: true }); } catch {}
  }
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
async function prepare(id, { refresh = false, log = () => {} } = {}) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  if (!(await ensureLogin(acc.Email))) return { ok: false, error: 'Login no gcloud não concluído' };
  let alive = false;
  if (!refresh && acc.Host) { log('testando a conexão com a VM…'); alive = await sshAlive(acc); }
  if (!alive) {
    try { fs.unlinkSync(knownHosts(acc)); } catch {}
    const ep = await resolveEndpoint(acc, log);
    if (!ep.ok) return { ok: false, error: ep.error };
    acc.User = ep.User; acc.Host = ep.Host; acc.Port = ep.Port;
    save(l);
    // confirma que o SSH aceita a chave (ela pode demorar a propagar)
    let accepted = false;
    for (let i = 0; i < 6 && !accepted; i++) {
      log(`esperando a VM aceitar a chave SSH (tentativa ${i + 1}/6)…`);
      accepted = await sshAlive(acc);
      if (!accepted) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!accepted) {
      return { ok: false, error: 'O Cloud Shell de ' + acc.Email + ' (' + acc.Host + ') recusou a chave SSH.' + (ep.warn ? '\nRegistro da chave: ' + ep.warn : '') + '\nSe esta conta nunca abriu o Cloud Shell, abra shell.cloud.google.com com ela uma vez e tente de novo.' };
    }
  }
  let agy = null;
  if (!acc.Agy) {   // primeira vez que a VM é usada: aplica as preferências do cshub no agy (sem sobrescrever o que a pessoa já escolheu)
    const a = await prepareAgy(acc);
    if (a.ok) { acc.Agy = { toolPermission: a.toolPermission || null, em: new Date().toISOString() }; save(l); agy = a; }
  }
  return { ok: true, acc, agy };
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
const loggedCache = new Map();

async function loggedCached(email) {
  const c = loggedCache.get(email);
  if (c && Date.now() - c.at < 60000) return c.list;
  const list = await loggedAccounts(email);
  loggedCache.set(email, { at: Date.now(), list });
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

// ---------- excluir conta (cshub remover) ----------
// Tira a conta do cadastro e apaga o login local dela (~/.cshub/gcloud/<e-mail>). O projeto GCP só é apagado com apagarProjeto
// (e só se tiver o rótulo cshub=1); a VM do Cloud Shell, o login do agy nela e os resultados em ~/Documents/<projeto>-nuvem ficam.
async function removeAccount(id, { apagarProjeto = false, simular = false } = {}) {
  const l = load();
  const acc = find(l, id);
  if (!acc) return { ok: false, error: 'Conta não encontrada' };
  const dir = configDir(acc.Email);
  const temLogin = fs.existsSync(dir);
  const passos = [`tirar ${acc.Name} <${acc.Email}> do cadastro`];
  if (temLogin) passos.push(`revogar e apagar o login local (${dir})`);
  if (apagarProjeto) passos.push(acc.Project ? `apagar o projeto GCP ${acc.Project} (o Google guarda 30 dias; só se tiver o rótulo cshub=1)` : 'apagar o projeto GCP (a conta não tem projeto registrado: nada a apagar)');
  const fica = ['a VM do Cloud Shell da conta e o login do agy nela', 'os resultados em ~/Documents/<projeto>-nuvem', ...(apagarProjeto ? [] : [`o projeto GCP ${acc.Project || '(nenhum)'}`])];
  if (simular) return { ok: true, simulado: true, conta: acc.Name, passos, fica };
  let projetoApagado = null;
  if (apagarProjeto && acc.Project) {
    if (!temLogin) return { ok: false, error: 'Sem o login local da conta não dá para apagar o projeto. Nada foi alterado.' };
    if (!acc.Project.startsWith(PROJECT_PREFIX)) return { ok: false, error: `O projeto ${acc.Project} não começa com ${PROJECT_PREFIX}: por segurança não o apago. Nada foi alterado.` };
    const lab = await gcloudFor(acc.Email, ['projects', 'describe', acc.Project, '--format=value(labels.cshub)'], { timeout: 60000 });
    if (lab.code !== 0 || lab.out.trim().split(/\r?\n/).pop() !== '1') return { ok: false, error: `O projeto ${acc.Project} não tem o rótulo cshub=1 (ou não foi possível conferir): por segurança não o apago. Nada foi alterado.` };
    const del = await gcloudFor(acc.Email, ['projects', 'delete', acc.Project, '--quiet'], { timeout: 120000 });
    if (del.code !== 0) return { ok: false, error: 'Não consegui apagar o projeto ' + acc.Project + ': ' + del.out.trim().slice(-200) + ' Nada foi alterado.' };
    projetoApagado = acc.Project;
  }
  save(l.filter((a) => a !== acc));
  try { fs.unlinkSync(knownHosts(acc)); } catch {}
  const loc = getLocal();
  if (loc && (loc.email || '').toLowerCase() === acc.Email.toLowerCase()) { try { fs.unlinkSync(LOCAL_FILE); } catch {} }
  if (temLogin) {
    await gcloudFor(acc.Email, ['auth', 'revoke', acc.Email], { timeout: 20000 });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  loggedCache.delete(acc.Email);
  return { ok: true, conta: acc.Name, email: acc.Email, passos, fica, projetoApagado };
}

// ---------- abrir o link de login no navegador (--abrir) ----------
// No celular evita copiar um link longo do Termux (a quebra de linha na cópia causa "Bad Request 400").
// Ordem: termux-open-url (Termux), o mesmo pelo caminho completo (de dentro do Ubuntu do proot-distro), xdg-open, open, start.
const TERMUX_OPEN = '/data/data/com.termux/files/usr/bin/termux-open-url';
function openerCandidates(platform = process.platform, exists = fs.existsSync) {
  if (platform === 'win32') return [['cmd', ['/c', 'start', '""']]];
  if (platform === 'darwin') return [['open', []]];
  const l = [['termux-open-url', []]];
  if (exists(TERMUX_OPEN)) l.push([TERMUX_OPEN, []]);
  l.push(['xdg-open', []]);
  return l;
}
function openUrl(url) {
  if (!/^https:\/\/accounts\.google\.com\/\S+$/.test(String(url))) return { ok: false, error: 'Só abro links de login do Google (https://accounts.google.com/...)' };
  const { spawnSync } = require('child_process');
  for (const [cmd, pre] of openerCandidates()) {
    const r = spawnSync(cmd, [...pre, url], { stdio: 'ignore', timeout: 15000, windowsHide: true });
    if (!r.error && r.status === 0) return { ok: true, via: path.basename(cmd) };
  }
  return { ok: false, error: 'Não consegui abrir o navegador daqui: copie o link.' };
}

// ---------- login do agy na VM (cshub agy-login) ----------
// O agy da VM tem login próprio (não é o do gcloud). Roda numa sessão tmux da VM: o link sai inteiro (sem quebras) e o código é digitado nela.
const AGY_TMUX = 'cshub-agy-login';
const AGY_NOLOGIN_RE = /authentication required|not signed in|Run 'agy' to log in/i;
const AGY_CODE_RE = /^[\w\-./~]{10,300}$/;
const agyEnv = (env) => { if (env && !/^[\w.=\/-]+$/.test(env)) throw new Error('env inválido'); return env ? `env ${env} ` : ''; };

async function agyCheck(id, { env = '' } = {}) {
  const r = await sshExec(id, `${agyEnv(env)}timeout 60 agy -p "responda apenas: ok" 2>&1 | tail -3`, { timeout: 90000 });
  if (!r.ok) return r;
  const out = r.out.trim();
  return { ok: true, logado: !AGY_NOLOGIN_RE.test(out) && out.length > 0, resposta: out.slice(-200) };
}

async function agyLoginLink(id, { env = '' } = {}) {
  const script = `tmux kill-session -t ${AGY_TMUX} 2>/dev/null; tmux new-session -d -s ${AGY_TMUX} -x 2000 -y 60 '${agyEnv(env)}agy'; sleep 4; tmux send-keys -t ${AGY_TMUX} Enter; sleep 4; tmux capture-pane -J -p -t ${AGY_TMUX} -S -80`;
  const r = await sshExec(id, script, { timeout: 60000 });
  if (!r.ok) return r;
  const lines = r.out.split(/\r?\n/).map((x) => x.trim());
  const i = lines.findIndex((x) => x.startsWith('https://accounts.google.com/'));
  if (i < 0) {
    await sshExec(id, `tmux kill-session -t ${AGY_TMUX} 2>/dev/null`, { timeout: 20000 });
    const jaLogado = !/not signed in|Select login method|authorization code/i.test(r.out);
    return { ok: false, error: jaLogado ? 'O agy desta conta parece já estar logado. Confira com: cshub agy-login <conta> --verificar' : 'Não consegui obter o link de login do agy. Tela: ' + r.out.replace(/\s+/g, ' ').slice(-200) };
  }
  let link = '';
  for (const x of lines.slice(i)) { if (!x || x.startsWith('─') || /\s/.test(x)) break; link += x; }   // junta linhas se o agy tiver quebrado o link
  return { ok: true, link };
}

async function agyLoginCode(id, code, { env = '' } = {}) {
  code = String(code || '').trim();
  if (!AGY_CODE_RE.test(code)) return { ok: false, error: 'Código de verificação inválido' };
  const script = `tmux has-session -t ${AGY_TMUX} 2>/dev/null || { echo @@SEMSESSAO; exit 3; }; tmux send-keys -t ${AGY_TMUX} -l '${code}'; sleep 1; tmux send-keys -t ${AGY_TMUX} Enter; sleep 12; tmux kill-session -t ${AGY_TMUX} 2>/dev/null; echo @@FEITO`;
  const r = await sshExec(id, script, { timeout: 60000 });
  if (!r.ok) return r;
  if (/@@SEMSESSAO/.test(r.out)) return { ok: false, error: 'Não há login do agy em andamento nesta conta. Rode cshub agy-login <conta> --link primeiro.' };
  const c = await agyCheck(id, { env });
  if (!c.ok) return c;
  return c.logado ? { ok: true, logado: true } : { ok: false, error: 'O agy ainda não está logado depois do código. O código vale uma vez só: rode cshub agy-login <conta> --link de novo.' + (c.resposta ? ' Resposta do agy: ' + c.resposta : '') };
}

// ---------- voltar ao zero (cshub zerar) ----------
// Sem confirmar, só SIMULA (e só olha as VMs que já estão ligadas). Escopos: skill, vms (espelhos, ~/.cshub e a sessão tmux do login do agy;
// o login e as configurações do agy ficam), projetosGcp (projetos com o rótulo cshub=1). Contas, logins locais e resultados no PC não são tocados.
const MIRROR_KEY = (acc) => String(acc).replace(/[^\w.-]/g, '_');
const VM_INSPECT_SH = `cd "$HOME"; echo "@@ESPELHO"; for d in espelho/*/; do [ -d "$d" ] && echo "$(du -sk "$d" | cut -f1) $(du -sk "$d.saida" 2>/dev/null | cut -f1) $d"; done; echo "@@RODANDO"; b=$(( $(date +%s) - $(cut -d. -f1 /proc/uptime) )); find .cshub/rodando -type f -newermt "@$b" 2>/dev/null | wc -l; echo "@@TMUX"; tmux ls 2>/dev/null | grep -c '^cshub-agy-login:'; echo "@@CSHUB"; du -sk .cshub 2>/dev/null | cut -f1; echo "@@FIM"`;
const VM_WIPE_SH = `tmux kill-session -t ${AGY_TMUX} 2>/dev/null; rm -rf "$HOME/espelho" "$HOME/.cshub"; echo @@LIMPO`;
const kb = (n) => (Number(n) >= 1024 ? (Number(n) / 1024).toFixed(1).replace('.', ',') + ' MB' : Number(n || 0) + ' KB');

function parseInspect(out) {
  const sec = (n) => { const m = out.match(new RegExp('@@' + n + '\\r?\\n([\\s\\S]*?)(?=@@|$)')); return m ? m[1].trim() : ''; };
  const espelhos = sec('ESPELHO').split(/\r?\n/).filter(Boolean).map((l) => { const m = l.match(/^(\d+)\s+(\d*)\s*(\S+)$/); return m ? { pasta: m[3].replace(/\/$/, ''), kb: Number(m[1]), saidaKb: Number(m[2] || 0) } : null; }).filter(Boolean);
  return { espelhos, rodando: Number(sec('RODANDO')) || 0, tmux: Number(sec('TMUX')) || 0, cshubKb: Number(sec('CSHUB')) || 0 };
}

async function zerar({ skill = false, vms = false, projetosGcp = false, conta = null, confirmar = false, forcar = false } = {}) {
  if (!skill && !vms && !projetosGcp) return { ok: false, error: 'Escolha o que zerar: --skill, --vms, --projetos-gcp ou --tudo' };
  const l = load();
  let alvo = l;
  if (conta) { const a = find(l, conta); if (!a) return { ok: false, error: 'Conta não encontrada: ' + conta }; alvo = [a]; }
  const itens = [];
  let mudouCadastro = false;

  if (vms) {
    for (const acc of alvo) {
      const it = { tipo: 'vm', conta: acc.Name, avisos: [] };
      itens.push(it);
      const st = await status(acc.Name);
      if (st.logged === false) { it.pula = 'sem login no gcloud'; continue; }
      if (st.state !== 'RUNNING' && !confirmar) { it.nota = 'VM ' + (st.state === 'SUSPENDED' ? 'suspensa' : (st.state || 'parada')) + ': não inspecionei (confirmar acorda a VM)'; continue; }
      const r = await sshExec(acc.Name, VM_INSPECT_SH, { timeout: 180000 });
      if (!r.ok) { it.pula = r.error; continue; }
      const info = parseInspect(r.out);
      Object.assign(it, info);
      if (info.rodando && !forcar) { it.bloqueado = `${info.rodando} tarefa(s) rodando (cancele com cshub cancelar ou use --forcar)`; continue; }
      if (info.espelhos.some((e) => e.saidaKb > 0)) it.avisos.push('há resultados (.saida) no espelho: confirme que já voltaram ao PC (rode cshub trazer e confira o RESUMO.md na pasta de resultados); este aviso só olha a VM e continua aparecendo depois do trazer; sem a cópia no PC, se perdem');
      if (confirmar) {
        const w = await sshExec(acc.Name, VM_WIPE_SH, { timeout: 180000 });
        if (!w.ok || !/@@LIMPO/.test(w.out)) { it.pula = 'não consegui limpar a VM: ' + (w.error || w.out.trim().slice(-160)); continue; }
        it.limpa = true;
        const dirM = path.join(os.homedir(), '.cshub', 'manifest');
        try { for (const f of fs.readdirSync(dirM)) if (f.endsWith(`__${MIRROR_KEY(acc.Name)}.json`)) fs.unlinkSync(path.join(dirM, f)); } catch {}
        if (acc.Agy) { delete acc.Agy; mudouCadastro = true; }   // a preparação do agy roda de novo no próximo uso
      }
    }
  }

  if (projetosGcp) {
    for (const acc of alvo) {
      const it = { tipo: 'projetos-gcp', conta: acc.Name, projetos: [], avisos: [] };
      itens.push(it);
      if (!fs.existsSync(configDir(acc.Email))) { it.pula = 'sem login local da conta'; continue; }
      const g = (args) => gcloudFor(acc.Email, args, { timeout: 120000 });
      const ls = await listCshubProjects(acc.Email);
      if (!ls.ok) { it.pula = 'não consegui listar os projetos: ' + ls.error; continue; }
      it.projetos = ls.validos;
      it.ignorados = ls.ignorados;   // têm o rótulo mas o ID não começa com cshub-: nunca apagados
      if (ls.validos.length > 1 && !forcar) { it.bloqueado = `${ls.validos.length} projetos com o rótulo e o prefixo (esperado: 1 por conta). Confira a lista e use --forcar para apagar todos`; continue; }
      if (!confirmar) continue;
      it.apagados = [];
      for (const { id } of it.projetos) {
        const d = await g(['projects', 'delete', id, '--quiet']);
        if (d.code === 0) it.apagados.push(id); else it.avisos.push(`não consegui apagar ${id}: ${d.out.trim().slice(-120)}`);
      }
      if (it.apagados.length) {
        await g(['config', 'unset', 'project']);
        if (acc.Project && it.apagados.includes(acc.Project)) { delete acc.Project; mudouCadastro = true; }
      }
    }
  }
  if (mudouCadastro) save(l);

  if (skill) {
    const sk = require('./skill').remove({ simular: !confirmar });
    itens.push({ tipo: 'skill', ...sk });
  }
  return { ok: true, simulado: !confirmar, itens };
}

module.exports = { openWeb, chromeExe, profileDir, cancelLogin, list, status, add, openUrl, zerar, removeAccount, agyCheck, agyLoginLink, agyLoginCode, preparar, getPrefs, setPrefs, loginCli, loginLink, loginCode, loginHelper, ensureProject, configDir, remove, update, refreshEndpoint, tmuxList, open, copyCommand, prepare, sshBase, remoteFor, metrics, stopVm, parseMetrics, sshExec, reservedReason, setLocal, getLocal, _zerar: { VM_INSPECT_SH, VM_WIPE_SH, parseInspect }, _test: { run, openUrl, openerCandidates, TERMUX_OPEN, projectBase, parseProjectsCsv, configDir, AGY_MERGE_PY, PROJECT_PREFIX } };
