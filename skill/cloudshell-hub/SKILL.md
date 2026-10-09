---
name: cloudshell-hub
description: Delegar trabalho para agentes agy nas VMs do Google Cloud Shell (outras contas, cota e memória separadas do PC) usando o comando cshub. Use quando o Tiago pedir para mandar uma tarefa para a nuvem, dividir trabalho entre contas ou subagentes, aliviar a memória do PC, ou trazer resultados da nuvem.
---

# Cloud Shell Hub: delegar trabalho para a nuvem

Cada conta Google cadastrada tem uma VM do Cloud Shell com o `agy` (Gemini). Ela roda fora do PC (que tem só 5,8 GB). Nas contas livres (as que não são a do PC), a cota do Gemini também é separada da do Arauto e da Vidente. O projeto chega lá por um **espelho**: uma cópia direta da pasta do PC, sem Git e sem push. O que o agente produz volta para uma **pasta de resultados fora do worktree**, para revisão.

Comando: `C:\Users\DEV\Documents\cloudshell-app\cshub.cmd` (ou só `cshub`, se a pasta estiver no PATH). Use `--json` sempre que for ler a saída num script ou num subagente. `cshub ajuda` lista tudo.

**As regras do projeto vêm antes desta skill.** Esta skill é o manual genérico do comando. Se o projeto tiver um documento próprio de uso da nuvem (no `copianeural`: `docs/NUVEM_CLOUDSHELL.md`), leia-o primeiro: ele define contas permitidas, onde salvar as tarefas e o papel da nuvem no fluxo do projeto.

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
1. **Segredos:** nunca use `--com-segredos` sem o Tiago autorizar explicitamente, naquela tarefa específica.
2. **Modo livre:** nunca use `--livre` (o `agy` executa comandos sem pedir permissão) sem autorização. A VM tem as credenciais do gcloud daquela conta. O padrão (edita arquivos) basta para quase tudo; para só analisar, use `--leitura`. O `--leitura` é uma instrução ao agente ("não altere arquivos do projeto, escreva só em `.saida/`"), não um bloqueio técnico. Isso é aceitável porque o agente só mexe no espelho, que é uma cópia, e tudo volta para a pasta de resultados para revisão. Evite `--plano`: o modo plano do `agy` gasta uma rodada extra pedindo aprovação, sem ninguém para responder.
3. **Nada entra no worktree sozinho:** os resultados ficam em `<resultados>\<conta>\...`. Revise e aplique à mão o que o Tiago aprovar. Nunca `git add -A`.
4. **Só envie com a árvore parada:** nenhum agente editando a pasta espelhada, nada compilando, nenhuma foto sendo tirada (a mesma regra do graphify). Além de poupar a memória do PC, isso evita copiar um arquivo pela metade. Se aparecer "Pouca memoria livre", espere; `--forcar` só com motivo.
5. **Caminhos:** o agente da nuvem não conhece `C:\...`. Use caminhos relativos à raiz do projeto, ou `cshub caminho <projeto> <caminho do PC> --conta <conta>`, que devolve sempre com `/`.
6. **Uma tarefa de edição por conta e projeto ao mesmo tempo.** Duas tarefas na mesma conta mexendo nos mesmos arquivos se atropelam.
7. **Duas cotas por conta, e as duas importam:**
   - **Cota do Gemini (agy):** limite semanal e limite de 5 horas, medidos em porcentagem restante. Ela acaba rápido: o consumo é proporcional ao custo dos tokens, e há relatos de contas Pro travadas por dias. Veja a seção "Cota do Gemini" abaixo.
   - **Horas de VM do Cloud Shell:** cerca de 50 h por semana. `cshub contas` mostra as horas dos últimos 7 dias (estimativa).
   Não deixe tarefas esquecidas rodando.
