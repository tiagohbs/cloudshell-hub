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
