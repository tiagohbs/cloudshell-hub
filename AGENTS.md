# AGENTS.md — contexto para qualquer IA que mexer neste projeto

Leia este arquivo antes de alterar o código. Ele resume o que o app faz, como está organizado e as regras que o dono (Tiago) espera que sejam seguidas.

## O que é
**Cloud Shell Hub**: app desktop (Electron 33 + React 18 + Vite, Windows) que gerencia **várias contas do Google Cloud Shell**, abre terminais nelas (SSH) e permite que o orquestrador **Maestri** (um Claude no PC) delegue tarefas a agentes `agy` (Gemini) rodando nas VMs, cada conta com sua própria cota e memória.

Três peças trabalham juntas:
1. **App** (`electron/` + `src/`): interface, contas, terminais, projetos, espelho do PC, cota.
2. **CLI `cshub`** (`cli/cshub.js`, atalho `cshub.cmd`): mesma lógica do app, para o Maestri usar no terminal. Saída humana por padrão, `--json` para máquinas.
3. **Skill `cloudshell-hub`** (`skill/cloudshell-hub/SKILL.md`): ensina o Claude do Maestri a usar o `cshub`. É copiada para `~/.claude/skills/cloudshell-hub/` pelo botão "Instalar skill" do app ou por `cshub skill instalar`.

## Estrutura
| Caminho | Papel |
|---|---|
| `electron/main.js` | Janela, bandeja do sistema, IPC (`ipcMain.handle`), configurações (`userData/settings.json`) |
| `electron/preload.js` | Ponte segura `contextBridge` → `window.cs`, `window.proj`, `window.mirror`, `window.skill`, `window.appctl`, `window.clip`… |
| `electron/cs.js` | Contas, gcloud, API do Cloud Shell, SSH, ligar/encerrar VM, marcar conta "em uso no PC" |
| `electron/tasks.js` | Tarefas na nuvem (`agy -p`), regras de bloqueio de conta (`blockers`), `accountsOverview` |
| `electron/mirror.js` | Espelho PC → VM sem Git (envio incremental, trazer resultados) |
| `electron/projects.js` | Projetos (repo Git + espelho), preparar/sincronizar contas |
| `electron/quota.js` | Medição e cache da cota do Gemini |
| `electron/term.js` | Terminais embutidos (`@lydell/node-pty`) |
| `electron/vigia.sh` | Script que roda **na VM** junto com cada tarefa (enviado por `tasks.start`): detecta agy travado, tempo máximo, classifica a falha e repete falha de servidor. Precisa ter fim de linha LF (`.gitattributes`) |
| `electron/ver.sh` | Acompanhamento **somente leitura** de uma tarefa (envia-se à VM por `tasks.prepareLive`): formata o fluxo `stream-json` com `jq`, mostra erros e arquivos mudando. Usado por `cshub ao-vivo` e pelo menu "Ver tarefa ao vivo" |
| `electron/monitor.js` | Lista local `~/.cshub/monitor.json` das tarefas disparadas; o `main.js` confere a cada 60 s (`tasks.peek`, **sem acordar a VM**) e avisa no Windows |
| `electron/skill.js` | Status e instalação da skill no PC |
| `electron/errors.js` | Códigos de erro `CSH-<ÁREA>-<n>` (ver abaixo) |
| `src/App.jsx` | Abas Contas, cartões, avisos/sino, configurações, ajuda |
| `src/Projects.jsx`, `src/Terminals.jsx` | Abas Projetos e Terminais |
| `src/ask.jsx` | Janela de confirmação no tema (`ask()`), substitui `confirm()` |
| `src/Help.jsx` | Janela de ajuda arrastável (botão "?") |
| `src/styles.css` | Todo o visual, com variáveis de tema |
| `skill/` | Skill e rascunho do papel da nuvem para o Maestri |
| `build/` | Ícones (`icon.svg/png/ico`); `electron/icon.png` é a cópia usada em runtime |

