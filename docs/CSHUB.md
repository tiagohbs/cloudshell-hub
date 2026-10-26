# Referência do `cshub`

> Gerado por `npm run docs` a partir do texto de ajuda da CLI (`cshub ajuda`). Não edite à mão.

```text
cshub — Cloud Shell Hub pela linha de comando

CONTAS
  cshub contas                       contas: [LIVRE] ou [BLOQUEADA: motivo] (em-uso-no-pc, reserva-manual, sem-cota-gemini, sem-horas-vm, sem-login), VM, horas 7d
  cshub login [<apelido>]            loga uma conta pelo terminal (link + código), guarda a config isolada em ~/.cshub/gcloud/<e-mail>,
        [--importar <e-mail>]        cria o projeto GCP cshub-<conta> (rótulo cshub=1) e cadastra a conta. --importar: só cadastra um login já guardado
  cshub login --link [--abrir]       sem terminal interativo (agentes), passo 1: mostra o link de login do Google e deixa um ajudante esperando o código;
                                     --abrir tenta abrir o link no navegador (no celular: termux-open-url), sem precisar copiar
  cshub login --codigo <código> [<apelido>]   passo 2: entrega o código, guarda a config isolada, cria o projeto e cadastra a conta
  cshub preparar <conta>             acorda a VM e aplica no agy dela as preferências do cshub (hoje: toolPermission=always-proceed; não sobrescreve o que você já escolheu)
        [--permissao <modo>]         força outro valor de toolPermission nesta conta (ex.: o que o agy aceitar no lugar de always-proceed)
        [--confiar <pasta>]          marca uma pasta da VM como confiável (trustedWorkspaces)
  cshub preparar --padrao [<modo>|nenhum]   mostra ou muda o padrão para contas novas ("nenhum": o cshub não mexe no agy)
        [--confiar <a,b>]            com --padrao, troca as pastas da VM que o cshub marca como confiáveis em contas novas (padrão: ~/espelho; a pasta pessoal sempre entra)
  cshub agy-login --todas            confere o login do agy em todas as contas cadastradas (acorda as VMs; gasta cerca de 1% da cota de 5 h de cada uma)
  cshub agy-login <conta>            confere se o agy da VM está logado (--verificar, padrão). O login do agy é separado do gcloud
        [--link [--abrir]]           passo 1, sem terminal interativo: mostra o link inteiro (sem quebras) do login do agy; --abrir abre no navegador
        [--codigo <código>]          passo 2: digita o código na VM e confere o login
  cshub zerar [--skill] [--vms] [--projetos-gcp] [--tudo] [--conta <conta>] [--confirmar] [--forcar]
        volta ao zero. SEM --confirmar só simula (e só olha VMs já ligadas). --skill: tira a skill instalada; --vms: apaga ~/espelho e ~/.cshub das VMs
        (o login e as configurações do agy ficam); --projetos-gcp: apaga os projetos com rótulo cshub=1 (o Google guarda 30 dias).
        Contas, logins locais e resultados no PC não são tocados. --forcar: limpa mesmo com tarefa rodando
  cshub remover <conta> [--simular]  tira a conta do cadastro e apaga o login local (~/.cshub/gcloud/<e-mail>). --simular só mostra o que faria.
        [--apagar-projeto]           também apaga o projeto GCP cshub-<conta> (só se tiver o rótulo cshub=1). A VM e o login do agy nela ficam
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
  cshub projeto adicionar <nome> --pasta-pc <pasta> [--excluir <a,b,c>] [--repo <url>] [--base main]
        cadastra um projeto (espelho sem Git; --repo só para o fluxo com Git). --excluir ACRESCENTA padrões à lista padrão (node_modules, dist, build, .git...), ex.: target,.scratchpad
  cshub projeto remover <nome>       tira o projeto do cadastro (não apaga a pasta do PC, o espelho na VM nem os resultados)
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
