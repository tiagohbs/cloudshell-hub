---
name: cloudshell-hub
description: Delegar trabalho para agentes agy nas VMs do Google Cloud Shell (outras contas, cota e memória separadas do PC) usando o comando cshub. Use quando o usuário pedir para mandar uma tarefa para a nuvem, dividir trabalho entre contas ou subagentes, aliviar a memória do PC, ou trazer resultados da nuvem.
---

# Cloud Shell Hub: delegar trabalho para a nuvem

Cada conta Google cadastrada tem uma VM do Cloud Shell com o `agy` (Gemini). Ela roda fora do PC (que costuma ter pouca memória). Nas contas livres (as que não são a do PC), a cota do Gemini também é separada da dos agentes que rodam no PC. O projeto chega lá por um **espelho**: uma cópia direta da pasta do PC, sem Git e sem push. O que o agente produz volta para uma **pasta de resultados fora do worktree**, para revisão.

Comando: o `cshub.cmd` da pasta do Cloud Shell Hub (ou só `cshub`, se a pasta estiver no PATH). Use `--json` sempre que for ler a saída num script ou num subagente. `cshub ajuda` lista tudo.

**As regras do projeto vêm antes desta skill.** Esta skill é o manual genérico do comando. Se o projeto tiver um documento próprio de uso da nuvem (por exemplo `docs/NUVEM_CLOUDSHELL.md`; há um modelo em `docs/EXEMPLO-REGRAS-DO-PROJETO.md` no repositório do Cloud Shell Hub), leia-o primeiro: ele define contas permitidas, onde salvar as tarefas e o papel da nuvem no fluxo do projeto.

## Quando usar
- Leitura e análise de código, pesquisa no projeto, revisões, relatórios.
- Medições ou processamentos pesados que derrubariam o PC.
- Partes independentes de um trabalho maior, em paralelo (uma conta por parte).

## Quando NÃO usar
- Quando a tarefa depende de algo que só existe no PC naquele momento e não foi enviado (estado de outro agente, arquivos fora do projeto).
- Quando precisa de segredos (`.env`, chaves), login no jogo, commit ou push.
- Quando é rápido e leve: fazer aqui é mais simples.
- **Para julgar** (provas, fotos, aprovação de rodada): os juízes já definidos nas regras do projeto continuam sendo os padrão. Usar a nuvem como juiz é decisão do orquestrador, caso a caso, conforme o uso mostrar que funciona. Se o projeto exigir calibração para o juiz, aplique a mesma à nuvem.

## Regras que não se quebram
1. **Segredos:** nunca use `--com-segredos` sem o usuário autorizar explicitamente, naquela tarefa específica.
2. **Modo livre:** nunca use `--livre` (o `agy` executa comandos sem pedir permissão) sem autorização. A VM tem as credenciais do gcloud daquela conta. O padrão (edita arquivos) basta para quase tudo; para só analisar, use `--leitura`. O `--leitura` é uma instrução ao agente ("não altere arquivos do projeto, escreva só em `.saida/`"), não um bloqueio técnico. Isso é aceitável porque o agente só mexe no espelho, que é uma cópia, e tudo volta para a pasta de resultados para revisão. Evite `--plano`: o modo plano do `agy` gasta uma rodada extra pedindo aprovação, sem ninguém para responder.
3. **Nada entra no worktree sozinho:** os resultados ficam em `<resultados>\<conta>\...`. Revise e aplique à mão o que o usuário aprovar. Nunca `git add -A`.
4. **Só envie com a árvore parada:** nenhum agente editando a pasta espelhada, nada compilando, nenhuma foto sendo tirada (a mesma regra do graphify). Além de poupar a memória do PC, isso evita copiar um arquivo pela metade. Se aparecer "Pouca memoria livre", espere; `--forcar` só com motivo.
5. **Caminhos:** o agente da nuvem não conhece `C:\...`. Use caminhos relativos à raiz do projeto, ou `cshub caminho <projeto> <caminho do PC> --conta <conta>`, que devolve sempre com `/`.
6. **Uma tarefa de edição por conta e projeto ao mesmo tempo.** Duas tarefas na mesma conta mexendo nos mesmos arquivos se atropelam.
7. **Duas cotas por conta, e as duas importam:**
   - **Cota do Gemini (agy):** limite semanal e limite de 5 horas, medidos em porcentagem restante. Ela acaba rápido: o consumo é proporcional ao custo dos tokens, e há relatos de contas Pro travadas por dias. Veja a seção "Cota do Gemini" abaixo.
   - **Horas de VM do Cloud Shell:** cerca de 50 h por semana. `cshub contas` mostra as horas dos últimos 7 dias (estimativa).
   Não deixe tarefas esquecidas rodando.
