#!/bin/bash
# Vigia de tarefa do Cloud Shell Hub (roda na VM, junto com o agy).
# Uso: vigia.sh <pasta-da-tarefa> <min-sem-sinal> <min-maximo> <repetir 0|1> <chave> <exigir-resumo 0|1> <impaciente 0|1>
# - detecta agente travado (sem saida e sem CPU) e tarefa que passou do tempo maximo;
# - classifica a falha em: cota, login, servidor, rede, travada, tempo-maximo, sem-resposta, falhou;
# - repete ate 2 vezes falhas de servidor/rede (so quando <repetir> = 1, tarefas que nao editam).
T="$1"; STALL="${2:-15}"; MAXM="${3:-90}"; RETRY="${4:-0}"; KEY="$5"; NEEDRES="${6:-0}"; IMP="${7:-0}"
echo $$ > "$T/pid"
ID="$(basename "$T")"
export CSHUB_PULSO="$T/pulso" CSHUB_SAIDA="$PWD/.saida/$ID"
touch "$T/pulso" "$T/marca"

# CPU gasta pelo agy (ou pelo comando) e por tudo que ele iniciou: arvore de processos + a sessao inteira.
# Testes longos (mutacao, QA, .mjs) gastam CPU, entao contam como "vivo" mesmo sem escrever nada.
cpu() {
  local a b
  a=$(ps -eo pid=,ppid=,cputimes= 2>/dev/null | awk -v root="$1" '{pp[$1]=$2; c[$1]=$3} END{for(p in pp){q=p; n=0; while(q!="" && q!=0 && n<64){ if(q==root){s+=c[p]; break}; q=pp[q]; n++ }} print s+0}')
  b=$(ps -o cputimes=,comm= --sid $$ 2>/dev/null | awk '$2!="bash" && $2!="sleep" && $2!="ps" && $2!="awk" {s+=$1} END{print s+0}')
  echo $((${a:-0}+${b:-0}))
}
# outros sinais de vida: arquivos do projeto alterados desde a ultima conferencia e o "pulso" que um script pode dar
atividade() {
  local n
  n=$(find . -xdev \( -path ./.git -o -path ./.cshub -o -name node_modules \) -prune -o -type f -newer "$T/marca" -print 2>/dev/null | head -200 | wc -l)
  touch "$T/marca"
  echo "$n $(stat -c %Y "$T/pulso" 2>/dev/null)"
}

classificar() {
  local txt
  txt="$(tail -c 6000 "$T/erro.log" 2>/dev/null; echo; tail -c 2000 "$T/saida.json" 2>/dev/null)"
  if echo "$txt" | grep -qiE 'RESOURCE_EXHAUSTED|quota|rate.?limit|too many requests|\b429\b'; then echo cota
  elif echo "$txt" | grep -qiE 'UNAUTHENTICATED|invalid_grant|not (logged|signed) in|login required|re-?authenticat|credentials? (expired|invalid)|\b401\b'; then echo login
  elif echo "$txt" | grep -qiE '\b(500|502|503|504)\b|UNAVAILABLE|overloaded|internal (server )?error|INTERNAL|deadline.?exceeded|ECONNRESET|socket hang up|temporarily'; then echo servidor
  elif echo "$txt" | grep -qiE 'ENOTFOUND|EAI_AGAIN|getaddrinfo|network (is )?unreachable|ETIMEDOUT'; then echo rede
  else echo falhou; fi
}

