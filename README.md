# Cloud Shell Hub

App desktop (Electron + React) para várias contas do Google Cloud Shell.
Usa o mesmo arquivo de contas do script PowerShell: `%USERPROFILE%\.cloudshell-accounts.json`.

## Rodar
```powershell
cd C:\Users\DEV\Documents\cloudshell-app
npm install
npm start
```

## Gerar executável portátil
```powershell
npm run dist      # saída em .\release
```

## Uso
- Aba **Contas**: um cartão por conta. **Abrir no app** abre um terminal embutido; **Janela externa** abre no Windows Terminal; **Copiar comando** copia o `ssh` para colar no Maestri.
- Aba **Terminais**: painéis lado a lado (até 3 por linha). ⤢ maximiza um painel, ✕ fecha.
- Copiar: selecione e Ctrl+C (ou botão direito). Colar: Ctrl+V (ou botão direito sem seleção).
  Quando o programa remoto captura o mouse (ex.: agy), segure Shift para selecionar.

## Requisitos
Node 20+, gcloud, ssh.exe (Cliente OpenSSH) e a chave `~\.ssh\google_compute_engine`.
O terminal embutido usa `@lydell/node-pty` (binário pronto para Windows, sem compilar).

## Espelho do PC (cópia direta, sem Git)
Em **Projetos > Editar**, defina a pasta do projeto no PC. Por conta: **Enviar do PC**, **Trazer resultados**, **agy no espelho**.
- Vai só o que mudou desde o último envio; segredos (`.env`, `tripo-keys.json`...) ficam fora, salvo **Com segredos…**.
- A VM recebe `.cshub/` com `git diff`, `git status` e branch/commit gerados no PC (o espelho não é um repositório git).
- Resultados voltam para `<resultados>\<conta>\<data-hora>\` (fora do worktree): `arquivos\`, `mudancas.txt`, `alteracoes.patch`.

## cshub (linha de comando)
```powershell
C:\Users\DEV\Documents\cloudshell-app\cshub.cmd ajuda
cshub enviar <projeto> <conta> [--tudo] [--com-segredos] [--forcar]
cshub trazer <projeto> <conta>
cshub caminho <projeto> <caminho> [--conta <conta>]    # sempre devolve com /
```
Adicione `C:\Users\DEV\Documents\cloudshell-app` ao PATH para usar só `cshub`. Todas aceitam `--json`.

## Tarefas na nuvem (agy -p)
```powershell
cshub tarefa <projeto> <conta> --arquivo tarefa.md [--leitura | --livre]   # devolve o ID
cshub esperar <projeto> <conta> <ID> --trazer                               # 0 ok, 4 ainda rodando, 5 morreu
cshub resultado | tarefas | cancelar ...
```
A Skill para o orquestrador está em `skill\cloudshell-hub\SKILL.md`. Copie a pasta `cloudshell-hub` para `C:\Users\DEV\.claude\skills\` (ou para `.claude\skills\` dentro do projeto).