8. **Quais contas ficam bloqueadas.** Só três situações bloqueiam uma conta; todas as outras estão livres para a nuvem. `cshub contas` mostra cada conta como `[LIVRE]` ou `[BLOQUEADA: motivo]`:
   - **`em-uso-no-pc`:** a conta que os agentes locais do orquestrador usam agora no PC (por exemplo no Maestri). Ela muda quando a cota acaba e o usuário troca; a cada troca rode `cshub local <conta ou e-mail>`, que bloqueia a nova e libera a anterior. `cshub local`, sem argumento, mostra qual está marcada.
   - **`sem-cota-gemini`:** cota do Gemini marcada como esgotada, ou com menos de 5% restante (semanal ou 5 h) na última medição.
   - **`sem-horas-vm`:** a VM já usou 47 h ou mais das 50 h da semana (estimativa do `cshub`).
   - Também bloqueiam `sem-login` (conta sem login no gcloud) e `reserva-manual` (`cshub reservar <conta> "<motivo>"`, só se alguém criou; `cshub liberar <conta>` remove).
   O `cshub tarefa` recusa conta em uso no PC ou reservada (`--usar-reservada`, só com autorização do usuário e os agentes donos parados), conta esgotada, e conta sem horas de VM (`--ignorar-horas`, só com motivo). `cshub escolher` lista as contas livres da melhor para a pior (VM ativa, mais cota, menos horas, menos tarefas); sai com código 5 se não há nenhuma.
9. **Nunca ative créditos pagos, cobrança extra ("overages") ou AI credits**, mesmo que o `agy` sugira. Cota esgotada se resolve trocando de conta ou esperando a renovação.

## Cadastrar ou refazer o login de uma conta
Use quando `cshub contas` vem vazio, quando uma conta aparece `sem-login` ou quando uma tarefa sai com código 9. **O login é sempre do usuário**: o Google exige validação no navegador, e nenhum agente consegue fazê-lo sozinho. Funciona em qualquer agente, porque os dois passos são comandos comuns com `--json`, sem terminal interativo.

1. **Passo 1, o link:** `cshub login --link --json` devolve `{"ok":true,"link":"https://accounts.google.com/…"}`. Entregue o link ao usuário e peça que entre **com a conta que quer cadastrar** (cuidado com o navegador já logado em outra conta). Um ajudante fica esperando o código por até 10 min; se passar disso, rode `--link` de novo.
2. **Passo 2, o código:** o usuário cola o código que o Google mostrou. Rode `cshub login --codigo "<código>" [<apelido>] --json`. O código vale **uma vez só**: se falhar, volte ao passo 1. Sem apelido, vale a parte do e-mail antes do `@`.
3. O `cshub` faz o resto sozinho: guarda o login em `~/.cshub/gcloud/<e-mail>/` (uma pasta por conta, nada se mistura nem toca o gcloud global), cria o projeto GCP **`cshub-<parte do e-mail antes do @>`** com o rótulo `cshub=1` (ou reaproveita o que já tem o rótulo) e cadastra a conta em `~/.cloudshell-accounts.json` com o campo `Project`.
4. **Conferir:** `cshub contas` deve mostrar a conta `[LIVRE]`. Depois `cshub acordar <conta>`; se a conta nunca abriu o Cloud Shell, peça ao usuário para abrir shell.cloud.google.com com ela uma vez.

