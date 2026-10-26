# Cloud Shell Hub

App desktop (Electron + React) e linha de comando (`cshub`) para usar **várias contas do Google Cloud Shell** e **delegar tarefas** a agentes (`agy`/Gemini) que rodam nas VMs, enquanto um orquestrador (você, o Claude, o Maestri…) acompanha e confere o resultado.

> **English summary:** Windows desktop launcher + cross-platform CLI (`cshub`: Windows, Linux, macOS, Android/Termux) that manages many Google Cloud Shell accounts (isolated gcloud login per account, one `cshub-<account>` GCP project each), mirrors a local project to each VM (no Git needed), runs `agy` tasks there with a watchdog (stall/timeout/quota/login detection), brings the results back, and can reset everything it set up (`cshub zerar`). Docs are in Portuguese. MIT license with a credit notice.

## O que faz

- **Contas**: cadastro pelo app ou pelo terminal (`cshub login`, com link e código; funciona até para agentes sem terminal interativo). Cada conta tem o próprio login do gcloud (`~/.cshub/gcloud/<e-mail>/`, nada se mistura) e o próprio projeto GCP `cshub-<conta>`. Login do `agy` da VM (`cshub agy-login`), cota do Gemini e estado da VM.
- **Preparação do agy**: no primeiro uso de cada VM o `cshub` grava `toolPermission: always-proceed` e marca `~` e `~/espelho` como confiáveis, sem sobrescrever o que você já escolheu (`cshub preparar` muda o padrão).
- **Terminais**: terminal embutido (xterm + node-pty), lado a lado, ou janela externa.
- **Projetos e espelho**: copia só o que mudou do PC para a VM, sem Git; segredos ficam de fora; resultados voltam para uma pasta separada.
- **Tarefas**: `cshub tarefa` dispara o agente na VM com um vigia (travou, estourou o tempo, acabou a cota, caiu o login, falha de rede) e exige um `RESUMO.md` nas tarefas que editam arquivos.
- **Limpeza**: `cshub remover` (uma conta) e `cshub zerar` (skill, espelhos das VMs, projetos GCP), sempre simulando antes de apagar.
- **Skill para orquestradores**: `skill/cloudshell-hub/SKILL.md` ensina outro agente a usar tudo isso (botão **Instalar skill** no app ou `cshub skill instalar`). Testada com um modelo pequeno seguindo só a skill: cadastro de conta, delegação e limpeza.
- **Avisos**: o app notifica no Windows quando uma tarefa termina, falha ou a VM some.

## Requisitos

- **App**: Windows 10/11, Node 20+, `gcloud` (Google Cloud CLI), `ssh.exe` (Cliente OpenSSH) e Chrome (login das contas pelo app).
- **Só o CLI**: Windows, Linux, macOS ou Android (Termux), com Node 20+, `gcloud` e `ssh`. Veja abaixo.
- **Cada conta Google, uma vez, no navegador**: aceite os Termos de Serviço em https://console.cloud.google.com e abra https://shell.cloud.google.com até o terminal carregar. Sem isso o projeto da conta não é criado e a VM não liga.

## Só o CLI (`cshub`), sem o app

Funciona em Windows, Linux e macOS e é o que um agente de IA usa. Precisa de Node 20+, `gcloud` e `ssh`/`ssh-keygen` (cliente OpenSSH). O Chrome não é necessário: o login mostra um link para abrir em qualquer navegador.

```bash
git clone https://github.com/tiagohbs/cloudshell-hub.git
cd cloudshell-hub
npm ci --omit=dev             # só as dependências do CLI (poucos segundos; não baixa o Electron)
ln -s "$PWD/cshub" ~/.local/bin/cshub   # Linux/macOS; no Windows ponha esta pasta no PATH (cshub.cmd)
cshub ajuda
```

Primeiros passos:

```bash
cshub login                      # uma vez por conta (ou --link e --codigo, para agentes sem terminal interativo)
cshub contas                     # cada conta deve aparecer [LIVRE]
cshub agy-login --todas          # confere o login do agy de cada VM (gasta ~1% da cota de 5 h de cada uma)
cshub skill instalar             # para agentes de IA (Claude etc.)
```