8. **Quais contas ficam bloqueadas.** Só três situações bloqueiam uma conta; todas as outras estão livres para a nuvem. `cshub contas` mostra cada conta como `[LIVRE]` ou `[BLOQUEADA: motivo]`:
   - **`em-uso-no-pc`:** a conta que o Arauto e a Vidente usam agora no Maestri. Ela muda quando a cota acaba e o Tiago troca; a cada troca rode `cshub local <conta ou e-mail>`, que bloqueia a nova e libera a anterior. `cshub local`, sem argumento, mostra qual está marcada.
   - **`sem-cota-gemini`:** cota do Gemini marcada como esgotada, ou com menos de 5% restante (semanal ou 5 h) na última medição.
   - **`sem-horas-vm`:** a VM já usou 47 h ou mais das 50 h da semana (estimativa do `cshub`).
   - Também bloqueiam `sem-login` (conta sem login no gcloud) e `reserva-manual` (`cshub reservar <conta> "<motivo>"`, só se alguém criou; `cshub liberar <conta>` remove).
   O `cshub tarefa` recusa conta em uso no PC ou reservada (`--usar-reservada`, só com autorização do Tiago e os agentes donos parados), conta esgotada, e conta sem horas de VM (`--ignorar-horas`, só com motivo). `cshub escolher` lista as contas livres da melhor para a pior (VM ativa, mais cota, menos horas, menos tarefas); sai com código 5 se não há nenhuma.
9. **Nunca ative créditos pagos, cobrança extra ("overages") ou AI credits**, mesmo que o `agy` sugira. Cota esgotada se resolve trocando de conta ou esperando a renovação.

## Ciclo padrão (uma tarefa)
0. **Conferir a conta do PC:** confirme que `cshub local` aponta para a conta que o Arauto e a Vidente estão usando agora. O e-mail aparece no cabeçalho do `agy` no painel deles (`maestri check "<painel>"`); se não der para ver, pergunte ao Tiago. Se mudou, rode `cshub local <e-mail>` antes de qualquer outra coisa.
1. **Escolher a conta:** `cshub escolher --json` devolve as contas livres, da melhor para a pior. Para ver o porquê, `cshub contas --json` mostra o estado da VM, as horas de 7 dias, as tarefas rodando, a última cota medida (`cota.gemini.minimo`) e o campo `bloqueio` de cada conta (vazio = livre), sem acordar nenhuma VM. A cota pode estar desatualizada (`medidaHaMin`). Antes de uma tarefa longa, meça de novo a conta escolhida com `cshub cota <conta> --json` (leva uns 20 s e liga a VM se estiver suspensa).
2. **Atualizar o espelho:** `cshub enviar <projeto> <conta> --json`. É incremental (só manda o que mudou) e leva junto o `git diff` e o `git status` do PC em `.cshub/`. Faça isso antes de toda tarefa, para a nuvem ver o estado atual.
3. **Escrever a tarefa** num arquivo `.md`, no lugar que as regras do projeto definem para registrar tarefas (no `copianeural`, `scratch/receitas-mundo/`). Sem essa definição, use `%TEMP%`, sabendo que ela se perde. Siga o modelo abaixo. Depois:
   `cshub tarefa <projeto> <conta> --arquivo <tarefa.md> [--leitura] --cota-minima <pct> --json` (veja os mínimos na seção "Cota do Gemini"). Guarde o `id`, no formato `T20261009-123456-abc`. Com `--cota-minima`, o `cshub` mede a cota antes e recusa (código 6) se ela estiver abaixo do mínimo. Ele também recusa sozinho uma conta marcada como esgotada.
4. **Esperar e trazer:** `cshub esperar <projeto> <conta> <id> --trazer --json`. Para tarefas médias e longas, acrescente `--vigiar-cota 10 --parar-cota`: a cada 10 minutos o `cshub` mede a cota e, se ela cair abaixo de 10%, cancela a tarefa antes que a conta trave. Fica bloqueado até terminar (padrão 60 min; `--minutos` vai até 720). Códigos de saída:
   - `0`: concluída. A resposta vem em `resposta`, e os arquivos em `arquivos`.
   - `4`: ainda rodando. Chame `esperar` de novo.
   - `5`: o `agy` morreu (a VM provavelmente reiniciou). Rode `cshub acordar`, depois `cshub enviar` e dispare a tarefa de novo.
   - `6`: cota. Ou ela esgotou durante a tarefa (a conta fica marcada até a renovação), ou caiu abaixo do limite de `--vigiar-cota`. Rode `cshub trazer` para salvar o que já foi feito e continue em outra conta. Não use `--continuar` nesse caso, porque a conversa ficou na conta anterior: descreva na nova tarefa o que já está pronto.
   - `1`: falhou. Veja `cshub resultado <projeto> <conta> <id>` (resposta e erros).