tent=0
while :; do
  tent=$((tent+1)); echo "$tent" > "$T/tentativas"
  rm -f "$T/motivo"
  if [ -f "$T/comando" ]; then
    # o shell do rodar nao e de login: carrega o nvm (node/npx) antes do script
    bash -c 'for f in "$HOME/.nvm/nvm.sh" /usr/local/nvm/nvm.sh; do [ -s "$f" ] && . "$f" >/dev/null 2>&1 && break; done; exec bash "$0"' "$T/comando" > "$T/saida.json" 2> "$T/erro.log" < /dev/null &
  else
    agy -p "$(cat "$T/tarefa.md")" $(cat "$T/flags") > "$T/saida.json" 2> "$T/erro.log" < /dev/null &
  fi
  A=$!; echo "$A" > "$T/agypid"
  ini=$(date +%s); ult=$ini; sig=""; rc=""
  while kill -0 "$A" 2>/dev/null; do
    for _ in 1 2 3 4 5 6; do kill -0 "$A" 2>/dev/null || break; sleep 5; done
    kill -0 "$A" 2>/dev/null || break
    date -u +%FT%TZ > "$T/vivo"
    now=$(date +%s)
    s="$(stat -c %s "$T/saida.json" "$T/erro.log" 2>/dev/null | tr '\n' ' ')$(cpu "$A") $(atividade)"
    if [ "$s" != "$sig" ]; then sig="$s"; ult=$now; fi
    mot=""
    # --impaciente: o agy parou esperando segundo plano e nao ha RESUMO.md -> nao gasta ate 30 min de VM
    if [ "$IMP" = 1 ] && [ ! -f "$T/comando" ] && [ ! -s ".saida/$ID/RESUMO.md" ] && grep -qiE 'waiting up to .* for [0-9]+ background task' "$T/erro.log" 2>/dev/null; then
      [ -z "$bgvisto" ] && bgvisto=$now
      [ $((now-bgvisto)) -ge 180 ] && mot=segundo-plano
    else bgvisto=""; fi
    [ -z "$mot" ] && [ $((now-ult)) -ge $((STALL*60)) ] && mot=travada
    [ $((now-ini)) -ge $((MAXM*60)) ] && mot=tempo-maximo
    if [ -n "$mot" ]; then
      echo "$mot" > "$T/motivo"
      pkill -TERM -P "$A" 2>/dev/null; kill -TERM "$A" 2>/dev/null; sleep 5
      pkill -KILL -P "$A" 2>/dev/null; kill -KILL "$A" 2>/dev/null
      rc=124; break
    fi
  done
  [ -z "$rc" ] && { wait "$A"; rc=$?; }
  if [ ! -s "$T/motivo" ]; then
    if [ -f "$T/comando" ]; then
      if [ "$rc" -eq 127 ]; then echo comando-nao-encontrado > "$T/motivo"
      elif [ "$rc" -ne 0 ]; then echo falhou > "$T/motivo"
      elif grep -qE 'command not found|: not found$' "$T/erro.log" 2>/dev/null; then echo comando-nao-encontrado > "$T/motivo"; rc=127   # o script saiu com 0, mas algum comando nem existia
      fi
    elif [ "$rc" -ne 0 ]; then classificar > "$T/motivo"
    elif [ ! -s "$T/saida.json" ]; then echo sem-resposta > "$T/motivo"; rc=1
    elif [ "$NEEDRES" = 1 ] && [ ! -s ".saida/$ID/RESUMO.md" ]; then
      # saiu com 0, mas sem entregar: o agy deixou testes/benchmarks em segundo plano e parou esperando
      if grep -qiE 'waiting up to .* for [0-9]+ background task|root agent idle' "$T/erro.log" 2>/dev/null; then echo segundo-plano > "$T/motivo"; else echo sem-resumo > "$T/motivo"; fi
      rc=1
    fi
  fi
  mot="$(cat "$T/motivo" 2>/dev/null)"
  if [ "$rc" -ne 0 ] && [ "$RETRY" = 1 ] && { [ "$mot" = servidor ] || [ "$mot" = rede ]; } && [ "$tent" -lt 3 ]; then
    echo "repetindo:$mot" > "$T/estado"
    mv -f "$T/erro.log" "$T/erro.$tent.log" 2>/dev/null
    sleep $((tent*90))
    continue
  fi
  break
done

echo "$rc" > "$T/codigo.tmp"; mv "$T/codigo.tmp" "$T/codigo"
date -u +%FT%TZ > "$T/fim"
[ -n "$KEY" ] && rm -f "$HOME/.cshub/rodando/$KEY"
exit 0
