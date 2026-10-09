// Estado e instalacao da skill cloudshell-hub no PC (a pasta que o Claude/Maestri le).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const NAME = 'cloudshell-hub';
const SRC = path.join(__dirname, '..', 'skill', NAME, 'SKILL.md');
const DIR = path.join(os.homedir(), '.claude', 'skills', NAME);
const DST = path.join(DIR, 'SKILL.md');
const hash = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const hasCshub = () => new Promise((res) => execFile(process.platform === 'win32' ? 'where' : 'which', ['cshub'], { timeout: 5000 }, (e, out) => res(e ? null : String(out).split(/\r?\n/)[0].trim())));
const version = (f) => { try { return (fs.readFileSync(f, 'utf8').match(/^name:\s*(.+)$/m) || [])[1] || null; } catch { return null; } };

async function status() {
  const origem = fs.existsSync(SRC);
  const hs = hash(SRC), hd = hash(DST);
  let estado = 'ausente';
  if (!origem) estado = 'sem-origem';
  else if (hd) estado = hd === hs ? 'atualizada' : 'desatualizada';
  const cshub = await hasCshub();
  const cmd = path.join(__dirname, '..', 'cshub.cmd');
  return { ok: true, estado, instalada: !!hd, origem, caminho: DST, pastaOrigem: SRC, cshubNoPath: !!cshub, cshubCaminho: cshub, cshubCmd: cmd };
}

async function install() {
  if (!fs.existsSync(SRC)) return { ok: false, error: 'O arquivo da skill não está na pasta do app (skill\\cloudshell-hub\\SKILL.md).' };
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

module.exports = { status, install, DST, SRC };
