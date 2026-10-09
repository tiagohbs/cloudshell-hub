// Projetos compartilhados via Git: cada conta clona o mesmo repositorio e trabalha no proprio branch.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cs = require('./cs');

const FILE = path.join(os.homedir(), '.cloudshell-projects.json');
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;
const REPO_RE = /^(https:\/\/[\w.-]+(:\d+)?\/[\w.~\-\/]+|git@[\w.-]+:[\w.~\-\/]+)$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,60}$/;
// ~ | ~/x | /abs/x | relativo (a partir de ~); sem espacos, aspas ou ".."
const DIR_RE = /^(~|~\/[A-Za-z0-9._\/-]*|\/[A-Za-z0-9._\/-]+|[A-Za-z0-9._-][A-Za-z0-9._\/-]*)$/;

function cleanDir(d) {
  d = String(d || '').trim().replace(/\/+$/, '');
  if (d === '') return '';
  if (!DIR_RE.test(d) || d.split('/').includes('..')) return null;
  return d;
}
const defaultDir = (name) => `~/projetos/${name}`;
const dirOf = (p) => p.Dir || defaultDir(p.Name);
const insideHome = (d) => d === '~' || d.startsWith('~/') || !d.startsWith('/');

// ---------- espelho do PC (copia direta, sem Git) ----------
const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', 'release', '.git', '.cache', '.vite', '.turbo', '.next', 'coverage', '.DS_Store', 'Thumbs.db'];
const DEFAULT_SECRETS = ['.env', '.env.*', 'tripo-keys.json', '*.pem', 'id_rsa*', 'id_ed25519*'];
const PATTERN_RE = /^[A-Za-z0-9._*?\/-]{1,80}$/;
const WINABS_RE = /^(?:[A-Za-z]:[\\/]|\/)/;

const normWin = (p) => String(p || '').trim().replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '');
const isInside = (child, parent) => {
  const c = normWin(child).replace(/\\/g, '/').toLowerCase();
  const pa = normWin(parent).replace(/\\/g, '/').toLowerCase();
  return !!pa && (c === pa || c.startsWith(pa + '/'));
};
function mirrorCfg(p) {
  return {
    local: p.LocalDir || '',
    mirror: p.MirrorDir || `~/espelho/${p.Name}`,
    results: p.ResultsDir || path.join(os.homedir(), 'Documents', `${p.Name}-nuvem`),
    exclude: Array.isArray(p.Exclude) ? p.Exclude : DEFAULT_EXCLUDE,
    secrets: Array.isArray(p.Secrets) ? p.Secrets : DEFAULT_SECRETS
  };
}
function cleanPatterns(v) {
  const arr = (Array.isArray(v) ? v : String(v || '').split(/[\n,]+/)).map((x) => x.trim()).filter(Boolean);
  if (arr.some((x) => !PATTERN_RE.test(x) || x.split('/').includes('..'))) return null;
  return [...new Set(arr)];
}
function validateMirror(p, m) {
  const out = {};
  if (m.LocalDir !== undefined) {
    const v = normWin(m.LocalDir);
    if (v && !WINABS_RE.test(v)) return { error: 'Pasta no PC: use o caminho completo, ex.: C:\\Users\\DEV\\Documents\\projeto' };
    if (v && !fs.existsSync(v)) return { error: 'A pasta no PC não existe: ' + v };
    out.LocalDir = v;
  }
  if (m.MirrorDir !== undefined) {
    const d = cleanDir(m.MirrorDir);
    if (d === null) return { error: 'Pasta do espelho inválida (sem espaços, acentos ou "..")' };
    out.MirrorDir = d || `~/espelho/${p.Name}`;
  }
  if (m.ResultsDir !== undefined) {
    const v = normWin(m.ResultsDir);
    if (v && !WINABS_RE.test(v)) return { error: 'Pasta de resultados: use o caminho completo' };
    out.ResultsDir = v;
  }
  for (const k of ['Exclude', 'Secrets']) {
    if (m[k] !== undefined) {
      const v = cleanPatterns(m[k]);
      if (v === null) return { error: (k === 'Exclude' ? 'Exclusões' : 'Segredos') + ': use nomes ou padrões simples como node_modules, *.log, .env.*' };
      out[k] = v;
    }
  }
  const merged = { ...p, ...out };
  const c = mirrorCfg(merged);
  if (c.local && isInside(c.results, c.local)) return { error: 'A pasta de resultados não pode ficar dentro da pasta do projeto (apareceria no git status). Use uma pasta irmã, como ' + c.local + '-nuvem' };
  return { out };
}

