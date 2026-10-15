// Confere se o binário do Electron foi baixado. O download automático do npm às vezes falha em silêncio
// (antivírus, proxy, rede instável) e o app não abre. Aqui tentamos de novo e, se não der, explicamos o que fazer.
// Uso: roda sozinho antes do `npm start` (prestart) e depois do `npm install` (postinstall, sem derrubar a instalação).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const posInstall = process.argv.includes('--pos-install');
const dir = path.join(__dirname, '..', 'node_modules', 'electron');

function ok() {
  try {
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
    return fs.existsSync(path.join(dir, 'dist', exe));
  } catch { return false; }
}

function ajuda() {
  console.error([
    '',
    'O Electron (a "janela" do app) não foi baixado direito. Isso é problema de download, não do projeto.',
    'Tente, nesta ordem:',
    '  1. Rode:  node node_modules\\electron\\install.js',
    '  2. Se continuar, apague a pasta node_modules\\electron e rode:  npm install',
    '  3. Rede com proxy ou bloqueio? Use um espelho:  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/   e repita o passo 1',
    '  4. Antivírus pode apagar o download: libere a pasta do projeto e repita.',
    '  5. Já tem outra cópia que funciona? Copie dela node_modules\\electron\\dist e node_modules\\electron\\path.txt (mesma versão).',
    '',
  ].join('\n'));
}

if (!fs.existsSync(dir)) {
  if (posInstall) process.exit(0);
  console.error('Dependências não instaladas. Rode primeiro:  npm install');
  process.exit(1);
}

for (let tentativa = 1; tentativa <= 2 && !ok(); tentativa++) {
  console.log(`Baixando o binário do Electron (tentativa ${tentativa}/2)…`);
  spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
}

if (ok()) { if (!posInstall) console.log('Electron ok.'); process.exit(0); }
ajuda();
process.exit(posInstall ? 0 : 1);