Dados do usuário (fora do repositório): `~/.cloudshell-accounts.json`, `~/.cloudshell-projects.json`, `~/.cshub/` (cota, estado, conta local), `~/.ssh/google_compute_engine` (chave sem senha, usada pelo `ssh.exe`; **não há Pageant/ssh-agent**).

## Como rodar e gerar
```powershell
npm install
npm start          # vite build + electron .
npm run dist       # gera release\Cloud Shell Hub 0.1.0.exe (portátil)
```
- O Vite escreve em `dist/`; o instalador escreve em `release/` (separados de propósito). Ambos ficam fora do Git.
- O build do Vite/Electron **só funciona no Windows do dono**. Em ambiente Linux falta `@rollup/rollup-linux-x64-gnu`. Para validar sintaxe sem rodar: `node --check arquivo.js` (backend) e `esbuild` com `loader: 'jsx'` (React).
- Itens que o `.exe` precisa conter ficam em `build.files` do `package.json` (hoje `dist`, `electron`, `skill/cloudshell-hub`). Se um recurso novo for lido em tempo de execução, inclua-o ali.
- A CLI (`cli/`) **não** vai dentro do `.exe`; roda pelo `cshub.cmd` com Node.

## Regras de negócio que não podem quebrar
- **Conta bloqueada** (não recebe delegação) somente quando: em uso no PC pelo Maestri (`cshub local <e-mail>`, marca `[PC]`), reserva manual, sem login, **sem cota do Gemini** (esgotada ou < 5%) ou **sem horas de VM** (≥ 47 de 50 h na semana). Lógica única em `tasks.js: blockers()`; a UI (`App.jsx: blockers()`) espelha. `cshub escolher` lista as livres (sai com código 5 se nenhuma).
- **Papel/juiz da nuvem é decisão do orquestrador**, não do app.
- A VM do Cloud Shell só é acordada quando necessário; medir cota liga a VM (pede confirmação na UI).
- Segredos (`.env`, `*.pem`…) **nunca** vão ao espelho por padrão; envio com segredos exige duas confirmações.
- O script de encerrar VM usa `$$` (PID do próprio shell) para não matar a si mesmo. Não troque.

## Tarefas, falhas e avisos
- Cada tarefa roda via `vigia.sh`: `--travado-min` (15) e `--max-min` (90) encerram o agy; o motivo vai para `motivo` (`cota|login|servidor|rede|travada|tempo-maximo|sem-resposta|segundo-plano|sem-resumo|falhou`; tarefas que editam só saem com 0 se `.saida/<id>/RESUMO.md` existir). `tasks.start` recusa espelho diferente do PC (`mirror.pending`), aceita `anexos`; `mirror.apply` (`cshub aplicar`) confere antes de copiar; `esperar` termina com a linha `CSH-FIM`. Falha de servidor/rede é repetida até 2x só em tarefas que não editam.
- Códigos de saída do `cshub esperar`: 0 ok, 4 ainda rodando, 5 morreu, 6 cota, 7 travada/tempo máximo, 8 servidor/rede, 9 login. Códigos de erro por motivo: `errors.MOTIVO_CODE`.
- `agy -p --output-format stream-json` (flag `--ao-vivo` do `cshub tarefa`) grava os eventos do agente em tempo real em `saida.json`; por padrão ainda é `json` (só no fim) até o formato ser validado numa tarefa real. `answerFrom` aceita NDJSON, mas o esquema dos eventos do agy **ainda não foi confirmado**.
- `cshub acompanhar` = `ao-vivo` + `esperar` + `--trazer` num comando, para painéis de terminal de orquestradores (Maestri etc.): sai com o código da tarefa; `--resumo` reduz o fluxo a marcos (economiza tokens do agente que lê o painel).
- `cshub rodar` roda um comando/script na VM (testes, mutação, QA) sob o mesmo vigia, sem agy e sem gastar cota; `tasks.start({command:true})`. O vigia considera "vivo": CPU da árvore de processos, arquivos do projeto alterados, logs crescendo e `touch $CSHUB_PULSO`.
- O monitor do app **nunca** usa `cs.prepare` (acordaria a VM e gastaria horas); usa `tasks.peek`.
- Notificações do Windows: `Notification` do Electron, `setAppUserModelId`, chave `notifyTasks` em `settings.json`.

