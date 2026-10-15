#!/bin/bash
# Acompanhamento SOMENTE LEITURA de uma tarefa do Cloud Shell Hub (nao envia nada ao agente).
# Ctrl+C fecha so esta janela; a tarefa continua rodando.
T="$(cd "$(dirname "$0")" && pwd)"
ID="$(basename "$T")"
echo "== Tarefa $ID (somente leitura; Ctrl+C sai e a tarefa continua) =="
[ -f "$T/ao-vivo" ] || echo "(esta tarefa foi disparada sem --ao-vivo: o texto do agente so aparece no fim; abaixo, arquivos e erros em tempo real)"

fmt() {
  if command -v jq >/dev/null 2>&1; then
    jq -R -r --unbuffered '(fromjson? // {text: .}) | (if type=="object" then . else {text: tostring} end)
      | ((.type // .event // .kind // "evento") | tostring) as $t
      | ((.name // .tool // .tool_name // .command // .path // "") | tostring) as $n
      | ((.text // .content // .message // .result // .delta // "") | if type=="string" then . else tostring end) as $x
      | "\($t) \($n) \($x)" | gsub("\\s+"; " ") | .[0:220]'
  else cat; fi
}

resumir() { awk '{ k=$1" "$2; if (k==ant) next; ant=k; print substr($0,1,110); fflush() }'; }
filtro() { if [ "$1" = resumo ]; then resumir; else cat; fi; }
[ "$1" = resumo ] && echo "(modo resumo: só os marcos principais)"
touch "$T/marca-ver"
tail -n +1 -f "$T/saida.json" 2>/dev/null | fmt | filtro "$1" &
P1=$!
tail -n 0 -f "$T/erro.log" 2>/dev/null | sed -u 's/^/[erro] /' &
P2=$!
trap 'kill $P1 $P2 2>/dev/null; exit 0' INT TERM
n=0
while [ ! -f "$T/codigo" ]; do
  sleep 5; n=$((n+1))
  if [ $((n % 3)) -eq 0 ]; then
    arq="$(find . -xdev \( -path ./.git -o -path ./.cshub -o -name node_modules \) -prune -o -type f -newer "$T/marca-ver" -print 2>/dev/null | head -5 | tr '\n' ' ')"
    touch "$T/marca-ver"
    [ -n "$arq" ] && echo "[arquivos] $arq"
  fi
  [ -f "$T/pid" ] && ! kill -0 "$(cat "$T/pid")" 2>/dev/null && [ ! -f "$T/codigo" ] && { sleep 3; [ -f "$T/codigo" ] || { echo "[fim] o vigia parou sem terminar (a VM pode ter reiniciado)"; break; }; }
done
sleep 2
kill $P1 $P2 2>/dev/null
[ -f "$T/codigo" ] && echo "[fim] terminou com código $(cat "$T/codigo")$( [ -s "$T/motivo" ] && echo " (motivo: $(cat "$T/motivo"))" )"
