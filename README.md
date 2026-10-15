# Cloud Shell Hub

App desktop (Electron + React) e linha de comando (`cshub`) para usar **várias contas do Google Cloud Shell** e **delegar tarefas** a agentes (`agy`/Gemini) que rodam nas VMs, enquanto um orquestrador (você, o Claude, o Maestri…) acompanha e confere o resultado.

> **English summary:** Windows desktop launcher + CLI (`cshub`) that manages many Google Cloud Shell accounts, mirrors a local project to each VM (no Git needed), runs `agy` tasks there with a watchdog (stall/timeout/quota/login detection), and brings the results back. Docs are in Portuguese. MIT license with a credit notice.

## O que faz

- **Contas**: cadastro (inclusive em lote), login no gcloud com um perfil de Chrome por conta, cota do Gemini, estado da VM.
- **Terminais**: terminal embutido (xterm + node-pty), lado a lado, ou janela externa.
- **Projetos e espelho**: copia só o que mudou do PC para a VM, sem Git; segredos ficam de fora; resultados voltam para uma pasta separada.
- **Tarefas**: `cshub tarefa` dispara o agente na VM com um vigia (travou, estourou o tempo, acabou a cota, caiu o login, falha de rede) e exige um `RESUMO.md` nas tarefas que editam arquivos.
- **Skill para orquestradores**: `skill/cloudshell-hub/SKILL.md` ensina outro agente a usar tudo isso (botão **Instalar skill** no app).
- **Avisos**: o app notifica no Windows quando uma tarefa termina, falha ou a VM some.

## Requisitos

Windows 10/11, Node 20+, `gcloud` (Google Cloud CLI), `ssh.exe` (Cliente OpenSSH) e Chrome (para o login das contas).

## Rodar

```powershell
git clone https://github.com/tiagohbs/cloudshell-hub.git
cd cloudshell-hub
npm install
npm start
```

## Gerar o executável portátil

```powershell
npm run dist      # saída em .\release
npm run auditar   # confere que nada pessoal foi para o repositório
```

O instalador **não leva contas nem projetos**: só `dist`, `electron`, a skill e o `package.json`. Contas e projetos ficam fora do app (veja [Onde ficam os dados](docs/COMO-FUNCIONA.md#onde-ficam-os-dados)), então cada pessoa começa do zero.

## Uso rápido

1. Aba **Contas** > **Adicionar contas** (uma por linha) e faça o login de cada uma.
2. Abra o Cloud Shell de cada conta uma vez pelo link do app e conclua a validação manual do Google.
3. Aba **Projetos**: cadastre a pasta do projeto no PC.
4. Dispare uma tarefa:

```powershell
cshub tarefa <projeto> <conta> "o que o agente deve fazer"
cshub esperar <projeto> <conta>
cshub trazer <projeto> <conta>
cshub aplicar <projeto> <conta>
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

## Aviso importante

Usar várias contas para somar cotas gratuitas pode violar os termos do Google Cloud Shell, do Gemini ou do Antigravity. O projeto é uma ferramenta de organização; **o uso e o risco são seus**. Leia os termos dos serviços antes de usar.

## Privacidade e segurança

- Nada é enviado a servidores do autor. O app fala só com o Google (gcloud/Cloud Shell) e com suas VMs.
- Contas e projetos ficam em arquivos na sua pasta de usuário; o app não guarda senhas nem tokens próprios.
- Segredos (`.env`, `*.pem`, chaves…) não vão no espelho, salvo se você mandar com **Com segredos…**.

## Licença e créditos

[MIT](LICENSE) com **citação de créditos**: uso livre (pessoal, comercial, modificar, redistribuir), desde que mantenha o aviso de copyright e a linha

> Baseado no Cloud Shell Hub de [tiagohbs](https://github.com/tiagohbs/cloudshell-hub)

na documentação ou numa tela "Sobre" do seu derivado.

Dependências de terceiros: Electron (MIT), React (MIT), Vite (MIT), xterm.js (MIT), node-pty / @lydell/node-pty (MIT), node-tar (ISC).
