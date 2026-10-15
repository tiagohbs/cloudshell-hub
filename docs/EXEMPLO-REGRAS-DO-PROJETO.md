# Nuvem (Cloud Shell + agy) neste projeto — modelo

> Copie este arquivo para o seu projeto (por exemplo `docs/NUVEM_CLOUDSHELL.md`), troque os trechos entre `< >` e apague o que não se aplica.
> O manual genérico do comando é a skill `cloudshell-hub`. **O documento do projeto prevalece sobre a skill**: o orquestrador deve lê-lo primeiro.

## Para que serve
- Tirar do PC trabalho de leitura, pesquisa, testes longos e processamento pesado, usando os agentes `agy` (Gemini) nas VMs do Google Cloud Shell de outras contas.
- O projeto vai por **espelho** (cópia direta da pasta, sem Git e sem push). Os resultados voltam para **fora** da pasta do projeto e são aplicados à mão (`cshub aplicar`).

## Decisões
| Tema | Regra |
|---|---|
| Papel da nuvem | `<apoio: leitura, mapeamento, pesquisa no código, relatórios e medições pesadas | também edição | também juiz>` |
| Conta do PC | A conta do `agy` local muda quando a cota acaba. A cada troca: `cshub local <e-mail da conta nova>`. Antes de cada delegação, confira com `cshub local`. |
| Contas da nuvem | Qualquer conta do `cshub contas` que **não esteja `[BLOQUEADA]`** (`cshub escolher`). |
| Quando enviar | Só com a **árvore parada**: nada compilando, nenhum agente editando a pasta. |
| Origem do espelho | `<pasta ou worktree do projeto>`. Para mudar: `cshub pasta-pc <projeto> <pasta>`. |
| Segredos | `.env`, chaves e certificados nunca vão (lista padrão do `cshub`). `--com-segredos` só com ordem explícita, tarefa a tarefa. |
| Onde salvar as tarefas | `<pasta>/<tarefas>/` em arquivos `.md`. |
| Resultados | `<pasta fora do projeto>\<conta>\`. Revise `RESUMO.md`, `mudancas.txt` e `alteracoes.patch`. |
| Git | Nada da nuvem entra por `git add -A`. Commit só depois de validar. |
| Espera | Em painel próprio do orquestrador: `cshub acompanhar <projeto> <conta> <ID> --resumo`. Nunca espere em laço consultando a nuvem. |
| Modo do agy | Padrão ou `--leitura`. Evite `--plano` e `--livre` sem ordem explícita. |
| Mutações e testes | A lista de mutações vem do orquestrador ou do juiz, nunca do construtor. Falsos de teste devem reproduzir a semântica real. |

## Fluxo de uma delegação
1. `cshub local`: confere a conta marcada como em uso no PC.
2. `cshub escolher --json`: pega a melhor conta livre.
3. Árvore parada? `cshub enviar <projeto> <conta> --json`.
4. Escrever a tarefa em `.md` e disparar: `cshub tarefa <projeto> <conta> --arquivo <tarefa.md> --cota-minima <pct> --json`.
5. Acompanhar e esperar (veja a regra de espera da skill).
6. `cshub trazer` e `cshub aplicar <ID> <worktree> --simular`; depois aplicar de verdade.
7. Relatar ao responsável o que foi feito e o que ficou pendente.

## O que não fazer
- Enviar com alguém editando a pasta (o espelho leva arquivo pela metade).
- Usar a conta do PC na nuvem (gasta a mesma cota do Gemini).
- Trocar a conta do orquestrador e esquecer o `cshub local`.
- Pedir ao agy para rodar coisas em segundo plano.