**Login do agy na VM (separado do gcloud).** O `agy` de cada VM tem login próprio. `cshub agy-login <conta>` confere (código de saída 9 e "SEM login" se não estiver; gasta cerca de 1% da cota de 5 h). Para logar sem terminal interativo, também em dois passos:
1. `cshub agy-login <conta> --link --json` devolve o link do Google **inteiro, em uma linha** (nunca copie o link da tela do terminal: as quebras de linha causam "Bad Request 400"). Entregue ao usuário e peça que entre **com a conta daquela VM**.
2. O usuário cola o código; rode `cshub agy-login <conta> --codigo "<código>" --json`. O `cshub` digita o código na VM e confere o login. O código vale uma vez só; se falhar, volte ao passo 1.
Se o usuário preferir um terminal de verdade: `cshub ssh <conta> --agy` (no Maestri: `maestri recruit "Login-<conta>" --preset "Shell" --command "cshub ssh <conta> --agy"`; `maestri ask "Login-<conta>" --raw "\n"` escolhe a opção 1, Google OAuth). Não feche o painel antes do prompt normal do agy.

**Preparação do agy (permissão de ferramentas).** No primeiro uso da VM de uma conta (`cshub acordar`, `tarefa`, `preparar`...), o `cshub` grava no `~/.gemini/antigravity-cli/settings.json` da VM `"toolPermission": "always-proceed"` (o agy não pede aprovação a cada ferramenta, necessário para tarefas em segundo plano) e marca como confiáveis a pasta pessoal e `~/espelho` (onde ficam os projetos espelhados). Ele só acrescenta: não sobrescreve um `toolPermission` que a pessoa já escolheu, não toca nas credenciais e recusa um `settings.json` ilegível. **Diga isso ao usuário ao cadastrar uma conta e lembre que ele pode mudar:**
- `cshub preparar --padrao` mostra o padrão para contas novas; `cshub preparar --padrao <modo>` muda; `cshub preparar --padrao nenhum` faz o `cshub` não mexer no agy.
- `cshub preparar <conta> --permissao <modo>` muda só uma conta (aceita o valor que o agy aceitar; só `always-proceed` está confirmado). `--confiar <pasta>` marca outra pasta da VM como confiável.
- O modo auto do Shift+Tab é da sessão do agy e não é gravado pelo `cshub`.
- `always-proceed` equivale, na prática, a aprovar tudo na VM. Como a VM é descartável e só tem o espelho, o padrão é aceitável; se o usuário não quiser, ofereça `--padrao nenhum` ou outro modo.

Variações: `cshub login [<apelido>]` faz tudo de forma interativa num terminal de verdade (link e código no mesmo comando). `cshub login --importar <e-mail>` só cadastra um login que já está guardado em `~/.cshub/gcloud/<e-mail>/`.

Cuidados:
- Nunca copie, espelhe, comite nem cole em tarefa nada de `~/.cshub/gcloud/` ou o código de verificação: a pasta dá acesso à conta. Não aponte `cshub pasta-pc` para a pasta pessoal.
- Não crie projeto à mão nem use `gen-lang-client-…` (do Gemini): o projeto de cada conta é o `cshub-<conta>`.
- Não use `pkill -f`: a linha de comando do ajudante e do `agy` contém textos que casam com o padrão e você mata o próprio shell.
- Se o projeto não puder ser criado, o cadastro termina com um `aviso`; relate ao usuário em vez de insistir. O caso mais comum é conta nova que ainda não aceitou os **Termos de Serviço do Google Cloud**: o usuário abre https://console.cloud.google.com com aquela conta, aceita os termos, e você roda `cshub login --importar <e-mail>` para criar o projeto sem novo login. Outras causas: limite de projetos da conta ou política da organização.

## Excluir uma conta
`cshub remover <conta> --simular` mostra o que seria feito, sem alterar nada: **rode sempre primeiro e mostre ao usuário**. Só rode sem `--simular` com a confirmação dele, para aquela conta. Remover tira a conta do cadastro e apaga o login local (`~/.cshub/gcloud/<e-mail>/`, depois de revogar). **Ficam:** a VM do Cloud Shell, o login do `agy` nela, os resultados em `~/Documents/<projeto>-nuvem` e o projeto GCP `cshub-<conta>`. `--apagar-projeto` também apaga o projeto GCP (o Google guarda 30 dias; só apaga se o projeto tiver o rótulo `cshub=1`, senão recusa sem alterar nada): use só se o usuário pedir esse apagamento. Para voltar a usar a conta, cadastre de novo com `cshub login`.

