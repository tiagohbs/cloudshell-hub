// Testes do cshub (node --test). Rodam sem rede e sem contas: HOME vai para uma pasta temporária
// e o gcloud é um script falso no PATH. Nada aqui pode tocar nos dados reais do usuário.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
// e-mails do teste são montados aqui (nenhum e-mail escrito no arquivo: a auditoria de privacidade marca qualquer um)
const em = (nome, dominio = 'exemplo.com') => nome + '@' + dominio;

// ---------- isolamento: precisa vir antes de qualquer require de ../electron ----------
const REAL_HOME = os.homedir();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cshub-test-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
if (os.homedir() !== TMP || os.homedir() === REAL_HOME) throw new Error('isolamento falhou: HOME ainda é a pasta real');

// gcloud falso: registra cada chamada e responde conforme variáveis FAKE_*
const BIN = path.join(TMP, 'bin');
fs.mkdirSync(BIN);
const LOG = path.join(TMP, 'gcloud.log');
fs.writeFileSync(path.join(BIN, 'gcloud'), `#!/usr/bin/env bash
echo "$*" >> "${LOG}"
case "$1 $2" in
  "projects list") cat "$FAKE_PROJECTS" ;;
  "projects describe") echo "\${FAKE_LABEL-1}" ;;
  "projects delete") echo "Deleted [$3]." ;;
  "auth list") echo "\${FAKE_ACCOUNT}" ;;
esac
exit 0
`, { mode: 0o755 });
process.env.PATH = BIN + path.delimiter + process.env.PATH;

const cs = require('../electron/cs');
const skill = require('../electron/skill');
const { projectBase, parseProjectsCsv, configDir, AGY_MERGE_PY } = cs._test;
const { VM_INSPECT_SH, VM_WIPE_SH, parseInspect } = cs._zerar;

const ACCOUNTS = path.join(TMP, '.cloudshell-accounts.json');
const readAccounts = () => JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);
const deletes = () => calls().filter((c) => c.startsWith('projects delete')).map((c) => c.split(' ')[2]);
function setup({ accounts, projects = '', label = '1' }) {
  fs.writeFileSync(ACCOUNTS, JSON.stringify(accounts, null, 2));
  for (const a of accounts) fs.mkdirSync(configDir(a.Email), { recursive: true });
  const pf = path.join(TMP, 'projects.csv');
  fs.writeFileSync(pf, projects);
  process.env.FAKE_PROJECTS = pf;
  process.env.FAKE_LABEL = label;
  fs.rmSync(LOG, { force: true });
}
const acc = (name, email, project) => ({ Name: name, Email: email, Mode: 'agydirect', Session: 'agy', Command: '', User: '', Host: '', Port: 0, ...(project ? { Project: project } : {}) });

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------- funções puras ----------
test('projectBase: cshub-<parte do e-mail antes do @>, até 30 caracteres, sem hífen no fim', () => {
  assert.equal(projectBase(em('fulano.silva')), 'cshub-fulano-silva');
  assert.equal(projectBase(em('Ciclano_Souza')), 'cshub-ciclano-souza');
  const longo = projectBase(em('a'.repeat(40)));
  assert.ok(longo.length <= 30 && !longo.endsWith('-'));
});

test('parseProjectsCsv: separa válidos (prefixo cshub-) dos ignorados e corta a data', () => {
  const r = parseProjectsCsv('cshub-a,cshub-a,2026-10-25T12:00:00Z\nteste-b,teste,2026-10-26T01:00:00Z\n\n');
  assert.deepEqual(r.validos, [{ id: 'cshub-a', name: 'cshub-a', criado: '2026-10-25' }]);
  assert.deepEqual(r.ignorados.map((x) => x.id), ['teste-b']);
  assert.deepEqual(parseProjectsCsv(''), { validos: [], ignorados: [] });
});

