#!/usr/bin/env node
// Gera docs/CODIGOS-DE-ERRO.md (a partir de electron/errors.js) e docs/CSHUB.md (a partir do texto de ajuda da CLI).
// Uso: npm run docs
const fs = require('fs');
const path = require('path');
const errors = require('../electron/errors');

const root = path.join(__dirname, '..');
const out = (f, s) => { fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); fs.writeFileSync(path.join(root, 'docs', f), s.replace(/\r\n/g, '\n'), 'utf8'); };

// código -> [o que significa, o que fazer]
const D = {
  'CSH-CONTA-101': ['A conta (apelido ou e-mail) não está cadastrada.', 'Confira o nome em `cshub contas` ou na aba Contas.'],
  'CSH-CONTA-102': ['E-mail com formato inválido.', 'Corrija o e-mail.'],
  'CSH-CONTA-103': ['Apelido inválido: só letras, números, ponto, hífen e sublinhado, até 32 caracteres.', 'Escolha outro apelido.'],
  'CSH-CONTA-104': ['Nome de sessão tmux inválido (mesmas regras do apelido).', 'Use só letras, números, ponto, hífen e sublinhado.'],
  'CSH-CONTA-105': ['Já existe uma conta com esse apelido ou e-mail.', 'Use outro apelido, ou edite a conta existente.'],
  'CSH-CONTA-106': ['O login no gcloud não foi concluído (janela fechada, tempo de 5 min esgotado ou conta errada escolhida).', 'Tente de novo e conclua o login do Google no navegador que o app abre.'],
  'CSH-CONTA-107': ['Não foi possível obter o token do gcloud para a conta (sessão expirada).', 'Refaça o login da conta (Editar conta ou `gcloud auth login`).'],
  'CSH-CONTA-108': ['Falha ao gerar a chave SSH do Cloud Shell.', 'Confira se `gcloud` e o Cliente OpenSSH (`ssh.exe`) estão instalados e no PATH.'],
  'CSH-VM-201': ['A API do Cloud Shell recusou ou falhou na chamada (permissão, cota do Google, rede).', 'Leia a mensagem completa. Se a conta nunca abriu o Cloud Shell, faça a validação manual em shell.cloud.google.com.'],
  'CSH-VM-202': ['Não foi possível iniciar o Cloud Shell da conta.', 'Tente de novo; se persistir, abra shell.cloud.google.com com a conta (validação manual).'],
  'CSH-VM-203': ['A VM não ficou ativa no tempo esperado.', 'Aguarde um minuto e tente de novo.'],
  'CSH-VM-204': ['O endereço da VM não veio na resposta da API.', 'Tente de novo (o app renova o endereço); se persistir, reinicie a VM.'],
  'CSH-VM-205': ['A VM não respondeu por SSH.', 'Aguarde e tente de novo; verifique rede e o estado da VM na aba Contas.'],
  'CSH-VM-206': ['Falha ao encerrar as sessões da VM.', 'Tente de novo; a VM é suspensa sozinha após um período sem uso.'],
  'CSH-SSH-301': ['A VM recusou a chave SSH. Costuma ser conta que nunca abriu o Cloud Shell, ou a chave ainda não propagou.', 'Abra shell.cloud.google.com com a conta uma vez (validação manual) e tente de novo.'],
  'CSH-SSH-302': ['Terminal embutido indisponível (o módulo `node-pty` não carregou).', 'Rode `npm install` de novo e reinicie o app.'],
  'CSH-SSH-303': ['Falha ao iniciar o `ssh`.', 'Instale o Cliente OpenSSH do Windows.'],
  'CSH-PROJ-401': ['Projeto não encontrado.', 'Confira o nome em `cshub projetos`.'],
  'CSH-PROJ-402': ['Nome de projeto inválido.', 'Use letras, números, ponto, hífen e sublinhado.'],
  'CSH-PROJ-403': ['Endereço do repositório Git inválido.', 'Use `https://github.com/usuario/repo` ou `git@github.com:usuario/repo.git`.'],
  'CSH-PROJ-404': ['Nome de branch base inválido.', 'Corrija o branch.'],
  'CSH-PROJ-405': ['Pasta inválida (do PC, do espelho ou de resultados) ou não foi possível criá-la.', 'Use o caminho completo de uma pasta existente (ex.: `C:\\Users\\voce\\Documents\\projeto`).'],
  'CSH-PROJ-406': ['Já existe um projeto com esse nome.', 'Escolha outro nome.'],
  'CSH-PROJ-407': ['Sem acesso ao repositório (privado ou sem credencial na VM).', 'Dê acesso à conta ou use o espelho do PC no lugar do Git.'],
  'CSH-PROJ-408': ['Falha ao clonar o repositório na VM.', 'Veja a mensagem; confira acesso e espaço em disco.'],
  'CSH-PROJ-409': ['Falha no envio (`git push`) a partir da VM.', 'Confira permissões de escrita no repositório.'],
  'CSH-PROJ-410': ['Conflito ao trazer alterações.', 'Resolva o conflito manualmente no repositório.'],
  'CSH-PROJ-411': ['O projeto ainda não foi preparado (clonado) nesta conta.', 'Use Preparar na aba Projetos.'],
  'CSH-PROJ-412': ['Falha de Git na VM: commit, buscar novidades ou trocar de branch.', 'Veja a mensagem do Git exibida junto.'],
  'CSH-ESPELHO-501': ['Pouca memória livre no PC para enviar. O mínimo cresce com o volume a enviar (envios pequenos quase não exigem).', 'Feche programas pesados e tente de novo, ou use `--forcar`.'],
  'CSH-ESPELHO-502': ['Espaço insuficiente no Cloud Shell para o envio.', 'Libere espaço na VM ou envie menos arquivos.'],
  'CSH-ESPELHO-503': ['Falha ao enviar os arquivos para a VM.', 'Tente de novo; confira a conexão e o estado da VM.'],
  'CSH-ESPELHO-504': ['Os arquivos chegaram, mas falhou o registro da linha de base na VM.', 'Rode o envio de novo.'],
  'CSH-ESPELHO-505': ['O espelho ainda não existe nesta conta.', 'Envie primeiro (`cshub enviar`).'],
  'CSH-ESPELHO-506': ['Resposta inesperada da VM ao comparar o espelho.', 'Tente de novo; se persistir, envie com `--tudo`.'],
  'CSH-ESPELHO-507': ['Falha ao trazer os arquivos da VM.', 'Tente de novo.'],
  'CSH-ESPELHO-508': ['Caminho fora do projeto ou com `..`.', 'Use um caminho dentro da pasta do projeto.'],
  'CSH-ESPELHO-509': ['A pasta do projeto no PC não foi definida.', 'Defina em Editar projeto, ou `cshub pasta-pc`.'],
  'CSH-ESPELHO-510': ['O espelho da conta está desatualizado em relação ao PC; a tarefa foi recusada.', 'Rode `cshub enviar`, ou `--ignorar-espelho` se for de propósito.'],
  'CSH-ESPELHO-511': ['`cshub aplicar` recusado: algum arquivo local não bate com o que foi enviado, ou a pasta de destino é inválida. Nada foi copiado.', 'Leia a lista de conflitos; reenvie, ou use `--forcar` conscientemente.'],
  'CSH-TAREFA-601': ['A conta está reservada (uso no PC ou reserva manual).', 'Use outra conta (`cshub escolher`) ou libere com `cshub liberar`.'],
  'CSH-TAREFA-602': ['A VM já usou quase todas as 50 h da semana.', 'Use outra conta, ou `--ignorar-horas` com motivo.'],
  'CSH-TAREFA-603': ['A cota do agy nesta conta está esgotada.', 'Espere a renovação (a mensagem diz quando) ou use outra conta.'],
  'CSH-TAREFA-604': ['Não foi possível medir a cota antes de disparar.', 'Tente de novo ou use `--ignorar-cota`.'],
  'CSH-TAREFA-605': ['Cota abaixo do mínimo pedido em `--cota-minima`.', 'Use outra conta ou reduza o mínimo.'],
  'CSH-TAREFA-606': ['A tarefa (ou o comando) está vazia.', 'Informe `--arquivo` ou `--texto` (`--comando` no `rodar`).'],
  'CSH-TAREFA-607': ['Modelo ou esforço inválido.', 'Esforço: low, medium, high ou max.'],
  'CSH-TAREFA-608': ['O espelho ainda não foi enviado para esta conta.', 'Rode `cshub enviar`.'],
  'CSH-TAREFA-609': ['O `agy` não está disponível na VM.', 'Abra a conta no app e confira a instalação do agy.'],
  'CSH-TAREFA-610': ['Não foi possível gravar a tarefa na VM.', 'Tente de novo; confira espaço e conexão.'],
  'CSH-TAREFA-611': ['Não foi possível gravar o vigia na VM, ou o agy não iniciou.', 'Confira `electron/vigia.sh` no app e o estado da VM.'],
  'CSH-TAREFA-612': ['ID de tarefa inválido.', 'Formato: `T20261009-123456-abc`.'],
  'CSH-TAREFA-613': ['Tarefa não encontrada nesta conta.', 'Confira o ID e a conta (`cshub tarefas`).'],
  'CSH-TAREFA-614': ['O agy parou sem terminar (a VM pode ter reiniciado).', '`cshub resultado` para o log; dispare de novo.'],
  'CSH-TAREFA-615': ['Ainda rodando depois do tempo de espera (saída 4).', 'Rode `cshub esperar` de novo.'],
  'CSH-TAREFA-616': ['A conexão caiu enquanto esperava; a tarefa pode continuar.', 'Rode `cshub esperar` de novo.'],
  'CSH-TAREFA-617': ['Não foi possível cancelar a tarefa.', 'Tente de novo.'],
  'CSH-TAREFA-618': ['A VM parou ou reiniciou durante a tarefa (saída 5).', '`cshub acordar`, `cshub trazer` e redispare o que faltou (`cshub tarefa --continuar --ignorar-espelho`).'],
  'CSH-TAREFA-701': ['Motivo **travada**: o agente ficou sem saída, sem CPU e sem arquivos novos além do limite (`--travado-min`, padrão 15 min). O vigia o encerrou (saída 7).', 'Redispare menor, ou aumente `--travado-min`.'],
  'CSH-TAREFA-702': ['Motivo **tempo-máximo**: passou de `--max-min` (padrão 90 min) e foi encerrada (saída 7).', 'Divida a tarefa ou aumente `--max-min`; `cshub trazer` salva o que já foi feito.'],
  'CSH-TAREFA-703': ['Motivo **servidor**: falha do servidor do Gemini/Antigravity (saída 8).', 'Tente de novo em alguns minutos, ou outra conta. Tarefas que não editam são repetidas sozinhas até 2 vezes.'],
  'CSH-TAREFA-704': ['Motivo **rede**: a VM ficou sem rede para o Gemini (saída 8).', 'Tente de novo em alguns minutos.'],
  'CSH-TAREFA-705': ['Motivo **login**: a conta perdeu o login no agy/gcloud (saída 9).', 'Refaça o login da conta no app.'],
  'CSH-TAREFA-706': ['Motivo **sem-resposta**: o agy terminou sem produzir resposta.', '`cshub resultado` e redispare.'],
  'CSH-TAREFA-707': ['Motivo **falhou**: o agy (ou o script) terminou com erro.', '`cshub resultado` mostra o log.'],
  'CSH-TAREFA-708': ['Motivo **morreu**: o processo sumiu sem registrar fim.', 'Veja `cshub resultado`; a VM pode ter reiniciado.'],
  'CSH-TAREFA-709': ['Motivo **segundo-plano**: o agy deixou testes em segundo plano, parou esperando e não entregou o `RESUMO.md` (saída 10).', 'Use `cshub rodar` para comandos conhecidos, ou `--impaciente`.'],
  'CSH-TAREFA-710': ['Motivo **sem-resumo**: o agy terminou com código 0 mas sem escrever `.saida/<ID>/RESUMO.md` (saída 11).', 'Confira o que ele editou (`cshub trazer`) antes de aplicar.'],
  'CSH-TAREFA-711': ['Motivo **comando-não-encontrado**: um comando do script não existe na VM (saída 12).', 'O `rodar` já carrega o nvm; instale a ferramenta que faltou.'],
  'CSH-TAREFA-712': ['A VM reiniciou no meio da tarefa.', 'Acorde a VM, traga os arquivos e redispare o que faltou.'],
  'CSH-COTA-701': ['Falha ao ler o painel `/usage` do agy, ou motivo **cota** (cota do Gemini esgotada durante a tarefa, saída 6).', 'Use outra conta; `cshub trazer` salva o que já foi feito.'],
  'CSH-COTA-702': ['O painel `/usage` não apareceu (o agy pode estar pedindo login).', 'Abra o agy no espelho uma vez nessa conta.'],
  'CSH-SKILL-801': ['O arquivo da skill não está na pasta do app.', 'Reinstale o app ou restaure `skill/cloudshell-hub/SKILL.md`.'],
  'CSH-SKILL-802': ['A cópia da skill não bateu com o original.', 'Instale a skill de novo.'],
  'CSH-APP-901': ['Pasta não encontrada.', 'Confira o caminho.'],
  'CSH-GERAL-900': ['Erro sem causa conhecida na tabela de códigos.', 'Leia a mensagem original, que vem junto; se for recorrente, abra uma issue com o código e o texto.']
};

