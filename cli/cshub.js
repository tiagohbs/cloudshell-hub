#!/usr/bin/env node
// cshub: linha de comando do Cloud Shell Hub (para o orquestrador no Maestri ou para o PowerShell).
const path = require('path');
const fs = require('fs');
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
  cshub local [<conta|e-mail>]       marca a conta em uso no PC (a do agy local do orquestrador); ela fica reservada e a anterior e liberada
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
  cshub pasta-pc <projeto> [<pasta>] aponta o espelho para outra pasta do PC (ex.: o worktree da rodada); sem pasta, mostra para onde aponta
  cshub enviar <projeto> <conta> [--tudo] [--com-segredos] [--forcar]
  cshub trazer <projeto> <conta>     traz o que mudou no espelho para a pasta de resultados
  cshub aplicar <ID> <worktree> [--simular] [--forcar]   (ou: aplicar <projeto> <conta> <ID> <worktree>)
        confere que cada arquivo local é igual ao enviado (senão recusa tudo), copia, lista o que mudou e deixa .saida/ de fora
  cshub caminho <projeto> <caminho> [--conta <conta>]   traduz caminho do PC para o espelho (sempre /)

COMANDOS E TESTES NA VM (sem agy, sem gastar cota do Gemini)
  cshub rodar <projeto> <conta> (--comando "<comando>" | --arquivo <script.sh>) [--travado-min 30] [--max-min 240]
        roda no espelho, em segundo plano e com o mesmo vigia (ex.: testes de mutação, QA, scripts .mjs). Acompanhe com esperar/resultado.
        Seu script pode escrever em $CSHUB_SAIDA (vai junto dos resultados) e dar sinal de vida com: touch "$CSHUB_PULSO"

TAREFAS (agy -p rodando na VM, em segundo plano)
  cshub tarefa <projeto> <conta> (--arquivo <tarefa.md> | --texto "<tarefa>")
        [--leitura] [--plano] [--livre] [--modelo <m>] [--esforco low|medium|high|max] [--continuar]
        [--ao-vivo]                      grava o fluxo do agente em tempo real (veja com cshub ao-vivo)
        [--travado-min 15] [--max-min 90] [--repetir | --sem-repetir]   vigia na VM (repete falha de servidor só em tarefas que não editam)
        [--anexo <arquivo>]               (repetível) sobe junto para .saida/<ID>/anexos/ na VM
        [--impaciente]                  encerra a tarefa 3 min depois de ela parar esperando segundo plano sem RESUMO.md (economiza VM)
        [--ignorar-espelho]              dispara mesmo com o espelho diferente do PC (padrão: recusa e pede cshub enviar)
        [--cota-minima <pct>] [--ignorar-cota] [--ignorar-horas] [--usar-reservada]
                                     dispara e devolve o ID (padrao: pode editar arquivos)
  cshub esperar <projeto> <conta> <ID> [--minutos 60] [--trazer]
        [--vigiar-cota <pct> [--parar-cota]]   mede a cota a cada 10 min; avisa (ou para) abaixo do limite
  cshub ao-vivo <projeto> <conta> [<ID>]   acompanha a tarefa em tempo real, SOMENTE LEITURA (sem ID: a mais recente)
  cshub acompanhar <projeto> <conta> [<ID>] [--resumo] [--sem-trazer]
        ao-vivo + esperar + trazer o resultado, num comando só, feito para um painel de terminal do orquestrador.
        Termina com o código de saída da tarefa (0, 6, 7, 8, 9…); --resumo imprime só os marcos principais
        A ÚLTIMA linha é sempre: CSH-FIM {"code":0,"arquivos":"…","resumo":true} (leitura por máquina)
  cshub resultado <projeto> <conta> <ID> [--texto]   resposta do agy + logs; --texto devolve só a resposta final (funciona também com --ao-vivo)
  cshub tarefas <projeto> <conta> [--acordar]   lista as tarefas da conta (sem acordar a VM, a menos que use --acordar)
  cshub saude                              confere se o agy deste PC abre (agy --version)
  cshub cancelar <projeto> <conta> <ID>

Opcao geral: --json (saida em JSON, para scripts e agentes)
Codigos de saida: 0 ok, 1 erro, 4 tempo esgotado (ainda rodando), 5 tarefa morreu, 6 cota (esgotada ou abaixo do limite),
  7 agy travado ou tempo maximo da tarefa, 8 falha do servidor/rede do Gemini, 9 conta sem login,
  10 parou esperando segundo plano sem entregar, 11 terminou sem RESUMO.md, 12 comando inexistente na VM (rodar)
