// Espelho do PC na nuvem: copia direta por SSH (sem Git, sem push).
// Envio incremental em fluxo, segredos fora por padrao, resultados voltam para uma pasta fora do worktree.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const tar = require('tar');
const cs = require('./cs');
const projects = require('./projects');

const STATE = path.join(os.homedir(), '.cshub');
const MIN_FREE = 1024 * 1024 * 1024;   // teto: 1 GB livre so para envios grandes
const MIN_FREE_FLOOR = 64 * 1024 * 1024;   // piso: abaixo disso nem tenta
const SMALL_SEND = 50 * 1024 * 1024;       // envio incremental pequeno ignora o limiar
const META = '.cshub';                 // pasta de metadados dentro do espelho

// ---------- padroes de exclusao ----------
function compile(patterns) {
  const esc = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  const rx = patterns.map((p) => {
    p = String(p).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!p) return null;
    return p.includes('/') ? { path: true, re: new RegExp('^' + esc(p) + '(/|$)', 'i') } : { path: false, re: new RegExp('^' + esc(p) + '$', 'i') };
  }).filter(Boolean);
  return (rel) => {
    const segs = rel.split('/');
    return rx.some((r) => (r.path ? r.re.test(rel) : segs.some((s) => r.re.test(s))));
  };
}

async function walk(root, skip) {
  const files = new Map();
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let ents;
    try { ents = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(r);
      else if (e.isFile()) {
        try {
          const st = await fsp.stat(path.join(root, r));
          files.set(r, { size: st.size, mtime: Math.floor(st.mtimeMs) });
        } catch {}
      }
    }
  }
  return files;
}

// ---------- ssh ----------
async function target(accName) {
  const p = await cs.prepare(accName);
  if (!p.ok) throw new Error(p.error || 'Não consegui preparar a conta');
  return p.acc;
}
function sshArgs(acc, cmd) {
  return [...cs.sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']), cmd];
}
// roda um comando remoto; input opcional (Buffer/string ou stream); devolve stdout como Buffer
function remote(acc, cmd, { input, stdout, timeout = 30 * 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('ssh', sshArgs(acc, cmd), { windowsHide: true });
    const out = [];
    let err = '';
    let done = false;
    const finish = (code) => { if (!done) { done = true; clearTimeout(t); resolve({ code, out: Buffer.concat(out), err }); } };
    const t = setTimeout(() => { try { child.kill(); } catch {} finish(-2); }, timeout);
    if (stdout) child.stdout.pipe(stdout); else child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});   // ssh pode fechar antes do fim da entrada
    child.on('error', (e) => { err += String(e); finish(-1); });
    child.on('close', (code) => finish(code));
    if (input && typeof input.pipe === 'function') {
      input.on('error', (e) => { err += String(e); try { child.stdin.end(); } catch {} });
      input.pipe(child.stdin);
    } else child.stdin.end(input || '');
  });
}

// ---------- git local (diff/estado para o agente) ----------
function git(cwd, args) {
  return new Promise((resolve) => {
    let out = Buffer.alloc(0);
    let c;
    try { c = spawn('git', args, { cwd, windowsHide: true }); } catch { return resolve({ code: -1, out: '' }); }
    c.stdout.on('data', (d) => { out = Buffer.concat([out, d]); });
    c.on('error', () => resolve({ code: -1, out: '' }));
    c.on('close', (code) => resolve({ code, out: out.toString('utf8') }));
  });
}
function pathspecExcludes(patterns) {
  const ps = [];
  for (const p of patterns) {
    const x = p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (x.includes('/')) ps.push(`:(exclude,glob)${x}`, `:(exclude,glob)${x}/**`);
    else ps.push(`:(exclude,glob)**/${x}`, `:(exclude,glob)**/${x}/**`);
  }
  return ps;
}