Agentes que chamam o `cshub` devem gravar a saída em arquivo (`--json > arquivo`), **não** passar por `| tail`: um processo que demora segura o pipe e trava o terminal do agente. O fluxo completo está em `skill/cloudshell-hub/SKILL.md`.

### Android (Termux)

Um script instala tudo o que é automático: Ubuntu dentro do Termux (`proot-distro`), Node, `gcloud`, o `cshub` (com `npm test` e a skill) e, se pedir, Claude Code (`--claude`), Colab CLI (`--colab`) e mais um repositório seu (`--repo dono/nome`, depois de `gh auth login`). Use o Termux do F-Droid e deixe a bateria dele "sem restrições".

```bash
curl -fsSL https://raw.githubusercontent.com/tiagohbs/cloudshell-hub/main/scripts/instalar-android.sh -o instalar-android.sh
bash instalar-android.sh --simular     # mostra o que faria
bash instalar-android.sh               # instala (pode rodar de novo: pula o que já existe)
```

A primeira instalação leva ~30 a 45 min (o `gcloud` sozinho, ~13 min) e só acontece uma vez: o script avisa a cada minuto que continua trabalhando e, rodado de novo, pula o que já existe. Os logins ficam com você, no navegador: `cshub login` (uma vez por conta) e `cshub agy-login --todas`. O script termina com um resumo e a lista desses comandos.

## Rodar

```powershell
git clone https://github.com/tiagohbs/cloudshell-hub.git
cd cloudshell-hub
npm install
npm start
```

### Se o app não abrir ("Electron failed to install correctly")

O download do binário do Electron falhou (antivírus, proxy ou rede). O `npm start` já tenta de novo sozinho; se não resolver, rode `npm run verificar` e siga as instruções que ele mostra. Resumo: `node node_modules\electron\install.js`; com proxy, defina `ELECTRON_MIRROR`; ou copie `node_modules\electron\dist` e `path.txt` de outra instalação da mesma versão.

## Gerar o executável portátil

```powershell
npm run dist      # saída em .\release
npm run auditar   # confere que nada pessoal foi para o repositório
```

