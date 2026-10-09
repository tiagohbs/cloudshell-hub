# Graph Report - cloudshell-app  (2026-10-09)

## Corpus Check
- 23 files · ~30,887 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 368 nodes · 602 edges · 19 communities (17 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `03d759fd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]

## God Nodes (most connected - your core abstractions)
1. `prepare()` - 13 edges
2. `Cloud Shell Hub: delegar trabalho para a nuvem` - 12 edges
3. `load()` - 11 edges
4. `find()` - 11 edges
5. `project()` - 10 edges
6. `sshBase()` - 9 edges
7. `metrics()` - 9 edges
8. `result()` - 9 edges
9. `run()` - 8 edges
10. `fetchResults()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Card()` --calls--> `ask()`  [EXTRACTED]
  src/App.jsx → src/ask.jsx
- `ProjectCard()` --calls--> `ask()`  [EXTRACTED]
  src/Projects.jsx → src/ask.jsx
- `cancel()` --calls--> `target()`  [EXTRACTED]
  electron/tasks.js → electron/mirror.js
- `list()` --calls--> `target()`  [EXTRACTED]
  electron/tasks.js → electron/mirror.js
- `result()` --calls--> `target()`  [EXTRACTED]
  electron/tasks.js → electron/mirror.js

## Import Cycles
- None detected.

## Communities (19 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (47): compile(), cs, fetchResults(), fmtMB(), fs, git(), lastSend(), lowPriority() (+39 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (49): accessToken(), add(), api(), cachedToken(), CONFIG, copyCommand(), ensureKeyFiles(), ensureLogin() (+41 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (38): add(), branchFor(), cleanDir(), cleanPatterns(), counts(), cs, DEFAULT_EXCLUDE, DEFAULT_SECRETS (+30 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (31): build, appId, asarUnpack, directories, files, productName, win, dependencies (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (7): App(), AVATARS, FRIENDLY, MODES, store, useToast(), VM_LABEL

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (20): app, argv, cs, errors, fail(), flags, json, mirror (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (20): { app, BrowserWindow, ipcMain, clipboard, shell, Menu, Tray, nativeImage }, buildTrayMenu(), createWindow(), cs, ensureTray(), errors, fs, getSettings() (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (14): avatarColor(), Card(), maskEmail(), fmtDur(), fmtGB(), fmtHours(), level(), Meter() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (15): cached(), check(), cs, DIR, file(), fs, markExhausted(), os (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (9): ask(), askChecked(), AskHost(), DEFAULT_EXCLUDE, DEFAULT_SECRETS, DirField(), outsideHome(), ProjectCard() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (10): crypto, DIR, DST, { execFile }, fs, hasCshub(), os, path (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (12): Ciclo padrão (uma tarefa), Cloud Shell Hub: delegar trabalho para a nuvem, Cota do Gemini, Limites conhecidos, Modelo de tarefa, No Maestri: a espera vai para um painel próprio, Outros comandos, Paralelismo com subagentes (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (8): fs, kill(), killAll(), os, path, spawnSsh(), sshPath(), terms

### Community 13 - "Community 13"
Cohesion: 0.22
Nodes (8): Cloud Shell Hub, cshub (linha de comando), Espelho do PC (cópia direta, sem Git), Gerar executável portátil, Requisitos, Rodar, Tarefas na nuvem (agy -p), Uso

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (6): 🪤 Armadilhas, Decisões, Lugar da nuvem no Gauntlet, ☁️ Nuvem (Cloud Shell + agy) no copianeural, Para que serve, Rotina de uma delegação

### Community 16 - "Community 16"
Cohesion: 0.50
Nodes (4): pctTxt(), qTone(), QuotaBlock(), renovaTxt()

## Knowledge Gaps
- **140 isolated node(s):** `path`, `{ spawn }`, `app`, `cs`, `projects` (+135 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `path`, `{ spawn }`, `app` to the rest of the system?**
  _140 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07541478129713423 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.10196078431372549 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11282051282051282 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.07671957671957672 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.08666666666666667 - nodes in this community are weakly interconnected._