const stamp = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};
const lowPriority = async (fn) => {
  let prev = null;
  try { prev = os.getPriority(process.pid); os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  try { return await fn(); } finally { if (prev !== null) { try { os.setPriority(process.pid, prev); } catch {} } }
};
const fmtMB = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

function project(name) {
  const p = projects.find(name);
  if (!p) throw new Error('Projeto não encontrado: ' + name);
  const c = projects.mirrorCfg(p);
  if (!c.local) throw new Error('Defina a pasta do projeto no PC (Editar projeto) antes de usar o espelho.');
  if (!fs.existsSync(c.local)) throw new Error('A pasta no PC não existe: ' + c.local);
  if (projects.cleanDir(c.mirror) === null) throw new Error('Pasta do espelho inválida: ' + c.mirror);
  return { p, c };
}
const manifestFile = (proj, acc) => path.join(STATE, 'manifest', `${proj}__${acc}.json`.replace(/[^\w.-]/g, '_'));

// ultimo envio (le o manifesto guardado no PC; nao toca na VM)
function lastSend(projName, accName) {
  try {
    const j = JSON.parse(fs.readFileSync(manifestFile(projName, accName), 'utf8'));
    let n = 0, bytes = 0;
    for (const k of Object.keys(j.files || {})) { n++; bytes += (j.files[k] && j.files[k][0]) || 0; }
    return { ok: true, at: j.at || null, total: n, bytes };
  } catch { return { ok: true, none: true }; }
}

// ---------- o espelho esta em dia com o PC? (so olha o PC e o manifesto; nao toca na VM) ----------
async function pending(projName, accName) {
  try {
    const { c } = project(projName);
    let old;
    try { old = JSON.parse(fs.readFileSync(manifestFile(projName, accName), 'utf8')).files || {}; } catch { return { ok: true, none: true, total: 0, sample: [] }; }
    const now = await walk(c.local, compile([...c.exclude, ...c.secrets, META]));
    const diff = [];
    for (const [r, st] of now) { const o = old[r]; if (!o || o[0] !== st.size || o[1] !== st.mtime) diff.push(r); }
    for (const r of Object.keys(old)) if (!now.has(r)) diff.push(r);
    return { ok: true, total: diff.length, sample: diff.slice(0, 5) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// ---------- enviar ----------
async function send(projName, accName, { full = false, withSecrets = false, force = false, log = () => {} } = {}) {
  try {
    const { p, c } = project(projName);
    if (!force && os.freemem() < MIN_FREE_FLOOR) {
      return { ok: false, lowMemory: true, error: `Pouca memória livre no PC (${fmtMB(os.freemem())}). Espere o que estiver pesado terminar ou force o envio.` };
    }
    return await lowPriority(async () => {
      const skipPatterns = [...c.exclude, ...(withSecrets ? [] : c.secrets), META];
      const skip = compile(skipPatterns);
      log('Lendo a pasta do PC…');
      const now = await walk(c.local, skip);
      const acc = await target(accName);
      const D = projects.remoteDirExpr(c.mirror);
      const key = p.Name.replace(/[^\w.-]/g, '_');

      // estado remoto: se o espelho sumiu (VM nova, 120 dias sem uso), manda tudo
      const chk = await remote(acc, `[ -d ${D} ] && [ -f "$HOME/.cshub/sent/${key}.ok" ] && echo SIM; df -P -B1 "$HOME" | tail -1`, { timeout: 60000 });
      const txt = chk.out.toString();
      const remoteOk = /^SIM/m.test(txt);
      const dfm = txt.match(/\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%/);
      const avail = dfm ? Number(dfm[3]) : null;

      let old = {};
      const mf = manifestFile(p.Name, accName);
      if (!full && remoteOk) { try { old = JSON.parse(fs.readFileSync(mf, 'utf8')).files || {}; } catch { old = {}; } }
      const isFull = full || !remoteOk || !Object.keys(old).length;
      const changed = [];
      let bytes = 0;
      for (const [r, st] of now) {
        const o = old[r];
        if (isFull || !o || o[0] !== st.size || o[1] !== st.mtime) { changed.push(r); bytes += st.size; }
      }
      const removed = isFull ? [] : Object.keys(old).filter((r) => !now.has(r));
      // o limiar de memoria acompanha o volume a enviar (o envio e em fluxo, nao carrega os arquivos inteiros)
      if (!force && bytes >= SMALL_SEND) {
        const need = Math.min(MIN_FREE, bytes * 3 + 256 * 1024 * 1024);
        if (os.freemem() < need) return { ok: false, lowMemory: true, error: `Pouca memória livre no PC (${fmtMB(os.freemem())}) para enviar ${fmtMB(bytes)} (precisa de ~${fmtMB(need)}). Espere o que estiver pesado terminar ou force o envio.` };
      }
      if (avail != null && bytes * 1.1 > avail) return { ok: false, error: `Espaço insuficiente no Cloud Shell: precisa de ${fmtMB(bytes)}, livre ${fmtMB(avail)}.` };

      // 1) arquivos alterados, em fluxo
      if (changed.length) {
        log(`Enviando ${changed.length} arquivo(s), ${fmtMB(bytes)}…`);
        const stream = tar.c({ cwd: c.local, portable: true, noDirRecurse: true, follow: false }, changed);
        const r = await remote(acc, `mkdir -p ${D} && tar -x -f - -C ${D} && echo @@OK`, { input: stream });
        if (!/@@OK/.test(r.out.toString())) return { ok: false, error: 'Falha ao enviar os arquivos: ' + (r.err || r.out.toString()).trim().slice(-300) };
      }
      // 2) arquivos apagados no PC
      if (removed.length) {
        log(`Removendo ${removed.length} arquivo(s) que não existem mais no PC…`);
        const list = Buffer.from(removed.filter((r) => !r.split('/').includes('..')).join('\0') + '\0');
        await remote(acc, `cd ${D} && while IFS= read -r -d '' f; do case "$f" in /*|*..*) ;; *) rm -f -- "$f" ;; esac; done; echo @@OK`, { input: list });
      }

      // 3) metadados para o agente: estado do git gerado aqui
      log('Gerando git diff e estado do git no PC…');
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cshub-'));
      try {
        const ex = pathspecExcludes([...c.exclude, ...c.secrets]);
        const branch = (await git(c.local, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
        const head = (await git(c.local, ['rev-parse', 'HEAD'])).out.trim();
        const status = await git(c.local, ['status', '--porcelain=v1', '-uall', '--', '.', ...ex]);
        const diff = await git(c.local, ['diff', 'HEAD', '--binary', '--', '.', ...ex]);
        const hasGit = status.code === 0;
        await fsp.writeFile(path.join(tmp, 'base.txt'), hasGit ? `branch: ${branch}\ncommit: ${head}\nenviado: ${new Date().toISOString()}\norigem: ${c.local.replace(/\\/g, '/')}\n` : `sem git na origem\nenviado: ${new Date().toISOString()}\n`);
        await fsp.writeFile(path.join(tmp, 'git-status.txt'), hasGit ? status.out : '');
        await fsp.writeFile(path.join(tmp, 'git-diff.patch'), hasGit ? diff.out : '');
        await fsp.writeFile(path.join(tmp, 'LEIA-ME.txt'), [
          'Esta pasta e uma COPIA do projeto que esta no PC do usuário. Ela NAO e um repositorio git.',
          'git status / git diff não funcionam aqui. Para saber o que mudou em relação ao commit base:',
          '  - .cshub/base.txt       branch e commit de origem no PC',
          '  - .cshub/git-status.txt saida de git status no PC (arquivos alterados e novos)',
          '  - .cshub/git-diff.patch git diff HEAD gerado no PC (trabalho sem commit)',
          'Segredos (.env, chaves) normalmente NAO foram copiados.',
          'Coloque relatórios e arquivos de saída em .saida/ dentro desta pasta. Tudo que você criar ou alterar aqui volta para o PC numa pasta separada quando o usuário pedir.',
          ''
        ].join('\n'));
        const ms = tar.c({ cwd: tmp, portable: true }, ['base.txt', 'git-status.txt', 'git-diff.patch', 'LEIA-ME.txt']);
        await remote(acc, `mkdir -p ${D}/${META} && tar -x -f - -C ${D}/${META} && echo @@OK`, { input: ms });
      } finally {
        fs.rm(tmp, { recursive: true, force: true }, () => {});
      }

      // 4) linha de base remota (para saber depois o que o agente mudou)
      const base = await remote(acc, `mkdir -p "$HOME/.cshub/manifest" "$HOME/.cshub/sent" && cd ${D} && find . -path ./${META} -prune -o -type f -printf '%P\\0%s\\0%T@\\0' > "$HOME/.cshub/manifest/${key}.bin" && touch "$HOME/.cshub/sent/${key}.ok" && echo @@OK`, { timeout: 120000 });
      if (!/@@OK/.test(base.out.toString())) return { ok: false, error: 'Arquivos enviados, mas falhou ao registrar a linha de base na VM.' };

      const files = {};
      for (const [r, st] of now) files[r] = [st.size, st.mtime];
      await fsp.mkdir(path.dirname(mf), { recursive: true });
      await fsp.writeFile(mf, JSON.stringify({ at: Date.now(), mirror: c.mirror, files }));
      return { ok: true, full: isFull, sent: changed.length, bytes, removed: removed.length, total: now.size, mirror: c.mirror, withSecrets };
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- trazer resultados ----------
// git diff --no-index escreve os caminhos absolutos do Windows no cabecalho; reescreve com o caminho relativo do projeto
function relPatch(f, out) {
  const s = String(out || '');
  if (!s.trim()) return '';
  const at = s.search(/^@@ /m);
  const head = `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n`;
  if (at >= 0) return head + s.slice(at);
  return /Binary files/.test(s) ? `diff --git a/${f} b/${f}\nBinary files a/${f} and b/${f} differ\n` : '';
}

function parseFind(buf) {
  const parts = buf.split('\0');
  const m = new Map();
  for (let i = 0; i + 2 < parts.length; i += 3) {
    if (!parts[i]) continue;
    m.set(parts[i], { size: Number(parts[i + 1]), mtime: parts[i + 2] });
  }
  return m;
}

async function fetchResults(projName, accName, { log = () => {} } = {}) {
  try {
    const { p, c } = project(projName);
    const acc = await target(accName);
    const D = projects.remoteDirExpr(c.mirror);
    const key = p.Name.replace(/[^\w.-]/g, '_');
    const skip = compile([...c.exclude, ...c.secrets, META]);
    const prune = c.exclude.concat(c.secrets).filter((x) => !x.includes('/'));
    const pruneExpr = prune.length ? `\\( ${prune.map((x) => `-name ${projects.q(x)}`).join(' -o ')} \\) -prune -o` : '';
    log('Comparando o espelho com o que foi enviado…');
    const r = await remote(acc, `[ -d ${D} ] || { echo @@NOMIRROR; exit 3; }; printf '@@BASE\\0'; cat "$HOME/.cshub/manifest/${key}.bin" 2>/dev/null; printf '@@NOW\\0'; cd ${D} && find . -path ./${META} -prune -o ${pruneExpr} -type f -printf '%P\\0%s\\0%T@\\0'`, { timeout: 120000 });
    const s = r.out.toString('utf8');
    if (s.includes('@@NOMIRROR')) return { ok: false, error: 'O espelho ainda não existe nesta conta. Use Enviar do PC primeiro.' };
    const bi = s.indexOf('@@BASE\0');
    const ni = s.indexOf('@@NOW\0');
    if (bi < 0 || ni < 0) return { ok: false, error: 'Resposta inesperada da VM: ' + (r.err || s).trim().slice(-200) };
    const before = parseFind(s.slice(bi + 7, ni));
    const after = parseFind(s.slice(ni + 6));
    const added = [];
    const modified = [];
    const deleted = [];
    for (const [f, st] of after) {
      if (skip(f)) continue;
      const b = before.get(f);
      if (!b) added.push(f);
      else if (b.size !== st.size || b.mtime !== st.mtime) modified.push(f);
    }
    for (const f of before.keys()) if (!after.has(f) && !skip(f)) deleted.push(f);
    if (!added.length && !modified.length && !deleted.length) return { ok: true, none: true };

    const dest = path.join(c.results, accName.replace(/[^\w.-]/g, '_'), stamp());
    const files = path.join(dest, 'arquivos');
    await fsp.mkdir(files, { recursive: true });
    // ainda sem decidir os 'modificados': a data pode ter mudado sem o conteudo (ex.: o agente mutou e restaurou com cp)
    let want = [...added, ...modified];
    if (want.length) {
      log(`Trazendo ${want.length} arquivo(s)…`);
      const x = tar.x({ cwd: files, strict: true });
      const done = new Promise((res, rej) => { x.on('finish', res); x.on('close', res); x.on('error', rej); });
      const rr = await remote(acc, `cd ${D} && tar -c -f - --null -T -`, { input: Buffer.from(want.join('\0') + '\0'), stdout: x });
      await done;
      if (rr.code !== 0) return { ok: false, error: 'Falha ao trazer os arquivos: ' + rr.err.trim().slice(-300), dest };
    }
    // compara por conteudo com a copia do PC: arquivo igual so mudou de data -> nao entra como alterado
    const iguais = [];
    for (const f of [...modified]) {
      let a = null; let b = null;
      try { a = await fsp.readFile(path.join(c.local, f)); b = await fsp.readFile(path.join(files, f)); } catch {}
      if (a && b && a.equals(b)) { iguais.push(f); modified.splice(modified.indexOf(f), 1); try { await fsp.rm(path.join(files, f)); } catch {} }
    }
    if (!added.length && !modified.length && !deleted.length) return { ok: true, none: true, iguais: iguais.length, soData: iguais };
    const lines = [
      `# Mudanças no espelho ${c.mirror} (${accName}) em relação ao último envio`,
      `# A = novo, M = alterado, D = apagado na nuvem (nada foi apagado no PC)`,
      ...added.map((f) => `A ${f}`), ...modified.map((f) => `M ${f}`), ...deleted.map((f) => `D ${f}`),
      ...(iguais.length ? ['# = conteúdo idêntico ao do PC (só a data mudou): não entram como alterados', ...iguais.map((f) => `= ${f}`)] : []), ''
    ];
    await fsp.writeFile(path.join(dest, 'mudancas.txt'), lines.join('\n'));
    // patch dos arquivos alterados contra a versao atual do PC (conveniencia)
    let patch = '';
    for (const f of modified) {
      const a = path.join(c.local, f);
      const b = path.join(files, f);
      if (!fs.existsSync(a)) continue;
      const d = await git(c.local, ['diff', '--no-index', '--no-color', '--', a, b]);
      patch += relPatch(f, d.out);
    }
    if (patch) await fsp.writeFile(path.join(dest, 'alteracoes.patch'), patch);
    return { ok: true, dest, added: added.length, modified: modified.length, deleted: deleted.length, iguais: iguais.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- aplicar o resultado num worktree, com conferencia ----------
// Recusa tudo se algum arquivo local nao estiver igual ao que foi enviado; copia, lista o que mudou e deixa .saida/ de fora.
async function apply(projName, accName, id, worktree, { dry = false, force = false, log = () => {} } = {}) {
  try {
    const { p, c } = project(projName);
    const wt = path.resolve(String(worktree || ''));
    if (!worktree || !fs.existsSync(wt) || !fs.statSync(wt).isDirectory()) return { ok: false, error: 'Não posso aplicar: a pasta de destino não existe: ' + worktree };
    let sent;
    try { sent = JSON.parse(fs.readFileSync(manifestFile(p.Name, accName), 'utf8')).files || {}; } catch { return { ok: false, error: 'Não posso aplicar: não há registro do último envio para esta conta. Rode cshub enviar.' }; }
    const fr = await fetchResults(projName, accName, { log });
    if (!fr.ok) return fr;
    if (fr.none) return { ok: true, none: true, aplicados: [], novos: [], apagadosNaNuvem: [] };
    const lines = fs.readFileSync(path.join(fr.dest, 'mudancas.txt'), 'utf8').split(/\r?\n/).filter((l) => /^[AMD] /.test(l));
    const skipOut = (f) => f === '.saida' || f.startsWith('.saida/') || f === META || f.startsWith(META + '/');
    const mods = []; const adds = []; const dels = [];
    for (const l of lines) { const k = l[0]; const f = l.slice(2); if (skipOut(f) || f.split('/').includes('..')) continue; (k === 'M' ? mods : k === 'A' ? adds : dels).push(f); }
    const same = path.resolve(c.local).toLowerCase() === wt.toLowerCase();
    const problemas = [];
    const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
    for (const f of mods) {
      const dst = path.join(wt, f);
      const o = sent[f];
      const cur = read(dst);
      if (cur === null) { problemas.push(`${f}: não existe no destino`); continue; }
      if (same) {
        const st = fs.statSync(dst);
        if (!o || o[0] !== st.size || o[1] !== Math.floor(st.mtimeMs)) problemas.push(`${f}: mudou no PC depois do envio`);
      } else {
        const src = read(path.join(c.local, f));
        if (src === null || !cur.equals(src)) problemas.push(`${f}: o destino é diferente do que foi enviado`);
        else { const st = fs.statSync(path.join(c.local, f)); if (!o || o[0] !== st.size || o[1] !== Math.floor(st.mtimeMs)) problemas.push(`${f}: a pasta do PC mudou depois do envio (reenvie com cshub enviar)`); }
      }
    }
    for (const f of adds) {
      const cur = read(path.join(wt, f));
      const nu = read(path.join(fr.dest, 'arquivos', f));
      if (cur !== null && (nu === null || !cur.equals(nu))) problemas.push(`${f}: já existe no destino com outro conteúdo`);
    }
    if (problemas.length && !force) return { ok: false, conflitos: problemas, dest: fr.dest, error: `Não posso aplicar: ${problemas.length} arquivo(s) não conferem com o que foi enviado. Nada foi copiado.\n  ` + problemas.slice(0, 15).join('\n  ') + (problemas.length > 15 ? `\n  … e mais ${problemas.length - 15}` : '') };
    const aplicados = []; const novos = [];
    if (!dry) {
      for (const f of [...mods, ...adds]) {
        const dst = path.join(wt, f);
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.copyFile(path.join(fr.dest, 'arquivos', f), dst);
      }
    }
    aplicados.push(...mods); novos.push(...adds);
    return { ok: true, dry, id, destino: wt, aplicados, novos, apagadosNaNuvem: dels, ignorados: lines.length - mods.length - adds.length - dels.length, conflitosForcados: problemas, dest: fr.dest };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// ---------- traduzir caminho do PC para o espelho ----------
async function translate(projName, input, accName) {
  try {
    const { c } = project(projName);
    let s = String(input || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
    const root = c.local.replace(/\\/g, '/').replace(/\/+$/, '');
    let rel;
    if (/^[A-Za-z]:\//.test(s) || s.startsWith('/')) {
      if (s.toLowerCase() === root.toLowerCase()) rel = '';
      else if (s.toLowerCase().startsWith(root.toLowerCase() + '/')) rel = s.slice(root.length + 1);
      else return { ok: false, error: `Fora do projeto (${root}): ${s}` };
    } else rel = s.replace(/^\.\//, '');
    rel = rel.replace(/\/+/g, '/').replace(/\/$/, '');
    if (rel.split('/').includes('..')) return { ok: false, error: 'Caminho com ".." não é aceito' };
    let base = c.mirror.replace(/\/+$/, '');
    if (accName) {
      const acc = (await cs.list()).find((a) => a.Name === accName || a.Email === accName);
      if (acc && acc.User) {
        if (base === '~') base = `/home/${acc.User}`;
        else if (base.startsWith('~/')) base = `/home/${acc.User}/${base.slice(2)}`;
        else if (!base.startsWith('/')) base = `/home/${acc.User}/${base}`;
      }
    } else if (!base.startsWith('/') && !base.startsWith('~')) base = `~/${base}`;
    const out = rel ? `${base}/${rel}` : base;
    const secret = rel && compile(c.secrets)(rel);
    const excluded = rel && compile([...c.exclude, META])(rel);
    return { ok: true, path: out, secret: !!secret, excluded: !!excluded };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function paneCommand(projName, kind) {
  try {
    const { c } = project(projName);
    const D = projects.remoteDirExpr(c.mirror);
    return { ok: true, command: `cd ${D} 2>/dev/null || { echo "O espelho ainda não foi enviado para esta conta."; exec bash -l; } && ${kind === 'agy' ? 'exec agy' : 'exec bash -l'}` };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

module.exports = { lastSend, send, pending, apply, fetchResults, translate, paneCommand, _i: { remote, target, project, stamp }, _test: { compile, walk, parseFind, pathspecExcludes, relPatch } };