5. **Revisar:** leia `RESUMO.md` em `<arquivos>\.saida\<id>\`. Confira `mudancas.txt` (A = novo, M = alterado, D = apagado na nuvem) e `alteracoes.patch`, que compara com a versão atual do PC.
6. **Relatar ao Tiago** o que foi feito e propor o que aplicar no worktree.

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

O Tiago acompanha pelo canvas. Para ver o `agy` trabalhando ao vivo, há também `cshub ssh <conta> --espelho <projeto> --agy` num painel. Ele serve só para olhar: a tarefa disparada roda à parte, em segundo plano na VM.

## Paralelismo com subagentes
- Divida o trabalho em partes independentes (pastas ou arquivos diferentes) e dê **uma conta a cada subagente**.
- Cada subagente roda o ciclo padrão na própria conta e devolve: `id`, código de saída, resposta e as pastas de `logs` e `arquivos`.
- Um `cshub esperar` por conta pode rodar ao mesmo tempo.
- O orquestrador junta os resultados. Se duas contas alteraram o mesmo arquivo, mostre o conflito ao Tiago em vez de escolher sozinho.
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
- `cshub ssh <conta> --espelho <projeto> --agy`: abre o `agy` interativo da nuvem no terminal atual (por exemplo, num painel do Maestri, para o Tiago acompanhar).

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "O espelho ainda nao foi enviado" | `cshub enviar <projeto> <conta>` |
| "Pouca memoria livre no PC" | Esperar o trabalho pesado do PC terminar e tentar de novo |
| "A conexao caiu enquanto esperava" | A tarefa continua na VM: rode `cshub esperar` de novo |
| Código 5 / "o agy parou sem terminar" | `cshub acordar`, `cshub enviar` e disparar de novo |
| "A conta … esta reservada" | Escolher outra conta (`cshub escolher`). Só liberar com autorização do Tiago |
| "A VM de … ja usou … h" | Escolher outra conta; `--ignorar-horas` só com motivo |
| Código 6 / "Cota insuficiente" ao disparar | Escolher outra conta com mais cota, ou dividir a tarefa |
| Código 6 / "A cota do agy esgotou" | `cshub trazer`, depois redisparar o que faltou em outra conta |
| "Nao consegui ler o /usage" / "o painel /usage nao apareceu" | O `agy` pode estar pedindo login: pedir ao Tiago para abrir **agy no espelho** no app uma vez |
| Estado `sem-login` em `cshub contas` | Pedir ao Tiago para logar a conta no app (Contas > Adicionar ou Editar) |
| Resposta do `agy` falando de login ou autenticação | Pedir ao Tiago para abrir **agy no espelho** no app uma vez nessa conta |

## Limites conhecidos
- A VM é descartada depois de cerca de 40 minutos sem sessão ativa, e tudo fora de `~` se perde. O espelho, as tarefas e os resultados ficam em `~` e sobrevivem. Um `cshub esperar` aberto mantém uma conexão com a VM durante a tarefa, mas ainda não foi confirmado se isso basta para segurar tarefas muito longas.
- A versão do `agy` na nuvem vem da imagem do Google e pode mudar sozinha. Se uma atualização mudar o texto do painel `/usage`, o `cshub cota` passa a falhar com um erro claro. Mesmo assim, a detecção de cota esgotada durante as tarefas continua funcionando, porque depende só da mensagem de erro do `agy`.
- Os mínimos da tabela de cota são um ponto de partida. Ajuste-os conforme o que `cshub cota` mostrar depois das primeiras tarefas reais.
- Fotos e outros arquivos que o Git ignora só estão na nuvem se existirem na pasta do PC que foi espelhada.