function load() {
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; }
}
function save(l) { fs.writeFileSync(FILE, JSON.stringify(l, null, 2), 'utf8'); }
function find(name) { return load().find((p) => p.Name === name); }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'conta';
const branchFor = (accName) => `agente/${slug(accName)}`;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // aspas de shell
function dirExpr(p) {                                           // caminho ja validado (sem aspas/espacos)
  const d = dirOf(p);
  if (d === '~') return '"$HOME"';
  if (d.startsWith('~/')) return `"$HOME/${d.slice(2)}"`;
  if (d.startsWith('/')) return `"${d}"`;
  return `"$HOME/${d}"`;
}

// ---------- scripts remotos (funcoes puras, testaveis) ----------
function setupScript(p, br) {
  return [
    `D=${dirExpr(p)}`,
    `export GIT_TERMINAL_PROMPT=0`,
    `mkdir -p "$(dirname "$D")" 2>&1 || { echo "@@ERR=mkdir"; exit 3; }`,
    `if [ -d "$D/.git" ]; then [ "$(git -C "$D" remote get-url origin 2>/dev/null)" = ${q(p.Repo)} ] || { echo "@@ERR=otherrepo"; exit 3; }`,
    `elif [ -e "$D" ] && [ -n "$(ls -A "$D" 2>/dev/null)" ]; then echo "@@ERR=notempty"; exit 3`,
    `else git clone ${q(p.Repo)} "$D" 2>&1 || { echo "@@ERR=clone"; exit 3; }; fi`,
    `cd "$D" || exit 3`,
    `git fetch -q origin 2>&1 || { echo "@@ERR=fetch"; exit 3; }`,
    `if git show-ref --verify --quiet refs/heads/${br}; then git checkout -q ${br} 2>&1`,
    `elif git show-ref --verify --quiet refs/remotes/origin/${br}; then git checkout -q -b ${br} --track origin/${br} 2>&1`,
    `else git checkout -q -b ${br} origin/${p.Base} 2>&1 || { echo "@@ERR=base"; exit 3; }; fi`,
    `echo "@@OK"`
  ].join('\n');
}

function statusScript(p) {
  return [
    `D=${dirExpr(p)}`,
    `export GIT_TERMINAL_PROMPT=0`,
    `if [ ! -d "$D/.git" ]; then echo "@@NOREPO"; exit 0; fi`,
    `cd "$D"`,
    `if git fetch -q origin 2>/dev/null; then echo "@@FETCH=ok"; else echo "@@FETCH=fail"; fi`,
    `echo "@@BRANCH=$(git rev-parse --abbrev-ref HEAD)"`,
    `echo "@@DIRTY=$(git status --porcelain | wc -l)"`,
    `echo "@@BASE=$(git rev-list --left-right --count origin/${p.Base}...HEAD 2>/dev/null)"`,
    `echo "@@REMOTE=$(git rev-list --left-right --count @{u}...HEAD 2>/dev/null)"`,
    `echo "@@LAST=$(git log -1 --format='%cr · %s' 2>/dev/null)"`
  ].join('\n');
}

function syncScript(p, br, who) {
  return [
    `D=${dirExpr(p)}`,
    `export GIT_TERMINAL_PROMPT=0`,
    `cd "$D" 2>/dev/null || { echo "@@NOREPO"; exit 3; }`,
    `if [ "$(git rev-parse --abbrev-ref HEAD)" != ${q(br)} ]; then git checkout -q ${br} 2>&1 || { echo "@@ERR=checkout"; exit 3; }; fi`,
    `git add -A`,
    `if ! git diff --cached --quiet; then git commit -q -m ${q(`wip(${who}): sincronizado pelo Cloud Shell Hub`)} 2>&1 || { echo "@@ERR=commit"; exit 3; }; fi`,
    `git fetch -q origin 2>&1 || { echo "@@ERR=fetch"; exit 3; }`,
    `if ! git rebase -q origin/${p.Base} >/dev/null 2>&1; then git rebase --abort >/dev/null 2>&1; echo "@@ERR=conflict"; exit 3; fi`,
    `git push -q -u --force-with-lease origin ${br} 2>&1 || { echo "@@ERR=push"; exit 3; }`,
    `echo "@@OK"`
  ].join('\n');
}

