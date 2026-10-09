# ☁️ Nuvem (Cloud Shell + agy) no copianeural

> **Rascunho para revisão.**
>
> O manual genérico do comando é a skill `cloudshell-hub` (`~/.claude/skills/cloudshell-hub/SKILL.md`). **Este documento tem as regras do copianeural e prevalece sobre a skill.**

## Para que serve
- Tirar do PC (5,8 GB) trabalho de leitura, pesquisa e processamento pesado, usando os agentes `agy` (Gemini) nas VMs do Google Cloud Shell de outras contas.
- O projeto vai por **espelho**: cópia direta do worktree da rodada, sem Git e sem push. Os resultados voltam para fora do worktree e são aplicados à mão.

## Decisões
| Tema | Regra | Status |
|---|---|---|
| Papel da nuvem | Decisão do orquestrador, ajustada conforme o uso. Ponto de partida: apoio (leitura, mapeamento, pesquisa no código, relatórios e medições pesadas). Registrar aqui o que for mudando. | decidido: orquestrador |
| Juiz na nuvem | Decisão do orquestrador, caso a caso. Os juízes atuais (prova: Sonnet; visual: Vidente) continuam sendo o padrão. Se usar a nuvem como juiz, aplicar a calibração equivalente à AAA, deixar claro no relatório que o juiz foi a nuvem e avisar o Tiago. | decidido: orquestrador |
| Conta do PC | A conta do `agy` do Arauto e da Vidente **muda**: o Tiago troca quando a cota acaba. Como a cota do Gemini é por conta, a conta em uso no PC fica bloqueada para a nuvem. A cada troca: `cshub local <e-mail da conta nova>`, que bloqueia a nova e libera a anterior. Hoje: `profissional.thbs@gmail.com`. | decidido |
| Conferência | Antes de cada delegação, confirmar com `cshub local` que a marca bate com o e-mail do cabeçalho do `agy` no painel do Arauto (`maestri check`). Na dúvida, perguntar ao Tiago. | decidido |
| Contas da nuvem | Qualquer conta do `cshub contas` que **não esteja `[BLOQUEADA]`**. Só há três motivos de bloqueio: (1) `em-uso-no-pc`, a conta do Arauto e da Vidente; (2) `sem-cota-gemini`, esgotada ou abaixo de 5%; (3) `sem-horas-vm`, VM com 47 h ou mais das 50 h da semana. Acompanham `sem-login` e reservas manuais, se alguém criar uma. `cshub escolher` lista as livres, da melhor para a pior. | decidido |
| Quando enviar | Só com a **árvore parada**: nenhum agente editando o worktree, nada compilando, nenhuma foto sendo tirada (a mesma regra do graphify). | decidido |
| Origem do espelho | O worktree da rodada. No início da rodada: `cshub pasta-pc copianeural <worktree>`. Conferir com `git rev-parse --show-toplevel`. | decidido |
| Segredos | `.env` e `tripo-keys.json` nunca vão (já estão na lista padrão de segredos do `cshub`). Login no jogo na nuvem é decisão do Tiago, caso a caso (`--com-segredos`). | decidido |
| Receitas para a nuvem | Em `scratch/receitas-mundo/` (arquivo `.md`; nunca `.ts` solto em `scratch/`, que reprova o lint). Mensagem de uma linha apontando para o arquivo, como nas outras delegações. | decidido |
| Resultados | Em `C:\Users\DEV\Documents\copianeural-nuvem\<conta>\`, fora do worktree. Revisar `RESUMO.md`, `mudancas.txt` e `alteracoes.patch`; aplicar à mão. | decidido |
| Git | Nada da nuvem entra por `git add -A`. Commit só depois de validar. Push e deploy só com ordem do Tiago. | decidido |
| Espera | Em painel próprio: `maestri recruit "Nuvem-<conta>" --preset "Shell" --command "cshub esperar … --json"`, lido com `maestri check`, fechado com `maestri dismiss`. Nunca na sessão do Maestro por mais de 10 minutos. | decidido |
| Cota do Gemini | Mínimos para disparar: curta 10%, média 25%, longa 40%. Média e longa com `--vigiar-cota 10 --parar-cota`. Nunca ativar créditos pagos. | decidido |
| Modo do agy | Padrão ou `--leitura`. Não usar `--plano` (rodada extra de aprovação) nem `--livre` sem ordem do Tiago. | decidido |

## Lugar da nuvem no Gauntlet
- **Antes da rodada:** mapear o código e a área a mexer e gerar um relatório de contexto para a receita do Arauto.
- **Depois da rodada, com a árvore parada:** medições pesadas e revisões de leitura sobre o worktree da rodada, para alimentar o Claude, sem substituir os juízes.
- **Durante a rodada:** não. O worktree está mudando e o espelho copiaria arquivos pela metade.

## Rotina de uma delegação
1. `cshub local`: confere se a marca bate com a conta do Arauto. Se não bater, `cshub local <e-mail>`.
2. `cshub escolher --json`: pega a melhor conta livre (não bloqueada por uso no PC, falta de cota ou de horas de VM). Se não houver nenhuma, avisar o Tiago.
3. Árvore parada? Então `cshub enviar copianeural <conta> --json`.
4. Receita em `scratch/receitas-mundo/<data>-<assunto>.md`.
5. `cshub tarefa copianeural <conta> --arquivo <receita> [--leitura] --cota-minima <pct> --json`.
6. Painel `Nuvem-<conta>` com `cshub esperar … --trazer --json`, acompanhado com `maestri check`.
7. Revisar os resultados em `copianeural-nuvem\<conta>\…` e aplicar à mão o que o Tiago aprovar.
8. `maestri dismiss "Nuvem-<conta>"`.

## 🪤 Armadilhas
- Enviar com o Arauto editando: o espelho leva um arquivo pela metade, e o agente da nuvem analisa código quebrado.
- Usar a conta do Arauto (o `cshub` já a bloqueia, desde que o `cshub local` esteja em dia): gasta a mesma cota do Gemini do Arauto e da Vidente e pode travá-los por horas ou dias.
- Trocar a conta do Maestri e esquecer o `cshub local`: o bloqueio fica na conta antiga, e a nuvem passa a gastar a cota da conta nova do Arauto.
- A conta que acabou de esgotar no PC também está esgotada para a nuvem (a cota é por conta). Depois da troca, `cshub cota <conta antiga>` registra isso.
- Receita em `%TEMP%`: some, e a delegação fica sem registro.
- `cshub esperar` longo na sessão do Maestro: estoura o limite de 10 minutos ou é morto por falta de memória.
- Fotos estão no `.gitignore`: só vão para a nuvem se existirem no worktree espelhado. Um worktree novo não tem fotos.
- `.cshub/` e `.saida/` dentro do espelho são do sistema de delegação, não do projeto.
- A VM é descartada depois de cerca de 40 minutos sem sessão. Só `~` sobrevive, e o `~` some depois de 120 dias sem uso.
- A versão do `agy` na nuvem vem da imagem do Google e muda sozinha. Se o comportamento mudar, confira `agy --version`.
- Trocar o worktree (`cshub pasta-pc`) faz o próximo envio apagar na nuvem o que não existe no worktree novo, inclusive o que o agente criou e ainda não foi trazido. Rode `cshub trazer` antes de trocar.
