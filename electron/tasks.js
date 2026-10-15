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
// motivos gravados pelo vigia na VM
const MOTIVOS = ['cota', 'login', 'servidor', 'rede', 'travada', 'tempo-maximo', 'sem-resposta', 'segundo-plano', 'sem-resumo', 'comando-nao-encontrado', 'falhou'];
const cleanMotivo = (m) => { m = String(m || '').trim(); return MOTIVOS.includes(m) ? m : null; };
const shq = (v) => "'" + String(v).replace(/'/g, "'\\''") + "'";
const keyOf = (p, id) => `${p.Name.replace(/[^\w.-]/g, '_')}__${id}`;

function preface(id, mirrorDir, readOnly, anexos = []) {
  return [
    `[Tarefa ${id} delegada pelo orquestrador do PC via Cloud Shell Hub]`,
    `Você está em ${mirrorDir}, uma CÓPIA do projeto que esta no PC do Tiago. Não é um repositório git.`,
    'Antes de comecar, leia .cshub/LEIA-ME.txt. O trabalho sem commit do PC esta em .cshub/git-diff.patch e .cshub/git-status.txt.',
    'As pastas .cshub/ e .saida/ são do sistema de delegação: não fazem parte do projeto (nao as descreva nem as analise como código).',
    ...(readOnly ? ['TAREFA SOMENTE LEITURA: não altere, crie nem apague arquivos do projeto. Escreva apenas dentro de .saida/' + id + '/.'] : []),
    'Execute a tarefa direto, sem pedir confirmação de plano: não há ninguém para responder durante a execução.',
    'Regras:',
    `- Escreva relatorios e arquivos de saida em .saida/${id}/.`,
    '- Pode editar arquivos do projeto quando a tarefa pedir; as mudancas voltam ao PC numa pasta separada para revisao.',
    ...(anexos.length ? [`- Arquivos anexados pelo orquestrador (não fazem parte do projeto): ${anexos.map((a) => `.saida/${id}/anexos/${a}`).join(', ')}. Leia-os antes de começar.`] : []),
    '- Não faça git push, não use credenciais do gcloud para mexer em projetos do Google Cloud e não tente buscar segredos (.env, chaves).',
    '- Caminhos do PC (C:\\...) não existem aqui: use caminhos relativos a esta pasta.',
    '- NUNCA deixe nada em segundo plano (nem "&", nem nohup, nem tarefas de fundo da ferramenta): quando você responde, o que estiver em segundo plano é perdido e a tarefa acaba sem entrega. Rode testes, benchmarks e scripts em primeiro plano e espere terminarem. Scripts longos que passam minutos sem imprimir (testes, mutação, QA, .mjs) são aceitos: o vigia vê o CPU e dá tempo. Se um script não usa CPU, dê sinal com: touch "$CSHUB_PULSO" a cada poucos minutos.',
    '- NUNCA use pkill/killall por padrão de texto (pkill -f "..."): a linha de comando deste agente contém o texto da tarefa e o padrão pode matar você mesmo. Encerre processos só pelo PID que você mesmo criou ($!).',
    '- Depois de editar um teste, imprima o nome do it/test que contém a linha editada (não confie só no número da linha); procure sempre pelo nome, nunca pela linha antiga.',
    '- Mutações: não escolha você mesmo as mutações para "provar" seus testes. Use só a lista que a tarefa trouxer; se não trouxe, escreva no RESUMO que a prova de mutação está pendente do juiz.',
    '- Falsos e mocks de teste devem reproduzir a semântica real do que o teste vigia (ex.: callbacks assíncronos só depois do evento real, buffers com dados de verdade); um falso que aceita qualquer coisa não prova nada.',
    `- A tarefa só vale se .saida/${id}/RESUMO.md existir ao final. Escreva-o por último, mesmo se algo falhar (diga o que ficou pendente).`,
    '- Todo número, contagem de testes ou nome de arquivo citado no RESUMO deve ser copiado da saída real ou do arquivo; nunca de memória nem estimado. Se não mediu, escreva "não medido".',
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
async function start(projName, accName, { text, file, edit = true, plan = false, free = false, model, effort, cont = false, minQuota = 0, ignoreQuota = false, useReserved = false, ignoreHours = false, stallMin, maxMin, retry, command = false, live = false, anexos = [], ignoreStale = false, impatient = false } = {}) {
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
    if (!body || !String(body).trim()) return { ok: false, error: command ? 'O comando está vazio (use --comando ou --arquivo).' : 'A tarefa está vazia (use um arquivo .md ou --texto).' };
    if (model && !MODEL_RE.test(model)) return { ok: false, error: 'Modelo inválido' };
    if (effort && !EFFORTS.includes(effort)) return { ok: false, error: 'Esforço deve ser low, medium, high ou max' };

    // anexos avulsos (ex.: veredito de um juiz que não está no espelho)
    const att = [];
    for (const f of anexos || []) {
      let st;
      try { st = fs.statSync(f); } catch { return { ok: false, error: 'Anexo não encontrado: ' + f }; }
      if (!st.isFile()) return { ok: false, error: 'O anexo não é um arquivo: ' + f };
      if (st.size > 25 * 1048576) return { ok: false, error: 'Anexo grande demais (máximo 25 MB): ' + f };
      let n = path.basename(f).replace(/[^\w.\- ]/g, '_');
      while (att.some((x) => x.name === n)) n = '_' + n;
      att.push({ path: f, name: n });
    }
    // o espelho precisa refletir o PC: senão a tarefa roda sobre arquivos velhos
    if (!ignoreStale) {
      const pd = await mirror.pending(projName, accName);
      if (pd.ok && pd.total > 0) return { ok: false, stale: true, pendentes: pd.total, exemplos: pd.sample, error: `O espelho de ${accName} está desatualizado: ${pd.total} arquivo(s) do PC diferem do último envio (ex.: ${pd.sample.join(', ')}). Rode cshub enviar antes, ou use --ignorar-espelho se for de propósito.` };
    }

    const acc = await target(accName);
    const D = projects.remoteDirExpr(c.mirror);
    const chk = await remote(acc, `[ -f ${D}/.cshub/base.txt ] && echo SIM; command -v agy >/dev/null && echo AGY`, { timeout: 60000 });
    const t = chk.out.toString();
    if (!/SIM/.test(t)) return { ok: false, error: 'O espelho ainda não foi enviado para esta conta. Rode cshub enviar antes.' };
    if (!command && !/AGY/.test(t)) return { ok: false, error: 'O agy não está disponível nesta VM.' };

    const id = newId();
    const key = keyOf(p, id);
    const T = `${D}/.cshub/tarefas/${id}`;
    const payload = command ? String(body).replace(/\r\n/g, '\n') : preface(id, c.mirror, !edit, att.map((a) => a.name)) + String(body);
    const up = await remote(acc, `mkdir -p ${T} && cat > ${T}/${command ? 'comando' : 'tarefa.md'} && echo @@OK`, { input: Buffer.from(payload), timeout: 60000 });
    if (!/@@OK/.test(up.out.toString())) return { ok: false, error: 'Não consegui gravar a tarefa na VM: ' + up.err.trim().slice(-200) };

    if (att.length) {
      const tmp = await fsp.mkdtemp(path.join(require('os').tmpdir(), 'cshub-anexo-'));
      try {
        for (const a of att) await fsp.copyFile(a.path, path.join(tmp, a.name));
        const stream = tar.c({ cwd: tmp, portable: true }, att.map((a) => a.name));
        const ua = await remote(acc, `mkdir -p ${D}/.saida/${id}/anexos && tar -x -f - -C ${D}/.saida/${id}/anexos && echo @@OK`, { input: stream, timeout: 120000 });
        if (!/@@OK/.test(ua.out.toString())) return { ok: false, error: 'Não consegui enviar os anexos: ' + ua.err.trim().slice(-200) };
      } finally { fs.rm(tmp, { recursive: true, force: true }, () => {}); }
    }

    // flags vindas so de listas fixas ou validadas
    const flags = [live ? '--output-format stream-json' : '--output-format json'];
    flags.push(free ? '--dangerously-skip-permissions' : (plan ? '--mode plan' : '--mode accept-edits'));
    if (model) flags.push(`--model ${model}`);
    if (effort) flags.push(`--effort ${effort}`);
    if (cont) flags.push('--continue');

    const stall = Math.max(3, Math.min(240, Math.floor(Number(stallMin)) || (command ? 30 : 15)));
    const maxm = Math.max(5, Math.min(720, Math.floor(Number(maxMin)) || (command ? 240 : 90)));
    const doRetry = command ? false : (retry === undefined ? (!edit || plan) : !!retry);   // repetir só tarefas que não editam
    let vigia;
    try { vigia = fs.readFileSync(path.join(__dirname, 'vigia.sh'), 'utf8').replace(/\r\n/g, '\n'); }
    catch (e) { return { ok: false, error: 'Não encontrei o script de vigia do app (electron/vigia.sh).' }; }
    const upv = await remote(acc, `cat > ${T}/vigia.sh && printf '%s' ${shq(flags.join(' '))} > ${T}/flags${live ? ` && touch ${T}/ao-vivo` : ''} && echo @@OK`, { input: Buffer.from(vigia), timeout: 60000 });
    if (!/@@OK/.test(upv.out.toString())) return { ok: false, error: 'Não consegui gravar o vigia na VM: ' + upv.err.trim().slice(-200) };

    const launch = [
      `export T=${T}`,
      `cd ${D} || exit 3`,
      `mkdir -p "$HOME/.cshub/rodando" ".saida/${id}"`,
      `date -u +%FT%TZ > "$T/inicio"`,
      `nohup setsid bash "$T/vigia.sh" "$T" ${stall} ${maxm} ${doRetry ? 1 : 0} ${keyOf(p, id)} ${(!command && edit) ? 1 : 0} ${impatient ? 1 : 0} > /dev/null 2>&1 < /dev/null &`,
      `touch "$HOME/.cshub/rodando/${keyOf(p, id)}"`,
      `sleep 1; [ -f "$T/pid" ] && echo @@OK`
    ].join('\n');
    const r = await remote(acc, launch, { timeout: 60000 });
    if (!/@@OK/.test(r.out.toString())) return { ok: false, error: 'O agy não iniciou na VM: ' + (r.err || r.out.toString()).trim().slice(-200) };
    try { require('./monitor').add({ projeto: p.Name, conta: accName, id, modo: command ? 'comando' : (edit && !plan) ? 'edicao' : 'leitura' }); } catch { /* o monitor é opcional */ }
    let avisos = [];
    try {
      const outras = require('./monitor').pending().filter((x) => x.projeto === p.Name && x.conta !== accName && x.modo === 'edicao' && x.id !== id);
      if (outras.length && edit && !command) avisos.push(`Há tarefa de edição rodando em outra conta (${outras.map((x) => x.conta).join(', ')}) sobre o mesmo projeto. O pasta-pc vale para o projeto inteiro: trocar a branch ou os arquivos dessa pasta muda o que o próximo enviar leva para qualquer conta.`);
    } catch { /* o monitor é opcional */ }
    return { ok: true, id, avisos, conta: accName, projeto: p.Name, anexos: att.map((a) => a.name), vigia: { aoVivo: !!live, semSinalMin: stall, maximoMin: maxm, repetirServidor: doRetry }, modo: command ? 'comando' : free ? 'livre' : plan ? 'plano' : edit ? 'edicao' : 'leitura', cota };
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
      `echo; echo "@@CODE=$(cat "$T/codigo")"; echo "@@MOTIVO=$(cat "$T/motivo" 2>/dev/null)"; echo "@@TENT=$(cat "$T/tentativas" 2>/dev/null)"`
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
    if (!m && /Connection closed|Connection reset|Broken pipe|timed out|closed by remote/i.test(r.err || '')) {
      // a conexao caiu: ve se foi a VM que parou/reiniciou (o vigia morre junto) em vez de so devolver erro de rede
      let st = null; try { st = await cs.status(accName); } catch {}
      if (st && st.state && st.state !== 'RUNNING') return { ok: false, dead: true, vmParada: true, error: `A VM de ${accName} parou (${st.state}) e a tarefa foi interrompida. Rode cshub acordar, cshub trazer e dispare de novo o que faltou (cshub tarefa --continuar --ignorar-espelho).` };
    }
    if (!m) return { ok: false, error: 'A conexão caiu enquanto esperava (a tarefa pode continuar rodando). Rode cshub esperar de novo. ' + r.err.trim().slice(-160) };
    const mot = r.out.match(/@@MOTIVO=([\w-]*)/);
    const ten = r.out.match(/@@TENT=(\d+)/);
    const code = Number(m[1]);
    return { ok: true, id, code, success: code === 0, motivo: code === 0 ? null : cleanMotivo(mot && mot[1]), tentativas: ten ? Number(ten[1]) : 1 };
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
    const motivo = cleanMotivo(read('motivo'));
    const tentativas = Number(String(read('tentativas') || '1').trim()) || 1;
    if (state === 'falhou' && (motivo === 'travada' || motivo === 'tempo-maximo')) state = motivo;
    if (state === 'falhou') {
      const qe = quota.quotaError((read('erro.log') || '') + '\n' + (read('saida.json') || ''));
      if (qe) { state = 'cota-esgotada'; esgotada = quota.markExhausted(accName, qe.reset, 'erro de cota na tarefa ' + id); }
    }
    // tempo real (inicio/fim gravados pelo vigia) x o que o agy diz no saida.json (ja veio absurdo, ex.: 60 h numa tarefa de 1 h)
    const iso = (f) => { const v = read(f); const d = v ? Date.parse(v.trim()) : NaN; return Number.isNaN(d) ? null : d; };
    const i0 = iso('inicio'); const f0 = iso('fim');
    const duracaoRealSeg = i0 && f0 ? Math.round((f0 - i0) / 1000) : null;
    let duracaoAgySeg = null; let tokens = null;
    try {
      const walkJ = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 4) return; for (const [k, v] of Object.entries(o)) { if (typeof v === 'number') { if (/duration_?s/i.test(k)) duracaoAgySeg = v; else if (/^(input_?tokens|prompt_?tokens)$/i.test(k)) tokens = Math.max(tokens || 0, v); } else walkJ(v, d + 1); } };
      const raw = read('saida.json') || '';
      try { walkJ(JSON.parse(raw)); } catch { for (const l of raw.split(/\r?\n/).slice(-30)) { try { walkJ(JSON.parse(l)); } catch {} } }
    } catch { /* formato desconhecido: ignora */ }
    const avisos = [];
    if (duracaoRealSeg != null && duracaoAgySeg != null && duracaoAgySeg > duracaoRealSeg * 2 + 120) avisos.push(`O agy registrou ${Math.round(duracaoAgySeg / 60)} min, mas a tarefa durou ${Math.round(duracaoRealSeg / 60)} min de verdade: ignore duration_seconds do saida.json.`);
    if (tokens != null && tokens > 2000000) avisos.push(`A tarefa consumiu ${(tokens / 1e6).toFixed(1).replace('.', ',')} M de tokens de entrada (conta repetida de contexto a cada passo; tarefas longas ou esperas em segundo plano inflam isso).`);
    return {
      ok: true, id, state, motivo, tentativas, esgotada, duracaoRealSeg, duracaoAgySeg, tokensEntrada: tokens, avisos, code: code != null ? Number(code.trim()) : null,
      answer: answerFrom(read('saida.json')),
      errors: (read('erro.log') || '').trim().slice(-2000),
      dest, outputs: `.saida/${id}/`
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- listar e cancelar ----------
async function listOn(acc, c) {
  const D = projects.remoteDirExpr(c.mirror);
  const r = await remote(acc, `for d in ${D}/.cshub/tarefas/T*/; do [ -d "$d" ] || continue; id=$(basename "$d"); ` +
    `if [ -f "$d/codigo" ]; then s="fim:$(cat "$d/codigo")"; elif [ -f "$d/pid" ] && kill -0 "$(cat "$d/pid")" 2>/dev/null; then s=rodando; else s=parou; ` +
    `ini=$(date -d "$(cat "$d/inicio" 2>/dev/null)" +%s 2>/dev/null); boot=$(( $(date +%s) - $(cut -d. -f1 /proc/uptime) )); [ -n "$ini" ] && [ "$boot" -gt "$ini" ] && s=reiniciou; fi; ` +
    `echo "$id|$s|$(cat "$d/inicio" 2>/dev/null)|$(cat "$d/fim" 2>/dev/null)|$(cat "$d/motivo" 2>/dev/null)|$(cat "$d/vivo" 2>/dev/null)"; done; echo @@FIM`, { timeout: 60000 });
  const out = r.out.toString();
  if (!/@@FIM/.test(out)) return { ok: false, error: 'Não consegui listar as tarefas: ' + (r.err || '').trim().slice(-160) };
  const tasks = out.split(/\r?\n/).filter((l) => /^T\d/.test(l)).map((l) => {
    const [id, s, inicio, fim, mot, vivo] = l.trim().split('|');
    const motivo = cleanMotivo(mot);
    let state = s === 'rodando' || s === 'parou' || s === 'reiniciou' ? s : stateOf(Number(String(s).replace('fim:', '')));
    if (state === 'falhou' && (motivo === 'travada' || motivo === 'tempo-maximo')) state = motivo;
    return { id, state, motivo, inicio: inicio || null, fim: fim || null, vivo: vivo || null };
  });
  return { ok: true, tasks };
}

async function list(projName, accName) {
  try {
    const { c } = project(projName);
    const acc = await target(accName);
    return await listOn(acc, c);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---------- acompanhar ao vivo (somente leitura) ----------
// envia o ver.sh para a pasta da tarefa e devolve o comando que o terminal deve rodar
async function prepareLive(projName, accName, id) {
  try {
    const { c } = project(projName);
    const acc = (await cs.list()).find((a) => a.Name === accName);
    if (!acc) return { ok: false, error: 'Conta não encontrada' };
    const st = await cs.status(accName);
    if (st.state !== 'RUNNING' || !acc.Host) return { ok: false, error: 'A VM desta conta está parada, então não há tarefa para acompanhar.' };
    if (!id) {
      const l = await listOn(acc, c);
      if (!l.ok) return l;
      const t = [...l.tasks].reverse().find((x) => x.state === 'rodando') || l.tasks[l.tasks.length - 1];
      if (!t) return { ok: false, error: 'Nenhuma tarefa nesta conta.' };
      id = t.id;
    } else { id = normId(id); checkId(id); }
    const T = taskDir(c, id);
    let ver;
    try { ver = fs.readFileSync(path.join(__dirname, 'ver.sh'), 'utf8').replace(/\r\n/g, '\n'); }
    catch { return { ok: false, error: 'Não encontrei o script de acompanhamento do app (electron/ver.sh).' }; }
    const r = await remote(acc, `[ -d ${T} ] || { echo @@NOTASK; exit 3; }; cat > ${T}/ver.sh && echo @@OK`, { input: Buffer.from(ver), timeout: 60000 });
    const o = r.out.toString();
    if (/@@NOTASK/.test(o)) return { ok: false, error: 'Tarefa não encontrada nesta conta: ' + id };
    if (!/@@OK/.test(o)) return { ok: false, error: 'Não consegui preparar o acompanhamento da tarefa: ' + (r.err || '').trim().slice(-160) };
    return { ok: true, id, projeto: projName, acc, command: `cd ${projects.remoteDirExpr(c.mirror)} && bash ${T}/ver.sh`, label: 'ao vivo ' + id.slice(-7) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
// para o app: acha a tarefa mais recente da conta (pelo monitor local ou varrendo os projetos)
async function liveForAccount(accName) {
  const monitor = require('./monitor');
  const mine = monitor.all().filter((t) => t.conta === accName).sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));
  const tried = new Set();
  for (const t of mine.slice(0, 1)) { tried.add(t.projeto); const r = await prepareLive(t.projeto, accName, t.id); if (r.ok) { delete r.acc; return r; } if (!/Tarefa não encontrada/.test(r.error || '')) return r; }
  for (const p of await projects.list()) {
    if (tried.has(p.Name) || !(p.Mirror && p.Mirror.local)) continue;
    const r = await prepareLive(p.Name, accName);
    if (r.ok) { delete r.acc; return r; }
  }
  return { ok: false, error: 'Não encontrei tarefa recente nesta conta.' };
}

// olha as tarefas SEM acordar a VM (usado pelo monitor do app): se a VM nao estiver ativa, diz o estado dela
async function peek(projName, accName) {
  try {
    const { c } = project(projName);
    const acc = (await cs.list()).find((a) => a.Name === accName);
    if (!acc) return { ok: false, error: 'Conta não encontrada' };
    const st = await cs.status(accName);
    if (st.logged === false) return { ok: true, vm: 'sem-login', tasks: null };
    if (st.state !== 'RUNNING' || !acc.Host) return { ok: true, vm: st.state || 'UNKNOWN', tasks: null };
    const r = await listOn(acc, c);
    return r.ok ? { ok: true, vm: 'RUNNING', tasks: r.tasks } : { ok: true, vm: 'SEM-RESPOSTA', tasks: null, error: r.error };
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
  // as contas são consultadas em paralelo (antes uma de cada vez, o que passava de 2 min com muitas contas)
  return await Promise.all((await cs.list()).map(async (a) => {
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
    return row;
  }));
}

module.exports = { MOTIVOS, blockers, start, wait, result, list, peek, prepareLive, liveForAccount, cancel, accountsOverview, _test: { preface, answerFrom, newId, ID_RE } };