const GITHUB_LOGIN = [
  `command -v gh >/dev/null 2>&1 || { echo "O GitHub CLI (gh) não está instalado neste Cloud Shell."; exec bash -l; }`,
  `gh auth status >/dev/null 2>&1 || gh auth login -h github.com -p https -w`,
  `gh auth setup-git && L="$(gh api user -q .login)" && I="$(gh api user -q .id)" && git config --global user.name "$L" && git config --global user.email "$I+$L@users.noreply.github.com" && echo && echo "GitHub conectado como $L."`,
  `exec bash -l`
].join('\n');

// ---------- interpretacao das saidas ----------
function tags(out) {
  const t = {};
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.match(/^@@([A-Z]+)(?:=(.*))?$/);
    if (m) t[m[1]] = m[2] === undefined ? true : m[2].trim();
  }
  return t;
}
function explain(t, out) {
  const o = String(out);
  const auth = /Authentication failed|could not read Username|Permission denied \(publickey\)|Repository not found|terminal prompts disabled|403/i.test(o);
  if (auth) return { kind: 'auth', error: 'Sem acesso ao repositório nesta conta. Use "Conectar GitHub" e tente de novo.' };
  switch (t.ERR) {
    case 'notempty': return { kind: 'dir', error: 'A pasta escolhida já existe e tem arquivos. Escolha outra pasta ou esvazie esta.' };
    case 'otherrepo': return { kind: 'dir', error: 'A pasta escolhida já tem outro repositório Git. Escolha outra pasta.' };
    case 'mkdir': return { kind: 'dir', error: 'Não consegui criar a pasta (sem permissão?).' };
    case 'clone': return { kind: 'clone', error: 'Não consegui clonar o repositório: ' + o.replace(/@@\S+/g, '').trim().slice(-200) };
    case 'base': return { kind: 'base', error: 'O branch base não existe no repositório.' };
    case 'commit': return { kind: 'auth', error: 'O commit falhou (falta nome/e-mail do Git?). Use "Conectar GitHub", que configura isso.' };
    case 'conflict': return { kind: 'conflict', error: 'Conflito ao trazer o main. Nada foi perdido: abra um Shell no projeto e rode git rebase origin/main para resolver.' };
    case 'push': return { kind: 'push', error: 'O envio (push) foi recusado: ' + o.replace(/@@\S+/g, '').trim().slice(-200) };
    case 'fetch': return { kind: 'fetch', error: 'Não consegui buscar as novidades do repositório.' };
    case 'checkout': return { kind: 'checkout', error: 'Não consegui trocar para o branch do agente (há alterações que impedem?).' };
    default: return { kind: 'other', error: o.trim().slice(-240) || 'Falhou' };
  }
}
function counts(v) {
  const m = String(v || '').match(/(\d+)\s+(\d+)/);
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : null;
}

// ---------- API ----------
async function list() { return load().map((p) => ({ ...p, Dir: dirOf(p), InsideHome: insideHome(dirOf(p)), Mirror: mirrorCfg(p) })); }