## Cadastrar um projeto
`cshub projetos` lista; `cshub projeto adicionar <nome> --pasta-pc <pasta do PC>` cadastra um projeto para o espelho sem Git (`--repo <url>` só para o fluxo com Git do app); `cshub projeto remover <nome>` tira do cadastro sem apagar a pasta do PC, o espelho na VM nem os resultados. Depois: `cshub enviar <projeto> <conta>`.

## Ciclo padrão (uma tarefa)
0. **Conferir a conta do PC:** confirme que `cshub local` aponta para a conta que os agentes locais estão usando agora. O e-mail aparece no cabeçalho do `agy` no painel deles (`maestri check "<painel>"`); se não der para ver, pergunte ao usuário. Se mudou, rode `cshub local <e-mail>` antes de qualquer outra coisa.
1. **Escolher a conta:** `cshub escolher --json` devolve as contas livres, da melhor para a pior. Para ver o porquê, `cshub contas --json` mostra o estado da VM, as horas de 7 dias, as tarefas rodando, a última cota medida (`cota.gemini.minimo`) e o campo `bloqueio` de cada conta (vazio = livre), sem acordar nenhuma VM. A cota pode estar desatualizada (`medidaHaMin`). Antes de uma tarefa longa, meça de novo a conta escolhida com `cshub cota <conta> --json` (leva uns 20 s e liga a VM se estiver suspensa).
2. **Atualizar o espelho:** `cshub enviar <projeto> <conta> --json`. É incremental (só manda o que mudou) e leva junto o `git diff` e o `git status` do PC em `.cshub/`. Faça isso antes de toda tarefa, para a nuvem ver o estado atual.
3. **Escrever a tarefa** num arquivo `.md`, no lugar que as regras do projeto definem para registrar tarefas. Sem essa definição, use `%TEMP%`, sabendo que ela se perde. Siga o modelo abaixo. Depois:
   `cshub tarefa <projeto> <conta> --arquivo <tarefa.md> [--leitura] --cota-minima <pct> --json` (veja os mínimos na seção "Cota do Gemini"). Guarde o `id`, no formato `T20261009-123456-abc`. Com `--cota-minima`, o `cshub` mede a cota antes e recusa (código 6) se ela estiver abaixo do mínimo. Ele também recusa sozinho uma conta marcada como esgotada.
