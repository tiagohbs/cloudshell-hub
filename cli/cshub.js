#!/usr/bin/env node
// cshub: linha de comando do Cloud Shell Hub (para o orquestrador no Maestri ou para o PowerShell).
const path = require('path');
const { spawn } = require('child_process');
const app = path.join(__dirname, '..', 'electron');
const cs = require(path.join(app, 'cs'));
const projects = require(path.join(app, 'projects'));
const mirror = require(path.join(app, 'mirror'));
const tasks = require(path.join(app, 'tasks'));
const quota = require(path.join(app, 'quota'));

const HELP = `cshub — Cloud Shell Hub pela linha de comando

CONTAS
  cshub contas                       contas: [LIVRE] ou [BLOQUEADA: motivo] (em-uso-no-pc, reserva-manual, sem-cota-gemini, sem-horas-vm, sem-login), VM, horas 7d
  cshub acordar <conta>              liga a VM (se suspensa) e confirma o acesso
  cshub local [<conta|e-mail>]       marca a conta em uso no PC (Arauto/Vidente); ela fica reservada e a anterior e liberada
        [--nenhuma]                  nenhuma conta em uso no PC
  cshub reservar <conta> "<motivo>"  impede tarefas nesta conta (ex.: cota compartilhada com outro agente)
  cshub liberar <conta>              remove a reserva
  cshub cota [<conta>] [--acordar]     cota do Gemini/agy (semanal e 5 h) lida do /usage; sem conta = todas as ativas
  cshub skill [instalar]             estado da skill no PC (instalada, atualizada?) e instala/atualiza
  cshub escolher                     contas LIVRES (não bloqueadas), da melhor para a pior; saída 5 se nenhuma
  cshub ssh <conta> [--espelho <projeto>] [--agy]
                                     abre um terminal da VM aqui mesmo (para um painel do Maestri)

ESPELHO DO PC (sem Git)
  cshub projetos                     projetos e pastas (PC, espelho, resultados)
  cshub pasta-pc <projeto> <pasta>   aponta o espelho para outra pasta do PC (ex.: o worktree da rodada)
  cshub enviar <projeto> <conta> [--tudo] [--com-segredos] [--forcar]
  cshub trazer <projeto> <conta>     traz o que mudou no espelho para a pasta de resultados
  cshub caminho <projeto> <caminho> [--conta <conta>]   traduz caminho do PC para o espelho (sempre /)

TAREFAS (agy -p rodando na VM, em segundo plano)
  cshub tarefa <projeto> <conta> (--arquivo <tarefa.md> | --texto "<tarefa>")
        [--leitura] [--plano] [--livre] [--modelo <m>] [--esforco low|medium|high|max] [--continuar]
        [--cota-minima <pct>] [--ignorar-cota] [--ignorar-horas] [--usar-reservada]
                                     dispara e devolve o ID (padrao: pode editar arquivos)
  cshub esperar <projeto> <conta> <ID> [--minutos 60] [--trazer]
        [--vigiar-cota <pct> [--parar-cota]]   mede a cota a cada 10 min; avisa (ou para) abaixo do limite
  cshub resultado <projeto> <conta> <ID>    resposta do agy + logs (salvos na pasta de resultados)
  cshub tarefas <projeto> <conta>          lista as tarefas da conta
  cshub cancelar <projeto> <conta> <ID>

Opcao geral: --json (saida em JSON, para scripts e agentes)
Codigos de saida: 0 ok, 1 erro, 4 tempo esgotado (ainda rodando), 5 tarefa morreu, 6 cota (esgotada ou abaixo do limite)
`;

// ---------- argumentos ----------
const WITH_VALUE = new Set(['--conta', '--espelho', '--arquivo', '--texto', '--minutos', '--modelo', '--esforco', '--cota-minima', '--vigiar-cota']);
const argv = process.argv.slice(2);
const opt = {};
const flags = new Set();
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (WITH_VALUE.has(a)) { opt[a.slice(2)] = argv[++i]; continue; }
  if (a.startsWith('--')) { flags.add(a); continue; }
  pos.push(a);
}
const [cmd, a1, a2, a3] = pos;
const json = flags.has('--json');