async function add({ name, repo, base, dir, mirror }) {
  name = (name || '').trim();
  repo = (repo || '').trim();
  base = (base || 'main').trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'Nome: letras, números, ponto, hífen ou sublinhado (até 40)' };
  if (!REPO_RE.test(repo)) return { ok: false, error: 'Endereço do repositório inválido (use https://github.com/dono/repo ou git@github.com:dono/repo.git)' };
  if (!BRANCH_RE.test(base)) return { ok: false, error: 'Branch base inválido' };
  const d = cleanDir(dir);
  if (d === null) return { ok: false, error: 'Pasta inválida: use algo como ~/projetos/app (sem espaços, acentos ou "..")' };
  const l = load();
  if (l.some((p) => p.Name === name)) return { ok: false, error: 'Já existe um projeto com esse nome' };
  const np = { Name: name, Repo: repo, Base: base, Dir: d || defaultDir(name) };
  if (mirror) { const v = validateMirror(np, mirror); if (v.error) return { ok: false, error: v.error }; Object.assign(np, v.out); }
  l.push(np);
  save(l);
  return { ok: true };
}

async function update(name, { dir, base, mirror }) {
  const l = load();
  const p = l.find((x) => x.Name === name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  if (dir !== undefined) {
    const d = cleanDir(dir);
    if (d === null) return { ok: false, error: 'Pasta inválida: use algo como ~/projetos/app (sem espaços, acentos ou "..")' };
    p.Dir = d || defaultDir(name);
  }
  if (base !== undefined) {
    if (!BRANCH_RE.test(String(base).trim())) return { ok: false, error: 'Branch base inválido' };
    p.Base = String(base).trim();
  }
  if (mirror) { const v = validateMirror(p, mirror); if (v.error) return { ok: false, error: v.error }; Object.assign(p, v.out); }
  save(l);
  return { ok: true };
}

async function remove(name) {
  save(load().filter((p) => p.Name !== name));
  return { ok: true };
}

async function setup(name, acc) {
  const p = find(name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  const br = branchFor(acc);
  const r = await cs.sshExec(acc, setupScript(p, br), { timeout: 600000 });
  if (!r.ok) return r;
  const t = tags(r.out);
  return t.OK ? { ok: true, branch: br } : { ok: false, ...explain(t, r.out) };
}

async function status(name, acc) {
  const p = find(name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  const st = await cs.status(acc);           // nao acorda a VM so para ver status
  if (st.state !== 'RUNNING') return { ok: false, asleep: true, state: st.state };
  const r = await cs.sshExec(acc, statusScript(p), { timeout: 60000 });
  if (!r.ok) return r;
  const t = tags(r.out);
  if (t.NOREPO) return { ok: true, cloned: false, expected: branchFor(acc) };
  return {
    ok: true, cloned: true, expected: branchFor(acc),
    branch: t.BRANCH, dirty: Number(t.DIRTY || 0), fetched: t.FETCH === 'ok',
    base: counts(t.BASE), remote: counts(t.REMOTE), last: t.LAST || ''
  };
}

async function sync(name, acc) {
  const p = find(name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  const br = branchFor(acc);
  const r = await cs.sshExec(acc, syncScript(p, br, slug(acc)), { timeout: 300000 });
  if (!r.ok) return r;
  const t = tags(r.out);
  if (t.NOREPO) return { ok: false, kind: 'norepo', error: 'O projeto ainda não foi preparado nesta conta.' };
  return t.OK ? { ok: true } : { ok: false, ...explain(t, r.out) };
}

function paneCommand(name, acc, kind) {
  const p = find(name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  const cd = `cd ${dirExpr(p)} 2>/dev/null || { echo "Projeto ainda não preparado nesta conta."; exec bash -l; }`;
  const run = kind === 'agy' ? 'exec agy' : 'exec bash -l';
  return { ok: true, command: `${cd} && ${run}` };
}

function prUrl(name, acc) {
  const p = find(name);
  if (!p) return { ok: false, error: 'Projeto não encontrado' };
  const m = p.Repo.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return { ok: false, error: 'Abrir PR só funciona com repositórios do GitHub' };
  return { ok: true, url: `https://github.com/${m[1]}/${m[2]}/compare/${p.Base}...${branchFor(acc)}?expand=1` };
}

module.exports = {
  list, add, update, remove, setup, status, sync, paneCommand, prUrl,
  githubCommand: () => GITHUB_LOGIN, branchFor, find, mirrorCfg, cleanDir, isInside, q,
  remoteDirExpr: (d) => dirExpr({ Name: '', Dir: d }),
  _test: { cleanDir, dirExpr, setupScript, statusScript, syncScript, tags, explain, counts }
};
