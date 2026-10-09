// Cota do Gemini (agy): le o painel /usage do proprio agy, aberto escondido num tmux da VM.
// /usage e um comando local do agy (nao e um pedido ao modelo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cs = require('./cs');

const DIR = path.join(os.homedir(), '.cshub', 'cota');
const file = (acc) => path.join(DIR, String(acc).replace(/[^\w.-]/g, '_') + '.json');

// "166h 9m", "3h 9m", "45m", "2d 3h", "1h 2m 3s" -> minutos
function parseDur(s) {
  let min = 0;
  let any = false;
  for (const [, n, u] of String(s).matchAll(/(\d+)\s*([dhms])/g)) {
    any = true;
    min += u === 'd' ? n * 1440 : u === 'h' ? n * 60 : u === 'm' ? Number(n) : n / 60;
  }
  return any ? Math.round(min) : null;
}

function parseUsage(text, now = Date.now()) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/[│└]/g, '').trim());
  const groups = [];
  let g = null;
  let win = null;
  for (const l of lines) {
    if (/^GEMINI MODELS$/i.test(l)) { g = { grupo: 'gemini', nome: 'Gemini' }; groups.push(g); continue; }
    if (/MODELS$/.test(l) && /^[A-Z][A-Z &]+MODELS$/.test(l)) { g = /CLAUDE|GPT/.test(l) ? { grupo: 'claude-gpt', nome: 'Claude e GPT' } : { grupo: l.toLowerCase().replace(/\s+models$/, '').replace(/\W+/g, '-'), nome: l.replace(/\s+MODELS$/, '') }; groups.push(g); continue; }
    if (!g) continue;
    if (/^Models within this group:/i.test(l)) { g.modelos = l.split(':')[1].split(',').map((x) => x.trim()).filter(Boolean); continue; }
    if (/^Weekly Limit Remaining/i.test(l)) { win = g.semanal = {}; continue; }
    if (/^Five Hour Limit Remaining/i.test(l)) { win = g.cincoHoras = {}; continue; }
    if (!win) continue;
    const pct = l.match(/(\d+(?:\.\d+)?)%\s*$/);
    if (pct && win.restante == null) { win.restante = Number(pct[1]); continue; }
    const rf = l.match(/^Refreshes in\s+(.+)$/i);
    if (rf) { const m = parseDur(rf[1]); win.renovaEmMin = m; win.renova = m != null ? new Date(now + m * 60000).toISOString() : null; continue; }
    if (/^Quota available/i.test(l)) { win.renovaEmMin = null; win.renova = null; continue; }
  }
  const ok = groups.some((x) => x.semanal && x.semanal.restante != null);
  return ok ? { ok: true, at: new Date(now).toISOString(), grupos: groups } : { ok: false };
}

const PROBE = [
  'S=cshubcota$$',
  'cd "$HOME" || exit 3',
  'command -v agy >/dev/null || { echo "@@NOAGY"; exit 3; }',
  'tmux new -d -s $S -x 160 -y 70 agy || { echo "@@NOTMUX"; exit 3; }',
  'for i in $(seq 1 40); do sleep 1; tmux capture-pane -pt $S | grep -q "for shortcuts" && break; done',
  'tmux send-keys -t $S "/usage" Enter',
  'for i in $(seq 1 25); do sleep 1; [ "$(tmux capture-pane -pt $S -S -300 | grep -c "Five Hour Limit")" -ge 2 ] && break; done',
  'sleep 1',
  'echo "@@INICIO"; tmux capture-pane -pt $S -S -300; echo "@@FIM"',
  'tmux kill-session -t $S 2>/dev/null'
].join('\n');

