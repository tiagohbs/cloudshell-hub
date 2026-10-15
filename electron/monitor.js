// Lista local das tarefas disparadas (a CLI grava, o app vigia). Serve para avisar no Windows
// quando uma tarefa termina, falha ou perde a VM, mesmo sem ninguem olhando o Maestri.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.cshub');
const FILE = path.join(DIR, 'monitor.json');
const DAY = 24 * 3600 * 1000;

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j.tasks) ? j.tasks : []; } catch { return []; }
}
function save(tasks) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ tasks }, null, 2));
  fs.renameSync(tmp, FILE);
}
function add({ projeto, conta, id }) {
  const now = Date.now();
  const l = load().filter((t) => now - Date.parse(t.inicio) < 2 * DAY).slice(-99);
  l.push({ projeto, conta, id, inicio: new Date(now).toISOString(), falhasVm: 0, notificado: false });
  save(l);
}
const pending = () => load().filter((t) => !t.notificado && Date.now() - Date.parse(t.inicio) < DAY);
function update(t, patch) {
  const l = load();
  const x = l.find((y) => y.projeto === t.projeto && y.conta === t.conta && y.id === t.id);
  if (x) { Object.assign(x, patch); save(l); }
}

const all = () => load();
module.exports = { add, pending, update, all, FILE };