4. **Esperar e trazer:** `cshub esperar <projeto> <conta> <id> --trazer --json`. Para tarefas médias e longas, acrescente `--vigiar-cota 10 --parar-cota`: a cada 10 minutos o `cshub` mede a cota e, se ela cair abaixo de 10%, cancela a tarefa antes que a conta trave. **Nunca espere sem prazo:** use fatias curtas, `--minutos 15` a `20`, e olhe o código de saída a cada fatia (veja a regra "Espera e falhas" abaixo). Códigos de saída:
   - `0`: concluída. A resposta vem em `resposta`, e os arquivos em `arquivos`.
   - `4`: ainda rodando. Chame `esperar` de novo.
   - `5`: o `agy` morreu (a VM provavelmente reiniciou). Rode `cshub acordar`, depois `cshub enviar` e dispare a tarefa de novo.
   - `6`: cota. Ou ela esgotou durante a tarefa (a conta fica marcada até a renovação), ou caiu abaixo do limite de `--vigiar-cota`. Rode `cshub trazer` para salvar o que já foi feito e continue em outra conta. Não use `--continuar` nesse caso, porque a conversa ficou na conta anterior: descreva na nova tarefa o que já está pronto.
   - `7`: o `agy` ficou **travado** (sem saída e sem CPU por 15 min) ou passou do **tempo máximo** (90 min). O vigia da VM já encerrou a tarefa. `cshub trazer` salva o que existir; dispare de novo menor ou em outra conta.
   - `8`: **falha do servidor ou da rede** do Gemini/Antigravity (500/503, sobrecarga). Em tarefas de leitura o vigia já repetiu até 2 vezes sozinho. Espere alguns minutos ou use outra conta.
   - `9`: a conta **perdeu o login**. Avise o usuário e use outra conta; para refazer o login, siga "Cadastrar ou refazer o login de uma conta" (`cshub login --link`).
   - `10`: o `agy` **deixou testes/benchmarks em segundo plano e parou esperando** (`root agent idle; waiting up to 30m…`), sem entregar. Código 0 sem `RESUMO.md` agora conta como falha. Rode os testes com `cshub rodar` ou redispare mandando executar tudo em primeiro plano.
   - `11`: o `agy` terminou sem escrever o `RESUMO.md`. Confira o que ele editou (`cshub trazer`) antes de aplicar.
   - `12`: (`cshub rodar`) um comando do script **não existe na VM**. O `rodar` já carrega o nvm; se ainda faltar node/npx/ferramenta, o script saiu com 127 ou imprimiu `command not found`, e isso agora conta como falha.
   - `5` também aparece quando a **VM parou ou reiniciou** no meio da tarefa (o vigia morre junto). Rode `cshub acordar`, `cshub trazer` e redispare o que faltou com `cshub tarefa --continuar --ignorar-espelho`.
   - `1`: falhou por outro motivo. Veja `cshub resultado <projeto> <conta> <id>` (resposta e erros).
   Cada falha traz o campo `orientacao` e `codigoErro` (`CSH-…`) no `--json`. Cite o código ao usuário.
   **Espera e falhas (regra):** o vigia na VM garante que a tarefa termina sozinha (travada, tempo máximo, falha classificada), então um `esperar` nunca fica preso para sempre, **desde que você espere em fatias**. Faça um laço: `esperar --minutos 15` → se sair `4`, espere de novo; para qualquer outro código, decida pela tabela. No máximo **2 redisparos por tarefa** (soma de 7, 8 e 5); depois relate ao usuário em vez de insistir. Troque de conta quando o código for 6 ou 9, ou quando 8 se repetir. Para tarefas que editam arquivos, o vigia **não** repete sozinho (evita duplicar mudanças): você decide o redisparo e descreve o que já está pronto. Opções do `cshub tarefa`: `--travado-min` (15), `--max-min` (90), `--repetir`/`--sem-repetir`.
   **Acompanhar sem gastar tokens:** abra um painel de terminal do orquestrador (no Maestri: `maestri recruit "Nuvem-<conta>" --preset "Shell" --command "cshub acompanhar <projeto> <conta> <id> --resumo"`). O painel mostra o fluxo do agente ao vivo (somente leitura: nada digitado chega a ele; Ctrl+C só fecha a janela), espera a tarefa terminar, traz o resultado e sai com o código da tarefa (0, 6, 7, 8, 9…). **Não fique consultando a nuvem em laço:** leia o painel só no fim (`maestri check`, últimas linhas) ou quando precisar decidir. Use `--resumo` no painel que você mesmo vai ler; o usuário pode abrir o fluxo completo (`cshub acompanhar <projeto> <conta>` sem `--resumo`, ou "Ver tarefa ao vivo" no menu ⋯ da conta no app). Para ver o raciocínio passo a passo, dispare a tarefa com `--ao-vivo`. `cshub ao-vivo` mostra só o fluxo, sem esperar nem trazer.
   **Tarefas com scripts longos (testes de mutação, QA, `.mjs`):** o vigia conta como "vivo" tudo o que gasta CPU, escreve arquivos no projeto, cresce o log ou recebe `touch "$CSHUB_PULSO"`. Um teste que só espera rede ou `sleep` por mais de 15 min parece travado. Para esses casos: (a) se for só rodar um comando conhecido, **não gaste cota do Gemini**: use `cshub rodar <projeto> <conta> --comando "node scripts/mutation.mjs" --max-min 240`, que roda o comando na VM com o mesmo vigia e traz a saída com `esperar`/`resultado`; (b) se precisar do agy, dispare com `--max-min` e `--travado-min` maiores (ex.: `--max-min 240 --travado-min 30`) e peça na tarefa que tudo rode **em primeiro plano** (o cabeçalho do `cshub` já proíbe segundo plano e exige `RESUMO.md`). Nunca peça para rodar em segundo plano: o agy para esperando e a tarefa acaba sem entrega.
   **Outros recursos:** `cshub tarefa … --anexo <arquivo>` (repetível) sobe arquivos avulsos (ex.: veredito de um juiz) para `.saida/<id>/anexos/`. O `cshub tarefa` **recusa** disparar se o espelho estiver diferente do PC (rode `cshub enviar`; `--ignorar-espelho` só de propósito). Os `esperar`/`acompanhar` terminam sempre com a linha `CSH-FIM {"code":…,"arquivos":"…","resumo":true}`; leia essa linha em vez de adivinhar pelo prompt. `cshub resultado … --texto` devolve só a resposta final (inclusive com `--ao-vivo`). `cshub aplicar <id> <worktree> [--simular]` copia o resultado para o worktree depois de conferir que cada arquivo local é igual ao enviado (senão recusa tudo); `.saida/` fica fora. Ignore o `duration_seconds` do `saida.json`: `cshub resultado` mostra a duração real.