const print = (obj, text) => process.stdout.write((json ? JSON.stringify(obj) : text) + '\n');
const errors = require('../electron/errors');
const fail = (msg, obj = {}, code = 1) => {
  const cod = errors.codeFor(msg);
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: msg, code: cod, ...obj }) + '\n');
  else process.stderr.write('Erro: ' + msg + ' (código ' + cod + ')\n');
  process.exit(code);
};
const log = json ? () => {} : (m) => process.stderr.write(m + '\n');
const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
const need = (...v) => { if (v.some((x) => !x)) fail('faltam argumentos. Veja: cshub ajuda'); };
const slash = (p) => String(p || '').replace(/\\/g, '/');

(async () => {
  switch (cmd) {
    case 'contas': {
      const l = await tasks.accountsOverview();
      const label = { RUNNING: 'ativa', SUSPENDED: 'suspensa', STARTING: 'iniciando', 'sem-login': 'sem login no gcloud' };
      const cotaTxt = (c) => !c ? '  cota: não medida' : c.esgotadaAte ? `  COTA ESGOTADA até ${new Date(c.esgotadaAte).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : c.gemini ? `  Gemini: semana ${c.gemini.semanal}% · 5 h ${c.gemini.cincoHoras}% (medida há ${c.medidaHaMin} min)` : '';
      print(l, l.length ? l.map((r) => `${r.elegivel ? '[LIVRE] ' : '[BLOQUEADA: ' + r.bloqueio.map((x) => x.tipo).join(', ') + '] '}${r.conta.padEnd(28)} ${(label[r.estado] || r.estado).padEnd(12)} ${r.horas7d != null ? String(r.horas7d).replace('.', ',') + ' h/7d' : ''}${r.rodando ? `  ${r.rodando} tarefa(s) rodando` : ''}${cotaTxt(r.cota)}`).join('\n') : 'Nenhuma conta cadastrada.');
      break;
    }
    case 'skill': {
      const sk = require('../electron/skill');
      if (a1 === 'instalar') {
        const r = await sk.install();
        if (!r.ok) fail(r.error);
        print(r, 'Skill instalada em ' + r.caminho + (r.backup ? '\nCópia da anterior: ' + r.backup : '') + '\nReinicie a sessão do Claude no Maestri para ela ser relida.');
      } else {
        const r = await sk.status();
        const t = { atualizada: 'instalada e atualizada', desatualizada: 'instalada, mas DESATUALIZADA (rode: cshub skill instalar)', ausente: 'NÃO instalada (rode: cshub skill instalar)', 'sem-origem': 'arquivo original não encontrado na pasta do app' }[r.estado];
        print(r, 'Skill cloudshell-hub: ' + t + '\nLocal: ' + r.caminho + '\nComando cshub no PATH: ' + (r.cshubNoPath ? 'sim (' + r.cshubCaminho + ')' : 'não (adicione a pasta do app ao PATH)'));
      }
      break;
    }
    case 'escolher': {
      const l = (await tasks.accountsOverview()).filter((r) => r.elegivel);
      const pts = (r) => (r.estado === 'RUNNING' ? 1000 : 0) + (r.cota && r.cota.gemini ? r.cota.gemini.minimo : 0) - (r.horas7d || 0) - (r.rodando || 0) * 20;
      l.sort((a, b) => pts(b) - pts(a));
      if (!l.length) fail('nenhuma conta livre: todas estão em uso no PC ou sem cota/horas. Veja cshub contas.', {}, 5);
      print(l.map((r) => r.conta), l.map((r) => r.conta + (r.cota && r.cota.gemini ? '  (cota ' + r.cota.gemini.minimo + '%)' : '  (cota não medida)')).join('\n'));
      break;
    }
    case 'cota': {
      const fmt = (q) => q.grupos.map((g) => {
        const w = (x, n) => x ? `${n} ${x.restante}%${x.renovaEmMin != null ? ` (renova em ${x.renovaEmMin >= 120 ? Math.round(x.renovaEmMin / 60) + ' h' : x.renovaEmMin + ' min'})` : ''}` : '';
        return `  ${g.nome.padEnd(16)} ${w(g.semanal, 'semana')}  ·  ${w(g.cincoHoras, '5 h')}`;
      }).join('\n');
      let names = a1 ? [a1] : [];
      if (!a1) {
        for (const a of await cs.list()) {
          const st = await cs.status(a.Name);
          if (st.state === 'RUNNING' || flags.has('--acordar')) names.push(a.Name);
          else log(`${a.Name}: VM ${st.state === 'SUSPENDED' ? 'suspensa' : st.state || 'indisponível'}, pulada (use --acordar para medir mesmo assim)`);
        }
      }
      const out = [];
      for (const n of names) {
        log(`Lendo /usage em ${n}…`);
        const q = await quota.check(n);
        out.push(q.ok ? q : { conta: n, ok: false, error: q.error });
        if (!json) process.stdout.write(q.ok ? `${n}${q.esgotada ? '  (marcada como esgotada até ' + new Date(q.esgotada.ate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + ')' : ''}\n${fmt(q)}\n` : `${n}: ${q.error}\n`);
      }
      if (json) print(a1 ? out[0] : out, '');
      if (out.some((q) => !q.ok)) process.exit(1);
      break;
    }
    case 'local': {
      if (!a1 && !flags.has('--nenhuma')) {
        const cur = cs.getLocal();
        print(cur || { conta: null }, cur && cur.email ? `Em uso no PC: ${cur.conta || '(conta não cadastrada no cshub)'} <${cur.email}> desde ${new Date(cur.desde).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Nenhuma conta marcada como em uso no PC.');
        break;
      }
      const r = cs.setLocal(flags.has('--nenhuma') ? '' : a1);
      if (!r.ok) fail(r.error, r);
      print(r, (r.antes && r.antes !== r.agora ? `${r.antes}: liberada.\n` : '') +
        (r.agora ? `${r.agora}: reservada (em uso no PC).` : r.email ? `Em uso no PC: <${r.email}>, que não está cadastrada no cshub (nada a reservar).` : 'Nenhuma conta em uso no PC.'));
      break;
    }
    case 'reservar':
    case 'liberar': {
      need(a1);
      if (cmd === 'reservar' && !a2) fail('informe o motivo: cshub reservar <conta> "<motivo>"');
      const r = await cs.update(a1, { Reserved: cmd === 'reservar' ? a2 : '' });
      if (!r.ok) fail(r.error, r);
      print({ ok: true, conta: a1, reservada: cmd === 'reservar' ? a2 : null }, cmd === 'reservar' ? `${a1} reservada: ${a2}` : `${a1} liberada.`);
      break;
    }
    case 'acordar': {
      need(a1);
      log('Acordando a VM (pode levar até 90 s)…');
      const r = await cs.prepare(a1);
      if (!r.ok) fail(r.error);
      print({ ok: true, conta: r.acc.Name, endereco: `${r.acc.Host}:${r.acc.Port}` }, `${r.acc.Name}: VM ativa em ${r.acc.Host}:${r.acc.Port}`);
      break;
    }
    case 'ssh': {
      need(a1);
      const r = await cs.prepare(a1);
      if (!r.ok) fail(r.error);
      let remoteCmd = null;
      if (opt.espelho) {
        const pc = mirror.paneCommand(opt.espelho, flags.has('--agy') ? 'agy' : 'shell');
        if (!pc.ok) fail(pc.error);
        remoteCmd = pc.command;
      } else if (flags.has('--agy')) remoteCmd = 'exec agy';
      const child = spawn('ssh', ['-t', ...cs.sshBase(r.acc), ...(remoteCmd ? [remoteCmd] : [])], { stdio: 'inherit' });
      child.on('close', (code) => process.exit(code || 0));
      return;
    }
    case 'projetos': {
      const l = await projects.list();
      print(l.map((p) => ({ projeto: p.Name, repo: p.Repo, pc: p.Mirror.local || null, espelho: p.Mirror.mirror, resultados: slash(p.Mirror.results) })),
        l.length ? l.map((p) => `${p.Name}\n  PC:         ${p.Mirror.local || '(não definida)'}\n  espelho:    ${p.Mirror.mirror}\n  resultados: ${p.Mirror.results}`).join('\n') : 'Nenhum projeto cadastrado.');
      break;
    }
    case 'pasta-pc': {
      need(a1, a2);
      const r = await projects.update(a1, { mirror: { LocalDir: a2 } });
      if (!r.ok) fail(r.error, r);
      const p = (await projects.list()).find((x) => x.Name === a1);
      print({ ok: true, projeto: a1, pc: p.Mirror.local, resultados: slash(p.Mirror.results) },
        `${a1}: espelho agora sai de ${p.Mirror.local}\n(o próximo cshub enviar reenvia o que for diferente e apaga na nuvem o que não existe nessa pasta)`);
      break;
    }
    case 'enviar': {
      need(a1, a2);
      const r = await mirror.send(a1, a2, { full: flags.has('--tudo'), withSecrets: flags.has('--com-segredos'), force: flags.has('--forcar'), log });
      if (!r.ok) fail(r.error, r);
      print(r, `Enviado para ${a2}:${r.mirror} — ${r.sent} arquivo(s), ${mb(r.bytes)}${r.removed ? `, ${r.removed} removido(s)` : ''}${r.full ? ' (envio completo)' : ''}${r.withSecrets ? ' — COM segredos' : ''}.`);
      break;
    }
    case 'trazer': {
      need(a1, a2);
      const r = await mirror.fetchResults(a1, a2, { log });
      if (!r.ok) fail(r.error, r);
      if (r.none) print(r, 'Nada mudou no espelho desde o último envio.');
      else print({ ...r, dest: slash(r.dest) }, `Trazido para ${slash(r.dest)}\n  ${r.added} novo(s), ${r.modified} alterado(s), ${r.deleted} apagado(s) na nuvem — veja mudancas.txt`);
      break;
    }
    case 'caminho': {
      need(a1, a2);
      const r = await mirror.translate(a1, a2, opt.conta);
      if (!r.ok) fail(r.error, r);
      if (json) print(r, '');
      else {
        process.stdout.write(r.path + '\n');
        if (r.secret) process.stderr.write('atenção: segredo, não é enviado por padrao\n');
        else if (r.excluded) process.stderr.write('atencao: pasta excluida do envio\n');
      }
      break;
    }
    case 'tarefa': {
      need(a1, a2);
      if (!opt.arquivo && !opt.texto) fail('informe --arquivo <tarefa.md> ou --texto "<tarefa>"');
      log('Disparando o agy na VM…');
      const r = await tasks.start(a1, a2, {
        file: opt.arquivo, text: opt.texto, edit: !flags.has('--leitura'), plan: flags.has('--plano'), free: flags.has('--livre'),
        model: opt.modelo, effort: opt.esforco, cont: flags.has('--continuar'),
        minQuota: Number(opt['cota-minima']) || 0, ignoreQuota: flags.has('--ignorar-cota'), useReserved: flags.has('--usar-reservada'), ignoreHours: flags.has('--ignorar-horas')
      });
      if (!r.ok) fail(r.error, r, r.quota ? 6 : 1);
      print(r, `${r.id}\n(tarefa disparada em ${a2}, modo ${r.modo}. Acompanhe com: cshub esperar ${a1} ${a2} ${r.id})`);
      break;
    }
    case 'esperar': {
      need(a1, a2, a3);
      log(`Esperando ${a3}…`);
      const total = Number(opt.minutos) || 60;
      const vigiar = Number(opt['vigiar-cota']) || 0;
      const tick = json ? () => {} : () => process.stderr.write('.');
      let r;
      let elapsed = 0;
      let aviso = null;
      for (;;) {
        const step = vigiar ? Math.min(Number(process.env.CSHUB_VIGIA_MIN) || 10, total - elapsed) : total;
        r = await tasks.wait(a1, a2, a3, { minutes: step, onTick: tick });
        if (!(r.timeout && vigiar)) break;
        elapsed += step;
        if (elapsed >= total) break;
        const q = await quota.check(a2);
        const rem = q.ok ? quota.remaining(q, opt.modelo) : null;
        if (rem) {
          log(`\n[cota ${rem.grupo}: semana ${rem.semanal}% · 5 h ${rem.cincoHoras}%]`);
          if (rem.minimo < vigiar) {
            aviso = { cota: rem, mensagem: `Cota abaixo de ${vigiar}% (${rem.minimo}%) durante a tarefa` };
            if (flags.has('--parar-cota')) {
              await tasks.cancel(a1, a2, a3);
              fail(`${aviso.mensagem}: tarefa cancelada para não esgotar a conta. Rode cshub trazer para salvar o que já foi feito.`, { aviso }, 6);
            }
            log('Aviso: ' + aviso.mensagem + ' (continuando; use --parar-cota para interromper)');
          }
        }
      }
      if (!json) process.stderr.write('\n');
      if (!r.ok) fail(r.error, r, r.timeout ? 4 : r.dead ? 5 : 1);
      if (!r.success) {
        const res = await tasks.result(a1, a2, a3);
        if (res.ok && res.state === 'cota-esgotada') {
          fail(`A cota do agy esgotou durante a tarefa. Conta marcada ate ${new Date(res.esgotada.ate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Rode cshub trazer para salvar o que já foi feito e use outra conta.`, { estado: res.state, esgotada: res.esgotada, aviso }, 6);
        }
      }
      let extra = {};
      if (flags.has('--trazer')) {
        const res = await tasks.result(a1, a2, a3);
        const tr = await mirror.fetchResults(a1, a2, { log });
        extra = { resposta: res.ok ? res.answer : null, logs: res.ok ? slash(res.dest) : null, arquivos: tr.ok && !tr.none ? slash(tr.dest) : null };
      }
      if (aviso) extra.aviso = aviso;
      print({ ...r, ...extra }, `${a3}: ${r.success ? 'concluída' : `terminou com código ${r.code}`}` +
        (extra.resposta ? `\n\n${extra.resposta}\n` : '') +
        (extra.logs ? `\nlogs: ${extra.logs}` : '') + (extra.arquivos ? `\narquivos: ${extra.arquivos}` : ''));
      if (!r.success) process.exit(1);
      break;
    }
    case 'resultado': {
      need(a1, a2, a3);
      const r = await tasks.result(a1, a2, a3);
      if (!r.ok) fail(r.error, r);
      print({ ...r, dest: slash(r.dest) }, `${r.id}: ${r.state}${r.code != null ? ` (código ${r.code})` : ''}\n\n${r.answer || '(sem resposta ainda)'}\n` +
        (r.errors && r.state !== 'concluida' ? `\n--- erros ---\n${r.errors}\n` : '') +
        `\nlogs salvos em ${slash(r.dest)}\narquivos de saida na VM: ${r.outputs} (use cshub trazer)`);
      break;
    }
    case 'tarefas': {
      need(a1, a2);
      const r = await tasks.list(a1, a2);
      if (!r.ok) fail(r.error, r);
      print(r, r.tasks.length ? r.tasks.map((t) => `${t.id}  ${t.state.padEnd(10)} ${t.inicio || ''}${t.fim ? ' → ' + t.fim : ''}`).join('\n') : 'Nenhuma tarefa nesta conta.');
      break;
    }
    case 'cancelar': {
      need(a1, a2, a3);
      const r = await tasks.cancel(a1, a2, a3);
      if (!r.ok) fail(r.error, r);
      print(r, r.already ? `${a3} já tinha terminado.` : `${a3} cancelada.`);
      break;
    }
    default:
      process.stdout.write(HELP);
      if (cmd && cmd !== 'ajuda' && cmd !== 'help') process.exit(1);
  }
})().catch((e) => fail(String(e && e.message || e)));