const codes = [...new Set([...errors.TABLE.map((r) => r[1]), ...Object.values(errors.MOTIVO_CODE), errors.GERAL])].sort((a, b) => {
  const k = (c) => c.match(/^CSH-([A-Z]+)-(\d+)$/); const x = k(a), y = k(b);
  return x[1] === y[1] ? Number(x[2]) - Number(y[2]) : x[1].localeCompare(y[1]);
});
const AREAS = { CONTA: 'Contas', VM: 'VM e API do Cloud Shell', SSH: 'SSH e terminal', PROJ: 'Projetos (Git)', ESPELHO: 'Espelho do PC', TAREFA: 'Tarefas e vigia', COTA: 'Cota do Gemini', SKILL: 'Skill', APP: 'App', GERAL: 'Geral' };
let md = '# Códigos de erro\n\n> Gerado por `npm run docs` a partir de `electron/errors.js`. Não edite à mão: mude `scripts/gerar-docs.js`.\n\n';
md += 'Todo erro mostrado pelo app ou pelo `cshub` termina com `(código CSH-ÁREA-n)`. Na CLI com `--json` ele vem no campo `codigoErro` (ou `code`). Um erro sem causa conhecida vira `CSH-GERAL-900`.\n\n';
md += '## Códigos de saída do `cshub`\n\n| Saída | Significado |\n|---|---|\n';
for (const [c, t] of [['0', 'Deu certo.'], ['1', 'Erro (veja a mensagem e o código `CSH-…`).'], ['4', 'Tempo de espera esgotado, a tarefa continua rodando: rode `esperar` de novo.'], ['5', 'A tarefa morreu, a VM parou/reiniciou, ou nenhuma conta livre (`escolher`).'], ['6', 'Cota do Gemini esgotada ou abaixo do limite.'], ['7', 'Agente travado ou tempo máximo da tarefa.'], ['8', 'Falha de servidor ou de rede do Gemini.'], ['9', 'Conta sem login.'], ['10', 'O agente parou esperando segundo plano, sem entregar `RESUMO.md`.'], ['11', 'Terminou sem `RESUMO.md`.'], ['12', 'Comando inexistente na VM (`rodar`).']]) md += `| ${c} | ${t} |\n`;
md += '\n`esperar` e `acompanhar` terminam com a linha `CSH-FIM {"code":N,...}` para leitura por máquina.\n';
for (const area of Object.keys(AREAS)) {
  const list = codes.filter((c) => c.split('-')[1] === area);
  if (!list.length) continue;
  md += `\n## ${AREAS[area]}\n\n| Código | O que significa | O que fazer |\n|---|---|---|\n`;
  for (const c of list) { const d = D[c] || ['(sem descrição)', '']; md += `| \`${c}\` | ${d[0]} | ${d[1]} |\n`; }
}
const faltam = codes.filter((c) => !D[c]);
if (faltam.length) { console.error('Sem descrição em gerar-docs.js: ' + faltam.join(', ')); process.exit(1); }
out('CODIGOS-DE-ERRO.md', md);

// referência do cshub: o texto de ajuda da CLI
const src = fs.readFileSync(path.join(root, 'cli', 'cshub.js'), 'utf8');
const m = src.match(/const HELP = `([\s\S]*?)`;/);
if (!m) { console.error('Não achei o HELP em cli/cshub.js'); process.exit(1); }
out('CSHUB.md', '# Referência do `cshub`\n\n> Gerado por `npm run docs` a partir do texto de ajuda da CLI (`cshub ajuda`). Não edite à mão.\n\n```text\n' + m[1].replace(/\\`/g, '`').trim() + '\n```\n\nCódigos de erro: [CODIGOS-DE-ERRO.md](CODIGOS-DE-ERRO.md).\n');
console.log('docs/CODIGOS-DE-ERRO.md e docs/CSHUB.md gerados (' + codes.length + ' códigos).');
