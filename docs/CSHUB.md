# Referência do `cshub`

> Gerado por `npm run docs` a partir do texto de ajuda da CLI (`cshub ajuda`). Não edite à mão.

```text
cshub — Cloud Shell Hub pela linha de comando

CONTAS
  cshub contas                       contas: [LIVRE] ou [BLOQUEADA: motivo] (em-uso-no-pc, reserva-manual, sem-cota-gemini, sem-horas-vm, sem-login), VM, horas 7d
  cshub acordar <conta>              liga a VM (se suspensa) e confirma o acesso
  cshub local [<conta|e-mail>]       marca a conta em uso no PC (a do agy local do orquestrador); ela fica reservada e a anterior e liberada
        [--nenhuma]                  nenhuma conta em uso no PC
  cshub reservar <conta> "<motivo>"  impede tarefas nesta conta (ex.: cota compartilhada com outro agente)
  cshub liberar <conta>              remove a reserva
  cshub cota [<conta>] [--acordar]     cota do Gemini/agy (semanal e 5 h) lida do /usage; sem conta = todas as ativas
  cshub skill [instalar]             estado da skill no PC (instalada, atualizada?) e instala/atualiza
  cshub skill pasta [<caminho>|--padrao]   mostra ou troca a pasta de skills do seu orquestrador (padrão: ~/.claude/skills)
  cshub escolher                     contas LIVRES (não bloqueadas), da melhor para a pior; saída 5 se nenhuma
  cshub ssh <conta> [--espelho <projeto>] [--agy]
                                     abre um terminal da VM aqui mesmo (para um painel do Maestri)

ESPELHO DO PC (sem Git)
  cshub projetos                     projetos e pastas (PC, espelho, resultados)
  cshub pasta-pc <projeto> [<pasta>] aponta o espelho para outra pasta do PC (ex.: o worktree da rodada); sem pasta, mostra para onde aponta
  cshub enviar <projeto> <conta> [--tudo] [--com-segredos] [--forcar]
  cshub trazer <projeto> <conta>     traz o que mudou no espelho para a pasta de resultados
  cshub aplicar <ID> <worktree> [--simular] [--forcar]   (ou: aplicar <projeto> <conta> <ID> <worktree>)
        confere que cada arquivo local é igual ao enviado (senão recusa tudo), copia, lista o que mudou e deixa .saida/ de fora
  cshub caminho <projeto> <caminho> [--conta <conta>]   traduz caminho do PC para o espelho (sempre /)

COMANDOS E TESTES NA VM (sem agy, sem gastar cota do Gemini)
  cshub rodar <projeto> <conta> (--comando "<comando>" | --arquivo <script.sh>) [--travado-min 30] [--max-min 240]
        roda no espelho, em segundo plano e com o mesmo vigia (ex.: testes de mutação, QA, scripts .mjs). Acompanhe com esperar/resultado.
        Seu script pode escrever em $CSHUB_SAIDA (vai junto dos resultados) e dar sinal de vida com: touch "$CSHUB_PULSO"

TAREFAS (agy -p rodando na VM, em segundo plano)
  cshub tarefa <projeto> <conta> (--arquivo <tarefa.md> | --texto "<tarefa>")
        [--leitura] [--plano] [--livre] [--modelo <m>] [--esforco low|medium|high|max] [--continuar]
        [--ao-vivo]                      grava o fluxo do agente em tempo real (veja com cshub ao-vivo)
        [--travado-min 15] [--max-min 90] [--repetir | --sem-repetir]   vigia na VM (repete falha de servidor só em tarefas que não editam)
        [--anexo <arquivo>]               (repetível) sobe junto para .saida/<ID>/anexos/ na VM
        [--impaciente]                  encerra a tarefa 3 min depois de ela parar esperando segundo plano sem RESUMO.md (economiza VM)
        [--ignorar-espelho]              dispara mesmo com o espelho diferente do PC (padrão: recusa e pede cshub enviar)
        [--cota-minima <pct>] [--ignorar-cota] [--ignorar-horas] [--usar-reservada]
                                     dispara e devolve o ID (padrao: pode editar arquivos)
  cshub esperar <projeto> <conta> <ID> [--minutos 60] [--trazer]
        [--vigiar-cota <pct> [--parar-cota]]   mede a cota a cada 10 min; avisa (ou para) abaixo do limite
  cshub ao-vivo <projeto> <conta> [<ID>]   acompanha a tarefa em tempo real, SOMENTE LEITURA (sem ID: a mais recente)
  cshub acompanhar <projeto> <conta> [<ID>] [--resumo] [--sem-trazer]
        ao-vivo + esperar + trazer o resultado, num comando só, feito para um painel de terminal do orquestrador.
        Termina com o código de saída da tarefa (0, 6, 7, 8, 9…); --resumo imprime só os marcos principais
        A ÚLTIMA linha é sempre: CSH-FIM {"code":0,"arquivos":"…","resumo":true} (leitura por máquina)
  cshub resultado <projeto> <conta> <ID> [--texto]   resposta do agy + logs; --texto devolve só a resposta final (funciona também com --ao-vivo)
  cshub tarefas <projeto> <conta> [--acordar]   lista as tarefas da conta (sem acordar a VM, a menos que use --acordar)
  cshub saude                              confere se o agy deste PC abre (agy --version)
  cshub cancelar <projeto> <conta> <ID>

Opcao geral: --json (saida em JSON, para scripts e agentes)
Codigos de saida: 0 ok, 1 erro, 4 tempo esgotado (ainda rodando), 5 tarefa morreu, 6 cota (esgotada ou abaixo do limite),
  7 agy travado ou tempo maximo da tarefa, 8 falha do servidor/rede do Gemini, 9 conta sem login,
  10 parou esperando segundo plano sem entregar, 11 terminou sem RESUMO.md, 12 comando inexistente na VM (rodar)
```

Códigos de erro: [CODIGOS-DE-ERRO.md](CODIGOS-DE-ERRO.md).