O instalador **não leva contas nem projetos**: só `dist`, `electron`, a skill e o `package.json`. Contas e projetos ficam fora do app (veja [Onde ficam os dados](docs/COMO-FUNCIONA.md#onde-ficam-os-dados)), então cada pessoa começa do zero.

## Instalação guiada por IA (para quem não programa)

Não quer mexer no terminal? Peça a um assistente com acesso ao seu computador (Claude Code, Claude no desktop com acesso a pastas, Codex etc.) que faça tudo. Copie e cole, trocando nada:

> Prepare tudo o que eu preciso para usar o Cloud Shell Hub e instale todas as dependências do projeto a partir deste link: https://github.com/tiagohbs/cloudshell-hub
>
> Faça o seguinte: confira se tenho Node.js 20 ou mais novo, Git, Google Cloud CLI (gcloud), Cliente OpenSSH do Windows e Chrome; instale o que faltar; clone o projeto em uma pasta minha; rode `npm install` e `npm start`. Se o Electron não abrir, rode `npm run verificar` e resolva.
>
> Caso algo precise da minha interferência (login no Google, aceitar termos, permissão de administrador, download bloqueado, etc.), pare, me avise e me dê o passo a passo, com linguagem simples, do que devo fazer. Depois que eu concluir, continue de onde parou. No fim, me diga o que ficou pronto e o que ainda depende de mim.

Se você só quer **usar** o app, o mais fácil é baixar o `.exe` portátil na página de [Releases](https://github.com/tiagohbs/cloudshell-hub/releases), sem instalar Node nem rodar comandos.

## Uso rápido

1. Cadastre as contas: aba **Contas** > **Adicionar contas** no app, ou `cshub login` no terminal (uma vez por conta).
2. Cadastre o projeto: aba **Projetos**, ou `cshub projeto adicionar <nome> --pasta-pc <pasta> [--excluir target,.cache]` (confira o tamanho da pasta: pastas de build grandes devem ir no `--excluir`).
3. Delegue uma tarefa:

```bash
cshub escolher --json                                   # melhor conta livre
cshub enviar <projeto> <conta>                          # espelho do PC para a VM (só o que mudou)
cshub tarefa <projeto> <conta> --arquivo tarefa.md --leitura --cota-minima 10 --json   # devolve o ID
cshub esperar <projeto> <conta> <ID> --trazer --minutos 15
cshub aplicar <ID> <pasta-do-projeto> --simular         # confere antes de aplicar o que a nuvem editou
```

4. Limpe quando quiser (sempre simula antes; só apaga com `--confirmar`):

```bash
cshub zerar --vms --skill                # mostra o que apagaria
cshub zerar --vms --skill --confirmar    # apaga espelhos e ~/.cshub das VMs e a skill (contas e logins ficam)
cshub remover <conta> --simular          # tirar uma conta (o projeto GCP só com --apagar-projeto)
```

Todos os comandos: [docs/CSHUB.md](docs/CSHUB.md) (ou `cshub ajuda`).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/COMO-FUNCIONA.md](docs/COMO-FUNCIONA.md) | Arquitetura, fluxo de uma tarefa, espelho, vigia, segurança, dados |
| [docs/CODIGOS-DE-ERRO.md](docs/CODIGOS-DE-ERRO.md) | Todos os códigos `CSH-ÁREA-n` e códigos de saída do `cshub` |
| [docs/CSHUB.md](docs/CSHUB.md) | Referência da linha de comando |
| [docs/EXEMPLO-REGRAS-DO-PROJETO.md](docs/EXEMPLO-REGRAS-DO-PROJETO.md) | Modelo de regras para o agente seguir no seu projeto |
| [AGENTS.md](AGENTS.md) | Guia para quem (ou qual IA) vai mexer no código |

`docs/CODIGOS-DE-ERRO.md` e `docs/CSHUB.md` são gerados: rode `npm run docs` depois de mudar `electron/errors.js` ou a ajuda do `cshub`.

**Testes:** `npm test` (suíte em `test/`, sem rede e sem contas: HOME temporária e `gcloud` falso). Cobre as travas de apagar (prefixo e rótulo dos projetos, simulação), a mesclagem do `settings.json` do agy, o encerramento de processos no estouro de prazo e se os docs gerados estão em dia. Antes de publicar: `npm run auditar`.

## Aviso importante

Usar várias contas para somar cotas gratuitas pode violar os termos do Google Cloud Shell, do Gemini ou do Antigravity. O projeto é uma ferramenta de organização; **o uso e o risco são seus**. Leia os termos dos serviços antes de usar.

## Privacidade e segurança

- Nada é enviado a servidores do autor. O app fala só com o Google (gcloud/Cloud Shell) e com suas VMs.
- Contas e projetos ficam em arquivos na sua pasta de usuário. O app não guarda senhas próprias; os **logins do gcloud de cada conta** (gerados pelo próprio gcloud) ficam em `~/.cshub/gcloud/<e-mail>/`, com acesso só seu. Trate essa pasta como senha: nunca copie, espelhe nem comite.
- O padrão `always-proceed` faz o `agy` da VM executar ferramentas sem pedir aprovação. A VM só tem o espelho, mas tem as credenciais do gcloud daquela conta: se preferir, troque com `cshub preparar --padrao <modo>` ou `--padrao nenhum`.
- Segredos (`.env`, `*.pem`, chaves…) não vão no espelho, salvo se você mandar com **Com segredos…**.

## Agradecimentos

Obrigado ao pessoal da **MaxVision Labs** pela parceria.

## Licença e créditos

[MIT](LICENSE) com **citação de créditos**: uso livre (pessoal, comercial, modificar, redistribuir), desde que mantenha o aviso de copyright e a linha

> Baseado no Cloud Shell Hub de [tiagohbs](https://github.com/tiagohbs/cloudshell-hub)

na documentação ou numa tela "Sobre" do seu derivado.

Dependências de terceiros: Electron (MIT), React (MIT), Vite (MIT), xterm.js (MIT), node-pty / @lydell/node-pty (MIT), node-tar (ISC).