function save(acc, data) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file(acc), JSON.stringify(data, null, 2)); } catch {}
}
function cached(acc) {
  try {
    const d = JSON.parse(fs.readFileSync(file(acc), 'utf8'));
    d.idadeMin = Math.round((Date.now() - Date.parse(d.at)) / 60000);
    // recalcula o tempo ate renovar a partir do horario salvo
    for (const g of d.grupos || []) for (const w of [g.semanal, g.cincoHoras]) {
      if (w && w.renova) w.renovaEmMin = Math.max(0, Math.round((Date.parse(w.renova) - Date.now()) / 60000));
    }
    if (d.esgotada && d.esgotada.ate && Date.parse(d.esgotada.ate) < Date.now()) delete d.esgotada;
    return d;
  } catch { return null; }
}

async function check(accName) {
  const p = await cs.prepare(accName);   // acorda a VM se preciso
  if (!p.ok) return p;
  const { spawn } = require('child_process');
  const r = await new Promise((resolve) => {
    const c = spawn('ssh', [...cs.sshBase(p.acc, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']), PROBE], { windowsHide: true });
    let out = '';
    let err = '';
    const t = setTimeout(() => { try { c.kill(); } catch {} }, 120000);
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.stdin.on('error', () => {});
    c.stdin.end();
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: err + e }); });
  });
  if (/@@NOAGY/.test(r.out)) return { ok: false, error: 'O agy não está disponível nesta VM.' };
  const m = r.out.match(/@@INICIO\n([\s\S]*?)@@FIM/);
  if (!m) return { ok: false, error: 'Não consegui ler o /usage do agy: ' + (r.err || r.out).trim().slice(-200) };
  const parsed = parseUsage(m[1]);
  if (!parsed.ok) return { ok: false, error: 'O painel /usage não apareceu (o agy pode estar pedindo login nesta conta).', tela: m[1].trim().slice(-600) };
  const prev = cached(accName);
  const data = { conta: accName, ...parsed };
  const rem = remaining(data);
  if (prev && prev.esgotada && !(rem && rem.minimo > 1)) data.esgotada = prev.esgotada;
  save(accName, data);
  return data;
}

// grupo usado por um modelo (padrao: Gemini)
const groupFor = (model) => (/claude|gpt/i.test(String(model || '')) ? 'claude-gpt' : 'gemini');
function remaining(data, model) {
  if (!data || !data.grupos) return null;
  const g = data.grupos.find((x) => x.grupo === groupFor(model)) || data.grupos[0];
  const s = g.semanal && g.semanal.restante;
  const h = g.cincoHoras && g.cincoHoras.restante;
  const vals = [s, h].filter((v) => v != null);
  return vals.length ? { grupo: g.grupo, semanal: s, cincoHoras: h, minimo: Math.min(...vals), renovaCincoHoras: g.cincoHoras && g.cincoHoras.renova, renovaSemanal: g.semanal && g.semanal.renova } : null;
}

// marca a conta como sem cota ate a renovacao (vindo de um erro do agy)
function markExhausted(accName, untilIso, motivo) {
  const d = cached(accName) || { conta: accName, at: new Date().toISOString(), grupos: [] };
  d.esgotada = { ate: untilIso || new Date(Date.now() + 30 * 60000).toISOString(), motivo: motivo || 'cota esgotada', marcadaEm: new Date().toISOString() };
  delete d.idadeMin;
  save(accName, d);
  return d.esgotada;
}

// reconhece erro de cota na saida do agy; devolve { reset } ou null
function quotaError(text) {
  const s = String(text || '');
  if (!/RESOURCE_EXHAUSTED|quota (?:reached|exceeded|exhausted)|Individual quota|rate limit|\b429\b/i.test(s)) return null;
  const m = s.match(/Resets? in\s+([0-9dhms\s]+)/i) || s.match(/Refreshes in\s+([0-9dhms\s]+)/i);
  const min = m ? parseDur(m[1]) : null;
  return { reset: min != null ? new Date(Date.now() + min * 60000).toISOString() : null };
}

module.exports = { check, cached, remaining, markExhausted, quotaError, groupFor, _test: { parseUsage, parseDur } };
