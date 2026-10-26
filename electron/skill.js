// Estado e instalacao da skill cloudshell-hub no PC (a pasta que o Claude/Maestri le).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const NAME = 'cloudshell-hub';
const SRC = path.join(__dirname, '..', 'skill', NAME, 'SKILL.md');
// Pasta onde o orquestrador le as skills. Padrao: ~/.claude/skills (a pasta do proprio usuario);
// pode ser trocada (Maestri/Claude em outro lugar) e fica em ~/.cshub/config.json.
const PADRAO = path.join(os.homedir(), '.claude', 'skills');
const CONFIG = path.join(os.homedir(), '.cshub', 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch { return {}; } };
function baseDir() { const d = readCfg().skillDir; return typeof d === 'string' && d.trim() ? path.resolve(d.trim()) : PADRAO; }
const dirOf = () => path.join(baseDir(), NAME);
const dstOf = () => path.join(dirOf(), 'SKILL.md');
function setBase(dir) {
  const cfg = readCfg();
  if (!dir) delete cfg.skillDir;
  else {
    const d = path.resolve(String(dir).trim());
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return { ok: false, error: 'A pasta não existe: ' + d };
    cfg.skillDir = d;
  }
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  return { ok: true, pasta: baseDir(), personalizada: !!cfg.skillDir };
}
const hash = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const hasCshub = () => new Promise((res) => execFile(process.platform === 'win32' ? 'where' : 'which', ['cshub'], { timeout: 5000 }, (e, out) => res(e ? null : String(out).split(/\r?\n/)[0].trim())));
const version = (f) => { try { return (fs.readFileSync(f, 'utf8').match(/^name:\s*(.+)$/m) || [])[1] || null; } catch { return null; } };

async function status() {
  const origem = fs.existsSync(SRC);
  const DST = dstOf();
  const hs = hash(SRC), hd = hash(DST);
  let estado = 'ausente';
  if (!origem) estado = 'sem-origem';
  else if (hd) estado = hd === hs ? 'atualizada' : 'desatualizada';
  const cshub = await hasCshub();
  const cmd = path.join(__dirname, '..', 'cshub.cmd');
  return { ok: true, estado, instalada: !!hd, origem, caminho: DST, pastaBase: baseDir(), pastaPadrao: PADRAO, personalizada: baseDir() !== PADRAO, pastaOrigem: SRC, cshubNoPath: !!cshub, cshubCaminho: cshub, cshubCmd: cmd };
}

async function install() {
  if (!fs.existsSync(SRC)) return { ok: false, error: 'O arquivo da skill não está na pasta do app (skill\\cloudshell-hub\\SKILL.md).' };
  const DIR = dirOf(), DST = dstOf();
  fs.mkdirSync(DIR, { recursive: true });
  let backup = null;
  if (fs.existsSync(DST) && hash(DST) !== hash(SRC)) {
    backup = DST + '.bak';
    fs.copyFileSync(DST, backup);
  }
  fs.copyFileSync(SRC, DST);
  if (hash(DST) !== hash(SRC)) return { ok: false, error: 'A cópia não bateu com o original. Tente de novo.' };
  return { ok: true, caminho: DST, backup };
}

// remove a pasta da skill (SKILL.md e o .bak). Só apaga a pasta chamada cloudshell-hub dentro da pasta de skills.
function remove({ simular = false } = {}) {
  const dir = dirOf();
  if (path.basename(dir) !== NAME) return { ok: false, error: 'Pasta inesperada: ' + dir };
  const existe = fs.existsSync(dir);
  if (existe && !simular) fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, caminho: dir, existia: existe, removida: existe && !simular };
}

module.exports = { remove, status, install, setBase, baseDir, PADRAO, SRC };