`;

// ---------- falhas das tarefas (classificadas pelo vigia na VM) ----------
const EXIT = { cota: 6, travada: 7, 'tempo-maximo': 7, servidor: 8, rede: 8, login: 9, 'segundo-plano': 10, 'sem-resumo': 11, 'comando-nao-encontrado': 12 };
const ORIENTA = {
  cota: 'A cota do Gemini desta conta acabou. Use outra conta (cshub escolher).',
  travada: 'O agy parou de responder e o vigia encerrou a tarefa. Veja cshub resultado e dispare de novo (talvez em outra conta, ou com uma tarefa menor).',
  'tempo-maximo': 'A tarefa passou do tempo máximo e foi encerrada. Divida em partes menores ou aumente com --max-min. O que já foi feito pode ser trazido com cshub trazer.',
  servidor: 'Falha do servidor do Gemini/Antigravity (instabilidade do Google). Tente de novo em alguns minutos ou use outra conta.',
  rede: 'A VM ficou sem rede alcançável para o Gemini. Tente de novo em alguns minutos ou use outra conta.',
  login: 'A conta perdeu o login no agy/gcloud. Faça o login de novo no app (Editar conta) ou use outra conta.',
  'segundo-plano': 'O agy deixou testes/benchmarks em segundo plano e parou esperando, sem entregar o RESUMO.md. Dispare de novo mandando rodar tudo em primeiro plano, ou rode os testes com cshub rodar. O que ele editou até ali pode ser visto com cshub trazer.',
  'sem-resumo': 'O agy terminou sem escrever o RESUMO.md. Veja cshub resultado e cshub trazer; se o trabalho estiver completo, confira os arquivos antes de aplicar.',
  'comando-nao-encontrado': 'Um comando do script não existe na VM (o rodar já carrega o nvm; confira se node/npx/ferramentas estão instalados nessa VM). Veja cshub resultado para o log.',
  'sem-resposta': 'O agy terminou sem produzir resposta. Veja cshub resultado e dispare de novo.',
  falhou: 'O agy terminou com erro. Veja cshub resultado para o log.'
};

// ---------- argumentos ----------
const WITH_VALUE = new Set(['--comando', '--travado-min', '--max-min', '--conta', '--espelho', '--arquivo', '--texto', '--minutos', '--modelo', '--esforco', '--cota-minima', '--vigiar-cota', '--anexo']);
const argv = process.argv.slice(2);
const opt = {};
const flags = new Set();
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--anexo') { (opt.anexos = opt.anexos || []).push(argv[++i]); continue; }
  if (WITH_VALUE.has(a)) { opt[a.slice(2)] = argv[++i]; continue; }
  if (a.startsWith('--')) { flags.add(a); continue; }
  pos.push(a);
}
let [cmd, a1, a2, a3] = pos;
const json = flags.has('--json');

const print = (obj, text) => process.stdout.write((json ? JSON.stringify(obj) : text) + '\n');
const errors = require('../electron/errors');
// sair sem process.exit com conexões ainda fechando (no Windows isso derruba o Node: Assertion failed UV_HANDLE_CLOSING)
class Quit extends Error {}
const quit = (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 3000).unref(); throw new Quit(); };
let fimOn = false;   // acompanhar/esperar: a ultima linha precisa ser CSH-FIM, mesmo em erro
const fimLine = (o) => { if (!json) process.stdout.write('CSH-FIM ' + JSON.stringify(o) + '\n'); };
const fail = (msg, obj = {}, code = 1) => {
  const cod = errors.codeFor(msg);
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: msg, code: cod, ...obj }) + '\n');
  else process.stderr.write('Erro: ' + msg + ' (código ' + cod + ')\n');
  if (fimOn) fimLine({ ok: false, code, codigoErro: cod, resumo: false });
  quit(code);
};
const log = json ? () => {} : (m) => process.stdout.write(m + '\n');   // progresso no stdout: no PowerShell o stderr vira bloco vermelho de erro
const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
const need = (...v) => { if (v.some((x) => !x)) fail('faltam argumentos. Veja: cshub ajuda'); };
const slash = (p) => String(p || '').replace(/\\/g, '/');

// o agy local se auto-atualiza e já ficou quebrado (0xC0000005 até no --version): confere antes de depender dele
function localAgyHealth() {
  const r = require('child_process').spawnSync('agy', ['--version'], { shell: true, timeout: 20000, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) {
    const st = r.status;
    const hex = typeof st === 'number' && st > 255 ? ' (0x' + (st >>> 0).toString(16).toUpperCase() + ')' : '';
    return { ok: false, codigo: st, erro: r.error ? String(r.error.message || r.error) : `agy --version saiu com código ${st}${hex}. Versões antigas ficam em %LOCALAPPDATA%\\agy\\bin\\agy.exe.<n>.old; reinstale ou restaure uma delas.` };
  }
  return { ok: true, versao: String(r.stdout || '').trim().split(/\r?\n/)[0] };
}

(async () => {
  // acompanhar = ver ao vivo (somente leitura) + esperar + trazer o resultado, num comando só
  // pensado para um painel de terminal do orquestrador: o agente só lê as últimas linhas e o código de saída
  if (cmd === 'acompanhar') {
    fimOn = true;
    need(a1, a2);
    const r = await tasks.prepareLive(a1, a2, a3);
    if (!r.ok) fail(r.error, r);
    if (!json) {
      const cs2 = require('../electron/cs');
      log(`Acompanhando ${r.id} (somente leitura; Ctrl+C sai e a tarefa continua)…`);
      await new Promise((res) => {
        const ch = require('child_process').spawn('ssh', ['-t', ...cs2.sshBase(r.acc), r.command + (flags.has('--resumo') ? ' resumo' : '')], { stdio: 'inherit' });
        ch.on('close', res); ch.on('error', res);
      });
    }
    cmd = 'esperar'; a3 = r.id;
    if (!opt.minutos) opt.minutos = json ? '60' : '2';   // depois do fluxo a tarefa já terminou; só pega o código e o resultado
    if (!flags.has('--sem-trazer')) flags.add('--trazer');
  }
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
      if (out.some((q) => !q.ok)) quit(1);
      break;
    }
    case 'saude': {
      const r = localAgyHealth();
      print(r, r.ok ? `agy local ok (${r.versao})` : `agy local COM PROBLEMA: ${r.erro}`);
      if (!r.ok) quit(1);
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
      need(a1);
      if (!a2) {
        const p0 = (await projects.list()).find((x) => x.Name === a1);
        if (!p0) fail('Projeto não encontrado: ' + a1);
        print({ ok: true, projeto: a1, pc: p0.Mirror.local || null, espelho: p0.Mirror.mirror, resultados: slash(p0.Mirror.results) },
          `${a1}\n  PC:         ${p0.Mirror.local || '(não definida)'}\n  espelho:    ${p0.Mirror.mirror}\n  resultados: ${p0.Mirror.results}\n(para mudar: cshub pasta-pc ${a1} <pasta>)`);
        break;
      }
      const r = await projects.update(a1, { mirror: { LocalDir: a2 } });
      if (!r.ok) fail(r.error, r);
      const p = (await projects.list()).find((x) => x.Name === a1);
      print({ ok: true, projeto: a1, pc: p.Mirror.local, resultados: slash(p.Mirror.results) },
        `${a1}: espelho agora sai de ${p.Mirror.local}\n(o próximo cshub enviar reenvia o que for diferente e apaga na nuvem o que não existe nessa pasta)`);
      break;
    }
    case 'enviar': {
      need(a1, a2);
      try {
        const outras = require('../electron/monitor').pending().filter((x) => x.projeto === a1 && x.conta !== a2 && x.modo === 'edicao');
        if (outras.length) log(`aviso: há tarefa de edição rodando em ${[...new Set(outras.map((x) => x.conta))].join(', ')} sobre este projeto. O pasta-pc vale para o projeto todo: o que você enviar agora sai da pasta atual do PC.`);
      } catch { /* sem monitor */ }
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
    case 'aplicar': {
      need(a1, a2);
      let proj, conta, id, wt;
      const monitor = require('../electron/monitor');
      const idish = (x) => /^t?\d{8}-\d{6}-[a-z0-9]{3}$/i.test(String(x || '').replace(/^[<"']+|[>"']+$/g, ''));
      if (idish(a1)) {
        // aplicar <ID> <worktree>: projeto e conta vêm do registro das tarefas disparadas neste PC
        const nid = String(a1).replace(/^[<"']+|[>"']+$/g, '').replace(/^t/i, 'T');
        const t = monitor.all().find((x) => x.id === nid);
        if (!t) fail('não sei a qual projeto/conta pertence a tarefa ' + a1 + '. Use: cshub aplicar <projeto> <conta> <ID> <worktree>');
        proj = t.projeto; conta = t.conta; id = nid; wt = a2;
      } else { need(a3, pos[4]); proj = a1; conta = a2; id = a3; wt = pos[4]; }
      const r = await mirror.apply(proj, conta, id, wt, { dry: flags.has('--simular'), force: flags.has('--forcar'), log });
      if (!r.ok) fail(r.error, r);
      if (r.none) { print(r, 'Nada mudou no espelho desde o último envio: nada a aplicar.'); break; }
      const lst = (t, a) => a.length ? `\n${t} (${a.length}):\n` + a.map((f) => '  ' + f).join('\n') : '';
      print({ ...r, dest: slash(r.dest), destino: slash(r.destino) },
        `${r.dry ? '[simulação] ' : ''}Destino: ${slash(r.destino)}` + lst(r.dry ? 'Seriam alterados' : 'Alterados', r.aplicados) + lst(r.dry ? 'Seriam criados' : 'Criados', r.novos) +
        lst('Apagados na nuvem (NÃO apagados aqui, confira)', r.apagadosNaNuvem) +
        (r.conflitosForcados.length ? `\naviso: ${r.conflitosForcados.length} conflito(s) ignorados por --forcar` : '') +
        `\nEvidências (.saida) ficaram fora do destino, em ${slash(r.dest)}`);
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
        anexos: opt.anexos, ignoreStale: flags.has('--ignorar-espelho'), impatient: flags.has('--impaciente'), live: flags.has('--ao-vivo'), stallMin: opt['travado-min'], maxMin: opt['max-min'], retry: flags.has('--repetir') ? true : flags.has('--sem-repetir') ? false : undefined,
        minQuota: Number(opt['cota-minima']) || 0, ignoreQuota: flags.has('--ignorar-cota'), useReserved: flags.has('--usar-reservada'), ignoreHours: flags.has('--ignorar-horas')
      });
      if (!r.ok) fail(r.error, r, r.quota ? 6 : 1);
      if (r.avisos && r.avisos.length && !json) r.avisos.forEach((x) => log('aviso: ' + x));
      print(r, `${r.id}\n(tarefa disparada em ${a2}, modo ${r.modo}${r.anexos && r.anexos.length ? `, ${r.anexos.length} anexo(s)` : ''}. Vigia na VM: para a tarefa após ${r.vigia.semSinalMin} min sem sinal ou ${r.vigia.maximoMin} min no total${r.vigia.repetirServidor ? '; repete até 2x falha de servidor' : ''}.\nAcompanhe com: cshub esperar ${a1} ${a2} ${r.id} --minutos 20)`);
      break;
    }
    case 'ao-vivo': {
      need(a1, a2);
      const r = await tasks.prepareLive(a1, a2, a3);
      if (!r.ok) fail(r.error, r);
      const cs2 = require('../electron/cs');
      log(`Acompanhando ${r.id} (somente leitura; Ctrl+C sai e a tarefa continua)…`);
      await new Promise((res) => {
        const ch = require('child_process').spawn('ssh', ['-t', ...cs2.sshBase(r.acc), r.command], { stdio: 'inherit' });
        ch.on('close', res); ch.on('error', res);
      });
      break;
    }
    case 'rodar': {
      need(a1, a2);
      if (!opt.arquivo && !opt.comando) fail('informe --comando "<comando>" ou --arquivo <script.sh>');
      log('Disparando o comando na VM…');
      const r = await tasks.start(a1, a2, {
        file: opt.arquivo, text: opt.comando, command: true,
        stallMin: opt['travado-min'], maxMin: opt['max-min'], ignoreStale: flags.has('--ignorar-espelho'),
        ignoreQuota: true, useReserved: flags.has('--usar-reservada'), ignoreHours: flags.has('--ignorar-horas')
      });
      if (!r.ok) fail(r.error, r, 1);
      print(r, `${r.id}\n(comando disparado em ${a2}, sem gastar cota do Gemini. Vigia: encerra após ${r.vigia.semSinalMin} min sem sinal ou ${r.vigia.maximoMin} min no total.\nAcompanhe com: cshub esperar ${a1} ${a2} ${r.id} --minutos 20)`);
      break;
    }
    case 'esperar': {
      fimOn = true;
      need(a1, a2, a3);
      log(`Esperando ${a3}…`);
      const total = Number(opt.minutos) || 60;
      const vigiar = Number(opt['vigiar-cota']) || 0;
      const tick = json ? () => {} : () => process.stdout.write('.');
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
      if (!json) process.stdout.write('\n');
      if (!r.ok) fail(r.error, r, r.timeout ? 4 : r.dead ? 5 : 1);
      if (!r.success) {
        const res = await tasks.result(a1, a2, a3);
        if (res.ok && res.state === 'cota-esgotada') {
          fail(`A cota do agy esgotou durante a tarefa. Conta marcada até ${new Date(res.esgotada.ate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Rode cshub trazer para salvar o que já foi feito e use outra conta.`, { estado: res.state, esgotada: res.esgotada, aviso }, 6);
        }
      }
      let extra = {};
      if (flags.has('--trazer')) {
        const res = await tasks.result(a1, a2, a3);
        const tr = await mirror.fetchResults(a1, a2, { log });
        extra = { resposta: res.ok ? res.answer : null, logs: res.ok ? slash(res.dest) : null, arquivos: tr.ok && !tr.none ? slash(tr.dest) : null, resumo: !!(tr.ok && !tr.none && fs.existsSync(path.join(tr.dest, 'arquivos', '.saida', r.id, 'RESUMO.md'))) };
        if (res.ok && res.avisos && res.avisos.length) extra.avisos = res.avisos;
      }
      if (aviso) extra.aviso = aviso;
      const orient = r.success ? '' : (ORIENTA[r.motivo] || ORIENTA.falhou);
      const codErro = r.success ? null : errors.MOTIVO_CODE[r.motivo || 'falhou'];
      print({ ...r, ...extra, orientacao: orient || undefined, codigoErro: codErro || undefined }, `${a3}: ${r.success ? 'concluída' : `falhou${r.motivo ? ` (${r.motivo})` : ''}, código ${r.code}`}` +
        (orient ? `\n${orient} (código ${codErro})` : '') + (!r.success && r.tentativas > 1 ? `\n(o vigia já tentou ${r.tentativas}x)` : '') +
        (extra.resposta ? `\n\n${extra.resposta}\n` : '') +
        (extra.logs ? `\nlogs: ${extra.logs}` : '') + (extra.arquivos ? `\narquivos: ${extra.arquivos}` : ''));
      const exitCode = r.success ? 0 : (EXIT[r.motivo] || 1);
      fimLine({ ok: r.success, code: exitCode, ...(r.success ? {} : { motivo: r.motivo || 'falhou', codigoErro: codErro }), arquivos: extra.arquivos || null, resumo: extra.resumo === undefined ? null : extra.resumo });
      if (!r.success) quit(exitCode);
      break;
    }
    case 'resultado': {
      need(a1, a2, a3);
      const r = await tasks.result(a1, a2, a3);
      if (!r.ok) fail(r.error, r);
      if (flags.has('--texto')) {
        if (!r.answer) fail('a tarefa ainda não tem resposta final. Veja cshub resultado sem --texto.', r);
        print({ ok: true, id: r.id, texto: r.answer }, r.answer);
        break;
      }
      print({ ...r, dest: slash(r.dest) }, `${r.id}: ${r.state}${r.motivo ? ` [${r.motivo}]` : ''}${r.code != null ? ` (código ${r.code})` : ''}${r.tentativas > 1 ? ` · ${r.tentativas} tentativas` : ''}\n\n${r.answer || '(sem resposta ainda)'}\n` +
        (r.errors && r.state !== 'concluida' ? `\n--- erros ---\n${r.errors}\n` : '') +
        (r.avisos && r.avisos.length ? '\n' + r.avisos.map((x) => 'aviso: ' + x).join('\n') + '\n' : '') +
        (r.duracaoRealSeg != null ? `\nduração real: ${Math.round(r.duracaoRealSeg / 60)} min` : '') +
        `\nlogs salvos em ${slash(r.dest)}\narquivos de saida na VM: ${r.outputs} (use cshub trazer)`);
      break;
    }
    case 'tarefas': {
      need(a1, a2);
      let r;
      if (flags.has('--acordar')) r = await tasks.list(a1, a2);
      else {
        // padrão: só olha, sem acordar a VM (acordar gasta horas da semana e leva até 90 s)
        const pk = await tasks.peek(a1, a2);
        if (!pk.ok) fail(pk.error, pk);
        if (!pk.tasks) { print({ ok: true, vm: pk.vm, tasks: null, aviso: 'VM não está ativa' }, `A VM de ${a2} não está ativa (${pk.vm}), então não dá para listar as tarefas sem acordá-la. Use --acordar para listar mesmo assim.`); break; }
        r = { ok: true, tasks: pk.tasks };
      }
      if (!r.ok) fail(r.error, r);
      print(r, r.tasks.length ? r.tasks.map((t) => `${t.id}  ${t.state.padEnd(12)} ${t.inicio || ''}${t.fim ? ' → ' + t.fim : ''}${t.motivo ? '  [' + t.motivo + ']' : ''}`).join('\n') : 'Nenhuma tarefa nesta conta.');
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
      if (cmd && cmd !== 'ajuda' && cmd !== 'help') quit(1);
  }
})().catch((e) => {
  if (e instanceof Quit) return;
  try { fail(String(e && e.message || e)); } catch (q) { if (!(q instanceof Quit)) throw q; }
});
