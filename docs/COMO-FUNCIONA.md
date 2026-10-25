# Como o Cloud Shell Hub funciona

## Visão geral

```
 Orquestrador (você / Claude / Maestri)
        │  cshub tarefa / esperar / trazer / aplicar
        ▼
 ┌──────────────── PC (Windows) ────────────────┐
 │  cshub (CLI)        App Electron (painel)    │
 │      └── compartilham electron/*.js ─────────┤
 │  contas · projetos · espelho · monitor       │
 └───────────────┬──────────────────────────────┘
                 │ SSH (chave do Cloud Shell, via API do gcloud)
                 ▼
 ┌──────────── VM do Cloud Shell (por conta) ───┐
 │  <projeto>/ (espelho)   .cshub/tarefas/<id>/ │
 │  vigia.sh  →  agy (Gemini)  →  RESUMO.md     │
 └──────────────────────────────────────────────┘
```

O PC é a fonte da verdade. A VM é descartável: recebe uma cópia do projeto, o agente trabalha nela, e o resultado volta para o PC numa pasta separada. Só depois de conferir você aplica as mudanças no projeto (`cshub aplicar`).

## Partes do código

| Parte | Arquivos | Função |
|---|---|---|
| Processo principal | `electron/main.js` | Janela, IPC (`area:acao`), avisos do Windows, monitor de tarefas |
| Contas / Cloud Shell | `electron/cs.js` | Cadastro, login no gcloud, perfil de Chrome por conta, iniciar a VM, chave SSH, SSH remoto |
| Projetos | `electron/projects.js` | Cadastro de projetos, lista de segredos, pasta de resultados |
| Espelho | `electron/mirror.js` | Envio incremental PC→VM, trazer resultados, aplicar |
| Tarefas | `electron/tasks.js`, `electron/vigia.sh` | Disparar, vigiar, esperar, cancelar |
| Cota | `electron/quota.js` | Lê o `/usage` do agy numa sessão tmux escondida |
| Monitor | `electron/monitor.js` | Lista local de tarefas para avisar no Windows |
| Erros | `electron/errors.js` | Códigos `CSH-ÁREA-n` |
| Terminal | `electron/term.js`, `src/Terminals.jsx` | node-pty + xterm |
| Interface | `src/*.jsx`, `src/styles.css` | React (Contas, Terminais, Projetos, Ajuda) |
| CLI | `cli/cshub.js`, `cshub.cmd` | Mesmos módulos, sem janela |
| Skill | `skill/cloudshell-hub/SKILL.md`, `electron/skill.js` | Instrução para o orquestrador; instalada em `~/.claude/skills` |

O renderer não tem acesso a Node: `contextIsolation`, `sandbox` e CSP ligados; o `preload.js` expõe só funções nomeadas.

## Fluxo de uma tarefa

1. **Escolher conta** (`cshub escolher`): a primeira com VM utilizável e cota acima do limite.
2. **Espelho**: `mirror.pending()` lista o que mudou desde o último envio; `send()` manda em fluxo (tar) só isso. Segredos ficam de fora. A VM recebe `.cshub/` com `git diff`, `git status`, branch/commit e um `LEIA-ME.txt`.
3. **Disparo** (`tasks.start`): cria `.cshub/tarefas/<id>/` na VM, grava o prompt e inicia o `vigia.sh` numa sessão tmux, que roda o `agy`.
4. **Vigia** (na VM): acompanha CPU e atividade do agente. Encerra e classifica quando há:
   - travamento (sem atividade por `STALL`) ou tempo máximo (`MAX`);
   - cota esgotada, login caído, erro de servidor/rede (estes dois repetem sozinhos em tarefas só de leitura);
   - agente parado esperando segundo plano (`--impaciente` mata em 3 min);
   - fim sem `RESUMO.md` em tarefa que edita arquivos;
   - comando inexistente (`rodar`, exit 127).
   Arquivos em `tarefas/<id>/`: `prompt`, `log`, `codigo` (saída), `motivo`, `fim`.
