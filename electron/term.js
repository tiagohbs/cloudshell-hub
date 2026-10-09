// Terminais embutidos: ssh.exe rodando num PTY (ConPTY no Windows), exibido com xterm.js na interface.
const fs = require('fs');
const os = require('os');
const path = require('path');

let pty = null;
let ptyError = null;
try { pty = require('@lydell/node-pty'); } catch (e) { ptyError = e; }

const terms = new Map();
let seq = 0;

function sshPath() {
  if (process.platform !== 'win32') return 'ssh';
  const p = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
  return fs.existsSync(p) ? p : 'ssh.exe';
}

function spawnSsh(send, args, cols, rows) {
  if (!pty) return { ok: false, error: 'Terminal embutido indisponível (módulo node-pty): ' + (ptyError && ptyError.message) };
  const id = ++seq;
  let p;
  try {
    p = pty.spawn(sshPath(), args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols | 0) || 80,
      rows: Math.max(5, rows | 0) || 24,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' }
    });
  } catch (e) {
    return { ok: false, error: 'Falha ao iniciar o ssh: ' + e.message };
  }
  terms.set(id, p);
  p.onData((d) => send('term:data', id, d));
  p.onExit(({ exitCode }) => {
    terms.delete(id);
    send('term:exit', id, exitCode);
  });
  return { ok: true, id };
}

function write(id, data) {
  const p = terms.get(id);
  if (p) p.write(data);
}

function resize(id, cols, rows) {
  const p = terms.get(id);
  if (p && cols > 0 && rows > 0) {
    try { p.resize(cols | 0, rows | 0); } catch {}
  }
}

function kill(id) {
  const p = terms.get(id);
  if (!p) return;
  terms.delete(id);
  try { p.kill(); } catch {}
}

function killAll() {
  for (const id of [...terms.keys()]) kill(id);
}

module.exports = { spawnSsh, write, resize, kill, killAll, available: () => !!pty, error: () => ptyError && ptyError.message };