test('configDir: uma pasta por e-mail, em minúsculas, dentro de ~/.cshub/gcloud', () => {
  const d = configDir(em('Fulano.Silva', 'Exemplo.com'));
  assert.equal(d, path.join(TMP, '.cshub', 'gcloud', em('fulano.silva')));
  assert.ok(!configDir(em('a/../b')).includes('..' + path.sep));
});

test('parseInspect: lê espelhos, tamanho da .saida, tarefas, tmux e ~/.cshub', () => {
  const out = '@@ESPELHO\n120 8 espelho/proj1/\n40  espelho/proj2/\n@@RODANDO\n1\n@@TMUX\n0\n@@CSHUB\n16\n@@FIM\n';
  assert.deepEqual(parseInspect(out), {
    espelhos: [{ pasta: 'espelho/proj1', kb: 120, saidaKb: 8 }, { pasta: 'espelho/proj2', kb: 40, saidaKb: 0 }],
    rodando: 1, tmux: 0, cshubKb: 16
  });
});

// ---------- scripts que rodam na VM (executados aqui numa HOME falsa) ----------
const vmHome = () => fs.mkdtempSync(path.join(TMP, 'vm-'));
const bash = (script, home) => {
  assert.ok(home.startsWith(TMP), 'o script só pode rodar numa HOME temporária');
  return spawnSync('bash', ['-c', script], { env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8' });
};

test('VM_INSPECT_SH + VM_WIPE_SH: inspeciona e apaga só ~/espelho e ~/.cshub', () => {
  const h = vmHome();
  fs.mkdirSync(path.join(h, 'espelho', 'p1', '.saida', 'T1'), { recursive: true });
  fs.writeFileSync(path.join(h, 'espelho', 'p1', '.saida', 'T1', 'RESUMO.md'), 'x');
  fs.mkdirSync(path.join(h, '.cshub', 'rodando'), { recursive: true });
  fs.writeFileSync(path.join(h, '.cshub', 'rodando', 'p1__T1'), '');
  fs.mkdirSync(path.join(h, 'outra'));
  fs.writeFileSync(path.join(h, 'outra', 'importante.txt'), 'fica');
  const info = parseInspect(bash(VM_INSPECT_SH, h).stdout);
  assert.equal(info.espelhos.length, 1);
  assert.ok(info.espelhos[0].saidaKb > 0, 'a .saida aparece para o aviso');
  assert.equal(info.rodando, 1, 'marcador novo conta como tarefa rodando');
  assert.match(bash(VM_WIPE_SH, h).stdout, /@@LIMPO/);
  assert.ok(!fs.existsSync(path.join(h, 'espelho')) && !fs.existsSync(path.join(h, '.cshub')));
  assert.equal(fs.readFileSync(path.join(h, 'outra', 'importante.txt'), 'utf8'), 'fica');
});

const python = spawnSync('python3', ['--version']).status === 0;
test('AGY_MERGE_PY: só acrescenta, respeita a escolha da pessoa e recusa arquivo ilegível', { skip: !python && 'python3 ausente' }, () => {
  const h = vmHome();
  const dir = path.join(h, '.gemini', 'antigravity-cli');
  const f = path.join(dir, 'settings.json');
  const merge = (...args) => JSON.parse(spawnSync('python3', ['-', ...args], { input: AGY_MERGE_PY, env: { HOME: h, PATH: process.env.PATH }, encoding: 'utf8' }).stdout.trim());
  // arquivo novo
  let r = merge('always-proceed', '0', '~', '~/espelho');
  assert.equal(r.toolPermission, 'always-proceed');
  assert.deepEqual(JSON.parse(fs.readFileSync(f)).trustedWorkspaces, [h, path.join(h, 'espelho')]);
  // escolha da pessoa e outras chaves ficam
  fs.writeFileSync(f, JSON.stringify({ toolPermission: 'request-review', colorScheme: 'dark' }));
  r = merge('always-proceed', '0', '~');
  assert.equal(r.toolPermission, 'request-review');
  assert.equal(JSON.parse(fs.readFileSync(f)).colorScheme, 'dark');
  // forçar troca
  assert.equal(merge('always-proceed', '1', '~').toolPermission, 'always-proceed');
  // rodar de novo não muda nada
  assert.deepEqual(merge('always-proceed', '0', '~').mudou, []);
  // ilegível: recusa e não sobrescreve
  fs.writeFileSync(f, '{oops');
  assert.ok(merge('always-proceed', '0', '~').erro);
  assert.equal(fs.readFileSync(f, 'utf8'), '{oops');
});

// ---------- run(): estouro de prazo não deixa órfãos ----------
test('run: no estouro do prazo mata o grupo inteiro (sem gcloud/python órfão segurando CPU ou a saída)', { skip: process.platform === 'win32' && 'só POSIX' }, async () => {
  const pidFile = path.join(TMP, 'neto.pid');
  const script = path.join(TMP, 'neto.sh');   // em arquivo: dentro de aspas o "$!" seria expandido pelo sh de fora
  // o neto não herda a saída: se sobrar órfão, o teste FALHA em vez de travar a suíte (no defeito antigo, travava)
  fs.writeFileSync(script, `sleep 300 >/dev/null 2>&1 &\necho $! > ${pidFile}\nwait\n`);
  const r = await cs._test.run('bash', [script], { shell: true, timeout: 800 });
  assert.equal(r.code, -2, 'estourou o prazo');
  const neto = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(neto > 1, 'leu o PID do neto');
  await new Promise((res) => setTimeout(res, 300));
  let vivo = true;
  try { process.kill(neto, 0); } catch { vivo = false; }
  if (vivo) { try { process.kill(neto, 'SIGKILL'); } catch {} }   // não deixa o órfão para trás
  assert.equal(vivo, false, 'o processo neto (sleep) também morreu');
});

// ---------- preferências ----------
test('preferências: padrão always-proceed + ~/espelho; setPrefs grava e getPrefs lê', () => {
  assert.deepEqual(cs.getPrefs(), { toolPermission: 'always-proceed', trustedFolders: ['~/espelho'] });
  cs.setPrefs({ toolPermission: null });
  assert.equal(cs.getPrefs().toolPermission, null);
  cs.setPrefs({ toolPermission: 'always-proceed' });
});

// ---------- zerar: projetos GCP (com gcloud falso) ----------
test('zerar --projetos-gcp: simulação não apaga; só projetos com prefixo cshub-; ignorados nunca', async () => {
  setup({ accounts: [acc('a', em('a'), 'cshub-a')], projects: 'cshub-a,cshub-a,2026-10-25T00:00:00Z\nteste-b,teste,2026-10-26T00:00:00Z\n' });
  const sim = await cs.zerar({ projetosGcp: true });
  assert.equal(sim.simulado, true);
  const it = sim.itens.find((x) => x.tipo === 'projetos-gcp');
  assert.deepEqual(it.projetos.map((x) => x.id), ['cshub-a']);
  assert.deepEqual(it.ignorados.map((x) => x.id), ['teste-b']);
  assert.deepEqual(deletes(), [], 'simulação não apaga');

  const r = await cs.zerar({ projetosGcp: true, confirmar: true });
  assert.deepEqual(deletes(), ['cshub-a'], 'só o projeto com prefixo');
  assert.equal(readAccounts()[0].Project, undefined, 'o campo Project é limpo');
  assert.ok(calls().includes('config unset project'));
  assert.equal(r.itens[0].apagados[0], 'cshub-a');
});

test('zerar --projetos-gcp: mais de um projeto válido bloqueia sem --forcar', async () => {
  setup({ accounts: [acc('a', em('a'), 'cshub-a')], projects: 'cshub-a,a,2026-10-25T00:00:00Z\ncshub-a-2,b,2026-10-26T00:00:00Z\n' });
  const r = await cs.zerar({ projetosGcp: true, confirmar: true });
  assert.match(r.itens[0].bloqueado, /2 projetos/);
  assert.deepEqual(deletes(), []);
  await cs.zerar({ projetosGcp: true, confirmar: true, forcar: true });
  assert.deepEqual(deletes().sort(), ['cshub-a', 'cshub-a-2']);
});

test('zerar: sem escopo dá erro; --conta desconhecida dá erro', async () => {
  assert.equal((await cs.zerar({})).ok, false);
  setup({ accounts: [acc('a', em('a'))] });
  assert.match((await cs.zerar({ projetosGcp: true, conta: 'nao-existe' })).error, /não encontrada/);
});

// ---------- remover (com gcloud falso) ----------
test('remover --apagar-projeto: recusa ID sem prefixo e projeto sem rótulo, sem alterar nada', async () => {
  setup({ accounts: [acc('a', em('a'), 'teste-b')] });
  let r = await cs.removeAccount('a', { apagarProjeto: true });
  assert.match(r.error, /não começa com cshub-/);
  assert.equal(readAccounts().length, 1);
  assert.ok(fs.existsSync(configDir(em('a'))));

  setup({ accounts: [acc('a', em('a'), 'cshub-a')], label: '' });
  r = await cs.removeAccount('a', { apagarProjeto: true });
  assert.match(r.error, /rótulo cshub=1/);
  assert.deepEqual(deletes(), []);
  assert.equal(readAccounts().length, 1);
});

test('remover: simular não altera; de verdade tira do cadastro, apaga o login local e o projeto rotulado', async () => {
  setup({ accounts: [acc('a', em('a'), 'cshub-a'), acc('b', em('b'))] });
  const sim = await cs.removeAccount('a', { apagarProjeto: true, simular: true });
  assert.equal(sim.simulado, true);
  assert.equal(readAccounts().length, 2);
  assert.deepEqual(deletes(), []);

  const r = await cs.removeAccount('a', { apagarProjeto: true });
  assert.equal(r.ok, true);
  assert.equal(r.projetoApagado, 'cshub-a');
  assert.deepEqual(readAccounts().map((x) => x.Name), ['b'], 'a outra conta fica');
  assert.ok(!fs.existsSync(configDir(em('a'))), 'login local apagado');
  assert.ok(fs.existsSync(configDir(em('b'))), 'login da outra conta fica');
});

// ---------- skill ----------
test('skill.remove: simular não apaga; remover tira só a pasta cloudshell-hub', async () => {
  await skill.install();
  const base = skill.baseDir();
  fs.mkdirSync(path.join(base, 'outra-skill'), { recursive: true });
  assert.equal(skill.remove({ simular: true }).removida, false);
  assert.ok(fs.existsSync(path.join(base, 'cloudshell-hub', 'SKILL.md')));
  assert.equal(skill.remove().removida, true);
  assert.ok(!fs.existsSync(path.join(base, 'cloudshell-hub')));
  assert.ok(fs.existsSync(path.join(base, 'outra-skill')));
});

// ---------- docs gerados ----------
test('docs/CSHUB.md e docs/CODIGOS-DE-ERRO.md batem com a ajuda da CLI e com errors.js (npm run docs)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'gerar-docs.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

// ---------- CLI ----------
const semDeps = !fs.existsSync(path.join(__dirname, '..', 'node_modules', 'tar')) && 'dependências ausentes: rode npm install --omit=dev';
test('CLI: ajuda funciona e zerar sem escopo sai com erro', { skip: semDeps }, () => {
  const cli = path.join(__dirname, '..', 'cli', 'cshub.js');
  const env = { ...process.env, HOME: TMP };
  const a = spawnSync(process.execPath, [cli, 'ajuda'], { env, encoding: 'utf8' });
  assert.equal(a.status, 0);
  assert.match(a.stdout, /cshub zerar/);
  const z = spawnSync(process.execPath, [cli, 'zerar', '--json'], { env, encoding: 'utf8' });
  assert.notEqual(z.status, 0);
  assert.equal(JSON.parse(z.stdout.trim()).ok, false);
});