5. **Revisar:** leia `RESUMO.md` em `<arquivos>\.saida\<id>\`. Confira `mudancas.txt` (A = novo, M = alterado, D = apagado na nuvem) e `alteracoes.patch`, que compara com a versão atual do PC.
6. **Relatar ao usuário** o que foi feito e propor o que aplicar no worktree.

Para continuar a conversa da última tarefa naquela conta (uma correção, por exemplo), use `--continuar` no próximo `cshub tarefa`.

## Modelo de tarefa
```markdown
## Objetivo
<o que precisa ser feito, em uma ou duas frases>

## Contexto
<arquivos e pastas relevantes, com caminhos relativos à raiz do projeto>
<o que o trabalho sem commit do PC mudou, se importar (está em .cshub/git-diff.patch)>

## Entregáveis
- <arquivo ou relatório esperado em .saida/<ID>/>
- <arquivos do projeto que pode alterar, se for o caso>

## Limites
- <o que NÃO mexer>

## Pronto quando
- <critério objetivo de conclusão>
```
O `cshub` acrescenta sozinho, no início, as regras da nuvem (`.saida/<ID>/`, `RESUMO.md`, sem push, sem segredos). Não precisa repeti-las.

## Cota do Gemini
O `cshub cota` lê o painel `/usage` do próprio `agy` (abre o `agy` escondido, digita `/usage`, lê e fecha; não é um pedido ao modelo). Cada conta tem dois grupos, **Gemini** e **Claude e GPT**, cada um com limite semanal e limite de 5 horas. O padrão do `agy` usa o grupo Gemini.

Mínimos recomendados para disparar (o menor entre semanal e 5 horas):
| Tarefa | `--cota-minima` | No `esperar` |
|---|---|---|
| Curta (até ~10 min, poucos arquivos, `--leitura`) | 10 | nada extra |
| Média (até ~30 min) | 25 | `--vigiar-cota 10 --parar-cota` |
| Longa (mais de 30 min, muitos arquivos, edições) | 40 | `--vigiar-cota 10 --parar-cota` |

Referência medida (Gemini 3.8 Flash, outubro de 2026): uma tarefa curta de leitura, de cerca de 2,5 minutos, gastou **≈ 1% da janela de 5 horas** e **≈ 0,2% da semanal**. A janela de 5 horas é a que aperta primeiro, cerca de 6 vezes mais rápido que a semanal.

- Prefira várias tarefas menores a uma gigante: além de gastar menos de uma vez, uma interrupção perde menos trabalho.
- Se a semanal estiver baixa (menos de 30%), guarde essa conta para tarefas curtas.
- Não meça a cota de todas as contas o tempo todo: `cshub cota` liga VMs suspensas. Use o valor guardado em `cshub contas` para escolher e meça de novo só a conta que vai receber a tarefa.
- Depois de uma tarefa grande, `cshub cota <conta>` mostra quanto ela custou, o que ajuda a calibrar as próximas.

## No Maestri: a espera vai para um painel próprio
O Claude do Maestri tem limite de 10 minutos por comando em primeiro plano, e comandos em segundo plano podem ser mortos por falta de memória. Por isso, a espera de tarefas não deve rodar na sessão do Maestro:
1. Dispare a tarefa normalmente (`cshub tarefa … --json`), que é rápido.
2. Crie um painel de espera, com nome fixo por conta:
   `maestri recruit "Nuvem-<conta>" --preset "Shell" --command "cshub esperar <projeto> <conta> <id> --trazer --vigiar-cota 10 --parar-cota --json"`
3. Acompanhe com `maestri check "Nuvem-<conta>"`. O resultado final é a última linha em JSON, com `ok`, `code`, `resposta`, `logs` e `arquivos`.
4. Quando terminar, feche com `maestri dismiss "Nuvem-<conta>"`.
5. Para uma tarefa curta, dá para esperar na própria sessão em blocos: `cshub esperar … --minutos 9 --json`, repetindo enquanto o código for 4.

O usuário acompanha pelo canvas. Para ver o `agy` trabalhando ao vivo, há também `cshub ssh <conta> --espelho <projeto> --agy` num painel. Ele serve só para olhar: a tarefa disparada roda à parte, em segundo plano na VM.

## Paralelismo com subagentes
- Divida o trabalho em partes independentes (pastas ou arquivos diferentes) e dê **uma conta a cada subagente**.
- Cada subagente roda o ciclo padrão na própria conta e devolve: `id`, código de saída, resposta e as pastas de `logs` e `arquivos`.
- Um `cshub esperar` por conta pode rodar ao mesmo tempo.
- O orquestrador junta os resultados. Se duas contas alteraram o mesmo arquivo, mostre o conflito ao usuário em vez de escolher sozinho.
- Antes de começar, rode o `cshub enviar` para todas as contas do lote, em sequência (não em paralelo), para não pesar no PC.

## Outros comandos
- `cshub tarefas <projeto> <conta>`: lista as tarefas (concluída, falhou, cancelada, rodando, parou).
- `cshub cancelar <projeto> <conta> <id>`: interrompe uma tarefa.
- `cshub trazer <projeto> <conta>`: traz tudo o que mudou no espelho desde o último envio.
- `cshub cota [<conta>]`: mede a cota do Gemini (sem conta, mede todas as VMs ativas).
- `cshub escolher`: contas livres, da melhor para a pior.
- `cshub local [<conta ou e-mail>]`: marca a conta em uso no PC, que fica bloqueada, e libera a anterior. Use `--nenhuma` para desmarcar.
- `cshub reservar <conta> "<motivo>"` e `cshub liberar <conta>`: reservas manuais.
- `cshub pasta-pc <projeto> <pasta>`: aponta o espelho para outra pasta do PC, como o worktree da rodada atual. O próximo `enviar` reenvia o que for diferente e apaga na nuvem o que não existe na pasta nova.
- `cshub acordar <conta>`: liga a VM e confirma o acesso.
- `cshub ssh <conta> --espelho <projeto> --agy`: abre o `agy` interativo da nuvem no terminal atual (por exemplo, num painel do Maestri, para o usuário acompanhar).

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "O espelho ainda nao foi enviado" | `cshub enviar <projeto> <conta>` |
| "Pouca memoria livre no PC" | Esperar o trabalho pesado do PC terminar e tentar de novo |
| "A conexao caiu enquanto esperava" | A tarefa continua na VM: rode `cshub esperar` de novo |
| Código 7 (travada / tempo máximo) | `cshub trazer`; redisparar com tarefa menor ou em outra conta |
| Código 8 (servidor / rede) | Esperar alguns minutos e redisparar; se repetir, outra conta |
| Código 9 (sem login) | Avisar o usuário; usar outra conta |
| Código 5 / "o agy parou sem terminar" | `cshub acordar`, `cshub enviar` e disparar de novo |
| "A conta … esta reservada" | Escolher outra conta (`cshub escolher`). Só liberar com autorização do usuário |
| "A VM de … ja usou … h" | Escolher outra conta; `--ignorar-horas` só com motivo |
| Código 6 / "Cota insuficiente" ao disparar | Escolher outra conta com mais cota, ou dividir a tarefa |
| Código 6 / "A cota do agy esgotou" | `cshub trazer`, depois redisparar o que faltou em outra conta |
| "Nao consegui ler o /usage" / "o painel /usage nao apareceu" | O `agy` pode estar pedindo login: pedir ao usuário para abrir **agy no espelho** no app uma vez |
| "O painel /usage não apareceu" ou código 9 com a conta logada no gcloud | O login do **agy** da VM é outro: `cshub agy-login <conta>` para conferir e `--link` / `--codigo` para logar (veja "Cadastrar ou refazer o login de uma conta") |
| Estado `sem-login` em `cshub contas` | Refazer o login: `cshub login --link`, o usuário abre o link e passa o código, depois `cshub login --codigo` (veja "Cadastrar ou refazer o login de uma conta"). No app: Contas > Adicionar ou Editar |
| Resposta do `agy` falando de login ou autenticação | Pedir ao usuário para abrir **agy no espelho** no app uma vez nessa conta |

## Armadilhas do agy (aprendidas em 14/10)
- **Nunca `pkill -f "<texto>"` nem `killall`.** A linha de comando do agy contém o texto da tarefa, então o padrão mata o próprio agente (SIGKILL = código 137). Encerre só pelo PID que ele mesmo criou. O cabeçalho do `cshub` já diz isso, mas reforce na tarefa quando ela subir carga.
- **Segundo plano:** mesmo proibido, o agy às vezes deixa testes rodando e para (`root agent idle; waiting up to 30m…`). Para comando conhecido, use `cshub rodar`. Se quiser cortar a espera, dispare com `--impaciente`: a tarefa é encerrada 3 min depois de parar assim, sem `RESUMO.md`.
- **Edição no lugar errado:** o agy acha o teste pela linha antiga, edita o `it` vizinho e diz que acertou. Exija na tarefa: buscar sempre pelo **nome** e imprimir o nome do `it` que contém a linha editada. Confira o diff antes de aplicar.
- **Mutações:** a lista vem do **orquestrador ou do juiz**, nunca do construtor (ele escolhe mutações que os testes dele já pegam). Peça uma mutação por requisito.
- **Falsos de teste:** um mock precisa reproduzir a semântica real do que o teste vigia (ex.: `onended` só depois do `stop()` assíncrono, buffer com dados de verdade). Diga isso na tarefa.
- **`pasta-pc` vale para o projeto, não para a conta.** Com duas contas editando ao mesmo tempo, trocar a branch do worktree muda o que o próximo `enviar` de qualquer conta leva. O `cshub` agora avisa quando há tarefa de edição rodando em outra conta do mesmo projeto.
- **`aplicar`/`trazer` comparam por conteúdo:** arquivo idêntico ao do PC (só a data mudou, por exemplo mutou e restaurou com `cp`) não entra como alterado; aparece como `=` no `mudancas.txt`.
- **`cshub tarefas` não acorda mais a VM.** Com a VM parada ele avisa; use `--acordar` para listar mesmo assim.

## No PC (Maestri e agy local)
- O agy local **se auto-atualiza** e já ficou quebrado (até `agy --version` saía com 0xC0000005, e os agentes locais deram 401). Rode `cshub saude` antes de depender dele; versões antigas ficam em `%LOCALAPPDATA%\agy\bin\agy.exe.<n>.old`.
- **Terminal aberto antes da reinstalação do agy dá 401 até ser reiniciado.**
- A troca de conta do Maestri (`--account`) funciona para contas que **já têm login salvo no Antigravity do PC** (ex.: as contas 05 e 07). Conta sem login local não sobe. O `cshub local` precisa marcar a conta que está logada no agy do PC.
- No Git Bash, `/clear` vira caminho (`C:/Program Files/Git/clear`). Para comandos com barra, mande pelo PowerShell ou use `MSYS_NO_PATHCONV=1`.

## Limites conhecidos
- A VM é descartada depois de cerca de 40 minutos sem sessão ativa, e tudo fora de `~` se perde. O espelho, as tarefas e os resultados ficam em `~` e sobrevivem. Um `cshub esperar` aberto mantém uma conexão com a VM durante a tarefa, mas ainda não foi confirmado se isso basta para segurar tarefas muito longas.
- A versão do `agy` na nuvem vem da imagem do Google e pode mudar sozinha. Se uma atualização mudar o texto do painel `/usage`, o `cshub cota` passa a falhar com um erro claro. Mesmo assim, a detecção de cota esgotada durante as tarefas continua funcionando, porque depende só da mensagem de erro do `agy`.
- Os mínimos da tabela de cota são um ponto de partida. Ajuste-os conforme o que `cshub cota` mostrar depois das primeiras tarefas reais.
- Fotos e outros arquivos que o Git ignora só estão na nuvem se existirem na pasta do PC que foi espelhada.