5. **Esperar** (`cshub esperar`): consulta a VM sem acordá-la, mostra progresso e termina com `CSH-FIM {...}` e um código de saída (tabela em [CODIGOS-DE-ERRO.md](CODIGOS-DE-ERRO.md)).
6. **Trazer** (`cshub trazer`): baixa para `<resultados>\<conta>\<data-hora>\` os arquivos alterados (comparados por conteúdo), `mudancas.txt` e `alteracoes.patch`.
7. **Aplicar** (`cshub aplicar`): copia para o projeto, recusando se o arquivo mudou no PC depois do envio (`--simular` mostra, `--forcar` ignora).

O app também vigia `~/.cshub/monitor.json` e avisa no Windows quando uma tarefa acaba, falha ou a VM some.

## Login e perfis de Chrome

Cada conta usa um perfil próprio de Chrome (`%LOCALAPPDATA%\CloudShellHub\chrome\<email>`). Assim a conta é sempre a de índice 0 do navegador, e o link do Cloud Shell (`https://shell.cloud.google.com/?authuser=0&show=terminal`) abre na conta certa. O `gcloud auth login` é aberto nesse perfil via variável `BROWSER`. A primeira abertura de cada conta exige validação manual do Google.

**Login pelo terminal e config isolada por conta.** `cshub login` (ou `cshub login --link` e `--codigo`, para agentes sem terminal interativo) roda `gcloud auth login --no-launch-browser` numa pasta temporária e a move para `~/.cshub/gcloud/<e-mail>/`. Todo comando do `cshub` usa essa pasta como `CLOUDSDK_CONFIG` da conta, então os logins não se misturam nem dependem do gcloud global (contas antigas, sem pasta própria, continuam no global). Cada conta ganha também um projeto GCP `cshub-<parte do e-mail antes do @>`, com o rótulo `cshub=1`, guardado no campo `Project` da conta.

**Preparação do agy.** No primeiro uso da VM de cada conta, o `cshub` grava `"toolPermission": "always-proceed"` e a pasta pessoal em `trustedWorkspaces` no `~/.gemini/antigravity-cli/settings.json` da VM, sem sobrescrever o que já estiver escolhido. O padrão fica em `~/.cshub/preferencias.json` e muda com `cshub preparar --padrao <modo|nenhum>`; para uma conta só, `cshub preparar <conta> --permissao <modo>`.

## Códigos de erro

Todo erro tem um código `CSH-ÁREA-n` (áreas: CONTA, VM, TAREFA, ESPELHO, PROJETO, …). Lista completa, com o que fazer: [CODIGOS-DE-ERRO.md](CODIGOS-DE-ERRO.md). Na CLI, `--json` traz o código em `codigoErro`.

## Onde ficam os dados

Tudo fora da pasta do app, na pasta do usuário. **Por isso o instalador sai limpo.**

| Caminho | Conteúdo |
|---|---|
| `~/.cloudshell-accounts.json` | Contas (apelido, e-mail, projeto) |
| `~/.cshub/gcloud/<e-mail>/` | Login e config do gcloud de cada conta (dá acesso à conta: nunca copiar nem comitar) |
| `~/.cshub/preferencias.json` | Preferências do cshub para contas novas (permissão de ferramentas do agy) |
| `~/.cshub/login-pendente/` | Login em andamento do `cshub login --link` (some ao terminar) |
| `~/.cloudshell-projects.json` | Projetos e pastas |
| `~/.cloudshell-usage.json` | Uso local das contas |
| `~/.cshub/` | Monitor, estado do espelho, cota, conta local |
| `~/.ssh/google_compute_engine` e `known_hosts_cs_*` | Chave e hosts do Cloud Shell |
| `%LOCALAPPDATA%\CloudShellHub\chrome\` | Perfis de Chrome por conta |
| `<resultados>\<conta>\<data-hora>\` | Resultados trazidos |

Para "zerar" um PC: apague esses arquivos/pastas.

## Segurança

- O app não guarda senhas. O login é do Google, no Chrome; o gcloud guarda as credenciais no lugar padrão dele.
- Segredos (`.env`, `*-keys.json`, `*.pem`, `id_rsa*`…) não vão no espelho, a não ser com `--com-segredos`.
- Comandos remotos validam nomes (apelido, sessão tmux) para evitar injeção de shell.
- Para um **produto comercial** seria preciso, além disto: assinar o executável, ligar os Electron Fuses e guardar credenciais com `safeStorage`.

## Desenvolvimento e build

```powershell
npm install
npm start          # build do front + abre o Electron
npm run dev        # build em watch
npm run dist       # executável portátil em .\release
npm run docs       # regera docs/CODIGOS-DE-ERRO.md e docs/CSHUB.md
npm run auditar    # procura dados pessoais nos arquivos
```

O build só funciona no Windows. `build.files` do `package.json` define o que entra no executável.
