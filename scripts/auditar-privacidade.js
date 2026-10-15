// Procura dados pessoais nos arquivos versionados: e-mails, pastas de usuario do Windows, chaves e tokens.
// Uso: npm run auditar   (sai com 1 se achar algo)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const arquivos = execSync('git ls-files -co --exclude-standard', { cwd: raiz, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !/\.(png|ico|svg|lock)$|package-lock\.json$/.test(f))
  .filter((f) => fs.existsSync(path.join(raiz, f)));

// Exemplos inofensivos que podem aparecer no codigo e nos docs
const OK_EMAIL = /^(git@github\.com|[\w.+-]*@users\.noreply\.github\.com|noreply@anthropic\.com|(usuario|conta\d*|voce|exemplo|example|nome|fulano|seu\.?email|user|ana|nbruno|ncarla)@.*)$/i;
const regras = [
  ['e-mail', /[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => OK_EMAIL.test(m)],
  ['pasta de usuario', /[A-Za-z]:[\\/]Users[\\/](?!<|%|\.\.\.|SEU|seu|usuario|Usuario|NOME|nome|voce|\$)[\w.-]+/g, () => false],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, () => false],
  ['token', /\b(AIza[\w-]{30,}|ya29\.[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,})\b/g, () => false],
];

let achados = 0;
for (const f of arquivos) {
  let txt;
  try { txt = fs.readFileSync(path.join(raiz, f), 'utf8'); } catch { continue; }
  txt.split('\n').forEach((linha, i) => {
    for (const [nome, re, ignora] of regras) {
      for (const m of linha.matchAll(re)) {
        if (ignora(m[0])) continue;
        achados++;
        console.log(`${f}:${i + 1}  [${nome}]  ${m[0]}`);
      }
    }
  });
}

// Se existir um build, confere que ele nao tem contas
const release = path.join(raiz, 'release');
if (fs.existsSync(release)) {
  for (const f of fs.readdirSync(release)) {
    if (/accounts|projects|\.cshub/i.test(f)) { achados++; console.log(`release/${f}  [arquivo de dados no build]`); }
  }
}

if (achados) { console.log(`\n${achados} ocorrencia(s). Revise antes de publicar.`); process.exit(1); }
console.log(`Nada pessoal encontrado em ${arquivos.length} arquivos.`);
