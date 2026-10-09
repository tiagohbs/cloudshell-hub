// Tarefas delegadas: o agy roda na VM em modo sem interface (agy -p), em segundo plano,
// dentro do espelho do projeto. A tarefa vai e volta por arquivos, sem digitar nada em terminal.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const tar = require('tar');
const cs = require('./cs');
const projects = require('./projects');
const mirror = require('./mirror');
const { remote, target, project, stamp } = mirror._i;
const quota = require('./quota');

const ID_RE = /^T[0-9]{8}-[0-9]{6}-[a-z0-9]{3}$/;
const MODEL_RE = /^[A-Za-z0-9._:-]{1,60}$/;
const EFFORTS = ['low', 'medium', 'high', 'max'];

const newId = () => 'T' + stamp().replace(/[-_]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2') + '-' + Math.random().toString(36).slice(2, 5).padEnd(3, '0');
const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
const stateOf = (code) => (code == null ? 'rodando' : code === 0 ? 'concluida' : code === 130 || code === 143 ? 'cancelada' : 'falhou');
const keyOf = (p, id) => `${p.Name.replace(/[^\w.-]/g, '_')}__${id}`;

function preface(id, mirrorDir, readOnly) {
  return [
    `[Tarefa ${id} delegada pelo orquestrador do PC via Cloud Shell Hub]`,
    `Você está em ${mirrorDir}, uma CÓPIA do projeto que esta no PC do Tiago. Não é um repositório git.`,
    'Antes de comecar, leia .cshub/LEIA-ME.txt. O trabalho sem commit do PC esta em .cshub/git-diff.patch e .cshub/git-status.txt.',
    'As pastas .cshub/ e .saida/ são do sistema de delegação: não fazem parte do projeto (nao as descreva nem as analise como código).',
    ...(readOnly ? ['TAREFA SOMENTE LEITURA: não altere, crie nem apague arquivos do projeto. Escreva apenas dentro de .saida/' + id + '/.'] : []),
    'Execute a tarefa direto, sem pedir confirmação de plano: não há ninguém para responder durante a execução.',
    'Regras:',
    `- Escreva relatorios e arquivos de saida em .saida/${id}/.`,
    `- Ao terminar, escreva um resumo final em .saida/${id}/RESUMO.md (o que fez, o que mudou, o que ficou pendente).`,
    '- Pode editar arquivos do projeto quando a tarefa pedir; as mudancas voltam ao PC numa pasta separada para revisao.',
    '- Não faça git push, não use credenciais do gcloud para mexer em projetos do Google Cloud e não tente buscar segredos (.env, chaves).',
    '- Caminhos do PC (C:\\...) não existem aqui: use caminhos relativos a esta pasta.',
    '',
    '--- TAREFA ---',
    ''
  ].join('\n');
}

// ---------- elegibilidade ----------
// Bloqueia so: (1) conta em uso no PC / reserva manual, (2) sem cota de Gemini, (3) sem horas de VM.
const VM_LIMITE_H = 50;      // limite semanal do Cloud Shell
const VM_MARGEM_H = 3;       // bloqueia quando restam menos de 3 h
const COTA_CORTE = 5;        // bloqueia quando a cota do Gemini restante e menor que 5%
function blockers(a, st, qc, qr) {
  const b = [];
  if (a.Reservada) b.push({ tipo: /^\[PC\]/.test(a.Reservada) ? 'em-uso-no-pc' : 'reserva-manual', motivo: a.Reservada });
  if (st && st.logged === false) b.push({ tipo: 'sem-login', motivo: 'sem login no gcloud' });
  if (qc && qc.esgotada) b.push({ tipo: 'sem-cota-gemini', motivo: 'cota esgotada até ' + fmtWhen(qc.esgotada.ate) });
  else if (qr && qr.minimo < COTA_CORTE) b.push({ tipo: 'sem-cota-gemini', motivo: 'cota do Gemini em ' + qr.minimo + '% (semanal ' + qr.semanal + '%, 5 h ' + qr.cincoHoras + '%)' });
  const h = st && st.weekHours;
  if (h != null && h >= VM_LIMITE_H - VM_MARGEM_H) b.push({ tipo: 'sem-horas-vm', motivo: 'VM com ' + (Math.round(h * 10) / 10) + ' h de ' + VM_LIMITE_H + ' h na semana' });
  return b;
}

// ---------- disparar ----------
async function start(projName, accName, { text, file, edit = true, plan = false, free = false, model, effort, cont = false, minQuota = 0, ignoreQuota = false, useReserved = false, ignoreHours = false } = {}) {
  try {
    const { p, c } = project(projName);
    const reserva = cs.reservedReason(accName);
    if (reserva && !useReserved) return { ok: false, reserved: true, error: `A conta ${accName} está reservada: ${reserva}. Use outra conta (ou --usar-reservada com autorização do Tiago).` };
    if (!ignoreHours) {
      const st = await cs.status(accName);
      if (st.weekHours != null && st.weekHours >= VM_LIMITE_H - VM_MARGEM_H) return { ok: false, hours: true, error: `A VM de ${accName} já usou ${Math.round(st.weekHours * 10) / 10} h dos ${VM_LIMITE_H} h da semana (restam menos de ${VM_MARGEM_H} h). Use outra conta (ou --ignorar-horas).` };
    }
    let cota = null;
    if (!ignoreQuota) {
      const cached = quota.cached(accName);
      if (cached && cached.esgotada) return { ok: false, quota: true, error: `A cota do agy nesta conta esgotou (${cached.esgotada.motivo}). Renova por volta de ${fmtWhen(cached.esgotada.ate)}. Use outra conta.` };
      if (minQuota > 0) {
        const q = await quota.check(accName);
        if (!q.ok) return { ok: false, error: 'Não consegui medir a cota antes de disparar: ' + q.error };
        cota = quota.remaining(q, model);
        if (cota && cota.minimo < minQuota) return { ok: false, quota: true, cota, error: `Cota insuficiente: ${cota.minimo}% restante (semanal ${cota.semanal}%, 5 h ${cota.cincoHoras}%), mínimo pedido ${minQuota}%.` };
      }
    }
    let body = text;
    if (file) body = await fsp.readFile(file, 'utf8');
    if (!body || !String(body).trim()) return { ok: false, error: 'A tarefa está vazia (use um arquivo .md ou --texto).' };
    if (model && !MODEL_RE.test(model)) return { ok: false, error: 'Modelo inválido' };
    if (effort && !EFFORTS.includes(effort)) return { ok: false, error: 'Esforço deve ser low, medium, high ou max' };

    const acc = await target(accName);
    const D = projects.remoteDirExpr(c.mirror);
    const chk = await remote(acc, `[ -f ${D}/.cshub/base.txt ] && echo SIM; command -v agy >/dev/null && echo AGY`, { timeout: 60000 });
    const t = chk.out.toString();
    if (!/SIM/.test(t)) return { ok: false, error: 'O espelho ainda não foi enviado para esta conta. Rode cshub enviar antes.' };
    if (!/AGY/.test(t)) return { ok: false, error: 'O agy não está disponível nesta VM.' };

    const id = newId();
    const key = keyOf(p, id);
    const T = `${D}/.cshub/tarefas/${id}`;
    const up = await remote(acc, `mkdir -p ${T} && cat > ${T}/tarefa.md && echo @@OK`, { input: Buffer.from(preface(id, c.mirror, !edit) + String(body)), timeout: 60000 });
    if (!/@@OK/.test(up.out.toString())) return { ok: false, error: 'Não consegui gravar a tarefa na VM: ' + up.err.trim().slice(-200) };

    // flags vindas so de listas fixas ou validadas
    const flags = ['--output-format json'];
    flags.push(free ? '--dangerously-skip-permissions' : (plan ? '--mode plan' : '--mode accept-edits'));
    if (model) flags.push(`--model ${model}`);
    if (effort) flags.push(`--effort ${effort}`);
    if (cont) flags.push('--continue');

    const launch = [
      `export T=${T}`,
      `cd ${D} || exit 3`,
      `mkdir -p "$HOME/.cshub/rodando" ".saida/${id}"`,
      `date -u +%FT%TZ > "$T/inicio"`,
      `nohup setsid bash -c '` +
        `echo $$ > "$T/pid"; ` +
        `agy -p "$(cat "$T/tarefa.md")" ${flags.join(' ')} > "$T/saida.json" 2> "$T/erro.log" < /dev/null; ` +
        `echo $? > "$T/codigo.tmp"; mv "$T/codigo.tmp" "$T/codigo"; date -u +%FT%TZ > "$T/fim"; ` +
        `rm -f "$HOME/.cshub/rodando/${key}"` +
      `' > /dev/null 2>&1 < /dev/null &`,
      `touch "$HOME/.cshub/rodando/${key}"`,
      `sleep 1; [ -f "$T/pid" ] && echo @@OK`
    ].join('\n');
    const r = await remote(acc, launch, { timeout: 60000 });
    if (!/@@OK/.test(r.out.toString())) return { ok: false, error: 'O agy não iniciou na VM: ' + (r.err || r.out.toString()).trim().slice(-200) };
    return { ok: true, id, conta: accName, projeto: p.Name, modo: free ? 'livre' : plan ? 'plano' : edit ? 'edicao' : 'leitura', cota };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

const taskDir = (c, id) => `${projects.remoteDirExpr(c.mirror)}/.cshub/tarefas/${id}`;
// aceita o ID com ou sem o "T" inicial (e sem os sinais < > de exemplos)
function normId(id) {
  let x = String(id || '').trim().replace(/^[<"']+|[>"']+$/g, '').toLowerCase();
  if (/^\d{8}-\d{6}-[a-z0-9]{3}$/.test(x)) x = 't' + x;
  return x.replace(/^t/, 'T');
}
function checkId(id) { if (!ID_RE.test(normId(id))) throw new Error('ID de tarefa inválido: ' + id + ' (formato: T20261009-123456-abc)'); }

// ---------- esperar ----------
async function wait(projName, accName, id, { minutes = 60, onTick = () => {} } = {}) {
  try {
    id = normId(id);
    checkId(id);
    const { c } = project(projName);
    const acc = await target(accName);
    const T = taskDir(c, id);
    const max = Math.max(1, Math.min(720, Math.floor(minutes))) * 60;
    const script = [
      `T=${T}`,
      `[ -d "$T" ] || { echo "@@NOTASK"; exit 3; }`,
      `i=0`,
      `while [ ! -f "$T/codigo" ]; do`,
      `  if [ -f "$T/pid" ] && ! kill -0 "$(cat "$T/pid")" 2>/dev/null && [ ! -f "$T/codigo" ]; then sleep 2; [ -f "$T/codigo" ] || { echo "@@MORREU"; exit 5; }; fi`,
      `  [ $i -ge ${max} ] && { echo "@@TIMEOUT"; exit 4; }`,
      `  sleep 15; i=$((i+15)); printf '.'`,
      `done`,
      `echo; echo "@@CODE=$(cat "$T/codigo")"`
    ].join('\n');
    const { spawn } = require('child_process');
    // conexao aberta enquanto espera: tambem mantem a sessao do Cloud Shell ativa
    const r = await new Promise((resolve) => {
      const child = spawn('ssh', [...cs.sshBase(acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30']), script], { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { const s = d.toString(); out += s; if (s.includes('.')) onTick(); });
      child.stderr.on('data', (d) => { err += d; });
      child.stdin.on('error', () => {});
      child.stdin.end();
      child.on('error', (e) => resolve({ code: -1, out, err: err + e }));
      child.on('close', (code) => resolve({ code, out, err }));
    });
    if (/@@NOTASK/.test(r.out)) return { ok: false, error: 'Tarefa não encontrada nesta conta: ' + id };
    if (/@@MORREU/.test(r.out)) return { ok: false, dead: true, error: 'O agy parou sem terminar (a VM pode ter reiniciado). Veja cshub resultado para o log e dispare de novo.' };
    if (/@@TIMEOUT/.test(r.out)) return { ok: false, timeout: true, error: `Ainda rodando depois de ${Math.round(max / 60)} min. Rode cshub esperar de novo para continuar aguardando.` };
    const m = r.out.match(/@@CODE=(\d+)/);
    if (!m) return { ok: false, error: 'A conexão caiu enquanto esperava (a tarefa pode continuar rodando). Rode cshub esperar de novo. ' + r.err.trim().slice(-160) };
    return { ok: true, id, code: Number(m[1]), success: Number(m[1]) === 0 };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- resultado ----------
function answerFrom(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const pick = (o) => {
    if (o == null) return null;
    if (typeof o === 'string') return o;
    for (const k of ['result', 'response', 'text', 'output', 'content', 'message', 'answer']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object') { const x = pick(v); if (x) return x; }
    }
    return null;
  };
  try { return pick(JSON.parse(s)) || s; } catch {}
  // pode ser NDJSON: pega a ultima linha que tiver texto
  const lines = s.split(/\r?\n/).reverse();
  for (const l of lines) { try { const x = pick(JSON.parse(l)); if (x) return x; } catch {} }
  return s;
}

async function result(projName, accName, id) {
  try {
    id = normId(id);
    checkId(id);
    const { c } = project(projName);
    const acc = await target(accName);
    const T = taskDir(c, id);
    const dest = path.join(c.results, accName.replace(/[^\w.-]/g, '_'), 'tarefas', id);
    await fsp.mkdir(dest, { recursive: true });
    const x = tar.x({ cwd: dest, strict: true });
    const done = new Promise((res, rej) => { x.on('finish', res); x.on('close', res); x.on('error', rej); });
    const r = await remote(acc, `[ -d ${T} ] || { echo NOTASK >&2; exit 3; }; cd ${T} && tar -c -f - .`, { stdout: x, timeout: 120000 });
    await done;
    if (r.code !== 0) return { ok: false, error: /NOTASK/.test(r.err) ? 'Tarefa não encontrada nesta conta: ' + id : 'Falha ao baixar o resultado: ' + r.err.trim().slice(-200) };
    const read = (f) => { try { return fs.readFileSync(path.join(dest, f), 'utf8'); } catch { return null; } };
    const code = read('codigo');
    let state = stateOf(code != null ? Number(code.trim()) : null);
    let esgotada = null;
    if (state === 'falhou') {
      const qe = quota.quotaError((read('erro.log') || '') + '\n' + (read('saida.json') || ''));
      if (qe) { state = 'cota-esgotada'; esgotada = quota.markExhausted(accName, qe.reset, 'erro de cota na tarefa ' + id); }
    }
    return {
      ok: true, id, state, esgotada, code: code != null ? Number(code.trim()) : null,
      answer: answerFrom(read('saida.json')),
      errors: (read('erro.log') || '').trim().slice(-2000),
      dest, outputs: `.saida/${id}/`
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- listar e cancelar ----------
async function list(projName, accName) {
  try {
    const { c } = project(projName);
    const acc = await target(accName);
    const D = projects.remoteDirExpr(c.mirror);
    const r = await remote(acc, `for d in ${D}/.cshub/tarefas/T*/; do [ -d "$d" ] || continue; id=$(basename "$d"); ` +
      `if [ -f "$d/codigo" ]; then s="fim:$(cat "$d/codigo")"; elif [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then s=rodando; else s=parou; fi; ` +
      `echo "$id $s $(cat "$d/inicio" 2>/dev/null) $(cat "$d/fim" 2>/dev/null)"; done`, { timeout: 60000 });
    const tasks = r.out.toString().split(/\r?\n/).filter((l) => /^T\d/.test(l)).map((l) => {
      const [id, s, inicio, fim] = l.trim().split(/\s+/);
      const state = s === 'rodando' || s === 'parou' ? s : stateOf(Number(String(s).replace('fim:', '')));
      return { id, state, inicio: inicio || null, fim: fim || null };
    });
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function cancel(projName, accName, id) {
  try {
    id = normId(id);
    checkId(id);
    const { p, c } = project(projName);
    const acc = await target(accName);
    const T = taskDir(c, id);
    const r = await remote(acc, `T=${T}; [ -f "$T/codigo" ] && { echo "@@JA"; exit 0; }; ` +
      `[ -f "$T/pid" ] && kill -TERM -- -"$(cat "$T/pid")" 2>/dev/null; sleep 2; ` +
      `[ -f "$T/codigo" ] || { echo 130 > "$T/codigo"; date -u +%FT%TZ > "$T/fim"; }; rm -f "$HOME/.cshub/rodando/${keyOf(p, id)}"; echo "@@OK"`, { timeout: 60000 });
    const s = r.out.toString();
    if (/@@JA/.test(s)) return { ok: true, already: true };
    return /@@OK/.test(s) ? { ok: true } : { ok: false, error: 'Não consegui cancelar: ' + r.err.trim().slice(-200) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- contas: estado para escolher onde delegar ----------
async function accountsOverview() {
  const out = [];
  for (const a of await cs.list()) {
    const st = await cs.status(a.Name);
    const row = { conta: a.Name, reservada: a.Reservada || null, estado: st.logged === false ? 'sem-login' : (st.state || 'desconhecido'), horas7d: st.weekHours != null ? Math.round(st.weekHours * 10) / 10 : null, rodando: null };
    const qc = quota.cached(a.Name);
    const qr = quota.remaining(qc);
    row.cota = qc ? { gemini: qr ? { semanal: qr.semanal, cincoHoras: qr.cincoHoras, minimo: qr.minimo } : null, medidaHaMin: qc.idadeMin, esgotadaAte: qc.esgotada ? qc.esgotada.ate : null } : null;
    if (st.state === 'RUNNING' && a.Host) {
      const r = await remote(a, 'ls "$HOME/.cshub/rodando" 2>/dev/null | wc -l', { timeout: 20000 });
      if (r.code === 0) row.rodando = parseInt(r.out.toString(), 10) || 0;
    }
    row.bloqueio = blockers(a, st, qc, qr);
    row.elegivel = row.bloqueio.length === 0;
    out.push(row);
  }
  return out;
}

module.exports = { blockers, start, wait, result, list, cancel, accountsOverview, _test: { preface, answerFrom, newId, ID_RE } };