## Convenções de código
- **Textos para o usuário em português do Brasil, com acentos.** Não deixe mensagens sem acento ("nao", "voce", "sessao"). Strings de protocolo internas (nomes de estado como `concluida`, arquivos como `codigo`) ficam sem acento de propósito: não "corrija".
- **Erros:** todo erro que chega ao usuário passa por `errors.tag()` (IPC `wrap()` em `main.js` e `fail()` na CLI) e ganha `(código CSH-ÁREA-n)`. Áreas: CONTA, VM, SSH, PROJ, ESPELHO, TAREFA, COTA, SKILL, APP, GERAL. Para um erro novo, adicione uma linha na `TABLE` de `errors.js` e, se fizer sentido, um texto amigável em `FRIENDLY` (`App.jsx`). Erro sem causa conhecida vira `CSH-GERAL-900` / `CSH-APP-900`.
- **IPC:** novo recurso = `ipcMain.handle('area:acao', wrap(...))` em `main.js` + entrada no `preload.js` + uso via `window.<area>.<acao>`. Nada de `nodeIntegration`; o renderer roda com `contextIsolation` e `sandbox`.
- **Sem `confirm()`/`alert()` nativos.** Use `ask()` de `src/ask.jsx` (aceita `danger`, `extra`, `extraDanger`, `check`).
- **CSP restrita** (`default-src 'self'`): sem fontes ou scripts externos. A fonte cai em Segoe UI/Consolas.
- **Tema:** claro (padrão), escuro (`[data-theme="dark"]`) e automático (`prefers-color-scheme`), guardado em `localStorage` (`cs.theme`). Use sempre as variáveis de `styles.css` (`--bg`, `--panel`, `--accent`, `--bad-*`…), nunca cores fixas. Paleta baseada no Google (azul `#1A73E8`, vermelho, amarelo, verde).
- **Visual:** limpo, cantos arredondados, botões em pílula, ícones discretos. Qualquer janela nova deve seguir `.dialog`/`.overlay`.
- Fechar a janela do app pede escolha **minimizar para a bandeja / fechar de vez** (configurável em `settings.json`, chave `closeAction`: `ask|tray|quit`). Terminais seguem vivos na bandeja.

## Fluxo de trabalho esperado
- O dono é professor/desenvolvedor e conversa em português. Seja direto; explique o resultado, não o passo a passo.
- Depois de grandes alterações, rode `graphify update` (preferência dele) e use o graphify para navegar no projeto quando ajudar.
- Valide o que puder sem executar o Electron (`node --check`, esbuild) e **diga claramente o que não foi testado**; ele testa com `npm start`.
- Não faça commit/push sem ele pedir. Repositório: https://github.com/tiagohbs/cloudshell-hub (privado, branch `main`).
- Se mudar o comportamento do `cshub`, atualize também `skill/cloudshell-hub/SKILL.md` (e reinstale a skill) e `skill/NUVEM_CLOUDSHELL.rascunho.md`, que é o que o Claude do Maestri lê.
- Se mudar uma tela, atualize os passos em `src/Help.jsx` e este arquivo quando a estrutura mudar.


## Notas de 14/10
- `vigia.sh` do `rodar` carrega o nvm e trata 127/`command not found` como falha (`comando-nao-encontrado`, saída 12); `--impaciente` (7º argumento) encerra tarefa parada esperando segundo plano.
- `tasks.listOn` marca `reiniciou` quando a VM bootou depois do início da tarefa; `wait` devolve `dead` se a conexão cai e a VM não está RUNNING.
- `mirror.fetchResults` compara por conteúdo com a pasta do PC (arquivos só com data diferente ficam como `=`).
- CLI: progresso vai para o stdout; saída com `quit()` (sem `process.exit`, que derrubava o libuv no Windows); `cshub saude` confere o agy local.
