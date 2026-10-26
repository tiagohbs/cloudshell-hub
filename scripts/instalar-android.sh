#!/usr/bin/env bash
# Instala o Cloud Shell Hub (cshub) e suas dependências no Android, pelo Termux, dentro de um Ubuntu (proot-distro).
#
# Uso (no Termux; baixe para um arquivo, não use "curl | bash"):
#   curl -fsSL https://raw.githubusercontent.com/tiagohbs/cloudshell-hub/main/scripts/instalar-android.sh -o instalar-android.sh
#   bash instalar-android.sh [opções]
#
# Opções:
#   --claude          instala também o Claude Code (CLI)
#   --colab           instala também o uv e o Colab CLI
#   --repo dono/nome  clona (ou atualiza) mais um repositório pelo gh e roda "npm ci"; precisa de "gh auth login" antes
#   --simular         só mostra o que faria, sem instalar nada
#   --etapa termux|ubuntu   força a etapa (o padrão é detectar)
#
# Pode ser rodado de novo: pula o que já estiver instalado. Os logins (contas Google, Claude, agy, Colab, GitHub)
# NÃO são feitos aqui: o script termina listando os comandos de login.
set -uo pipefail

CLAUDE=0; COLAB=0; REPO=""; SIMULAR=0; ETAPA=""
declare -a FWD=()   # opções repassadas para a etapa do Ubuntu (sem --etapa, senão entraria em laço)
while [ $# -gt 0 ]; do
  case "$1" in
    --claude) CLAUDE=1; FWD+=("$1") ;;
    --colab) COLAB=1; FWD+=("$1") ;;
    --repo) REPO="${2:-}"; FWD+=("$1" "$REPO"); shift ;;
    --simular) SIMULAR=1; FWD+=("$1") ;;
    --etapa) ETAPA="${2:-}"; shift ;;
    -h|--help) [ -f "$0" ] && sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $1 (veja --help)"; exit 2 ;;
  esac
  shift
done
if [ -n "$REPO" ] && ! [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then echo "--repo deve ser dono/nome"; exit 2; fi

HUB_REPO="https://github.com/tiagohbs/cloudshell-hub.git"
declare -a RESUMO=()
nota() { RESUMO+=("$1"); }
passo() { printf '\n==> %s\n' "$*"; }
# executa (ou só mostra, em --simular); devolve o código do comando
run() {
  if [ "$SIMULAR" = 1 ]; then printf '   [simular] %s\n' "$*"; return 0; fi
  bash -c "$*"
}
tem() { command -v "$1" >/dev/null 2>&1; }

detectar_etapa() {
  if [ -n "$ETAPA" ]; then echo "$ETAPA"; return; fi
  if [ -n "${PREFIX:-}" ] && [ -d /data/data/com.termux ] && tem pkg; then echo termux; return; fi
  if [ -f /etc/os-release ] && grep -q '^ID=ubuntu' /etc/os-release; then echo ubuntu; return; fi
  echo desconhecida
}

# ---------------------------------------------------------------- etapa 1: Termux
etapa_termux() {
  if [ ! -f "$0" ]; then echo "Rode a partir de um arquivo (curl ... -o instalar-android.sh && bash instalar-android.sh)."; exit 2; fi
  passo "Termux: pacotes e Ubuntu (proot-distro)"
  run "pkg update -y && pkg install -y proot-distro curl" || { echo "Falhou o pkg. Termux é o do F-Droid?"; exit 1; }
  tem termux-wake-lock && run "termux-wake-lock"
  # pergunta ao próprio proot-distro se o Ubuntu existe (a pasta dele muda entre versões do proot-distro)
  if [ "$SIMULAR" = 0 ] && proot-distro login ubuntu -- true >/dev/null 2>&1; then echo "   Ubuntu já instalado."
  else run "proot-distro install ubuntu" || { echo "Falhou a instalação do Ubuntu."; exit 1; }; fi
  passo "Continuando dentro do Ubuntu"
  # o cat grava o script dentro do Ubuntu e ele roda do arquivo: não depende de onde o proot-distro guarda o Ubuntu
  # (rodar direto com "bash -s" deixaria apt/npm lerem o resto do script pela entrada padrão)
  if [ "$SIMULAR" = 1 ]; then printf '   [simular] proot-distro login ubuntu -- bash -c "cat > /root/instalar-android.sh && bash /root/instalar-android.sh --etapa ubuntu %s" < %s\n' "${FWD[*]}" "$0"; exit 0; fi
  exec proot-distro login ubuntu -- bash -c 'cat > /root/instalar-android.sh && exec bash /root/instalar-android.sh "$@" </dev/null' _ --etapa ubuntu "${FWD[@]}" < "$0"
}

# ---------------------------------------------------------------- etapa 2: Ubuntu
etapa_ubuntu() {
  if [ "$(id -u)" != 0 ] && [ "$SIMULAR" = 0 ]; then echo "Dentro do Ubuntu do proot o usuário é root. Rode como root."; exit 2; fi
  export DEBIAN_FRONTEND=noninteractive   # sem perguntas (fuso etc.)
  local BIN=/usr/local/bin

  passo "Base: git, curl, certificados, python3, ssh"
  if run "apt-get update -y && apt-get install -y git curl ca-certificates python3 build-essential openssh-client gnupg apt-transport-https && update-ca-certificates"; then nota "base: ok"; else nota "base: FALHOU (veja o log)"; fi

  passo "Node.js 20 ou mais novo"
  local nv=0; tem node && nv=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$nv" -ge 20 ] 2>/dev/null; then echo "   Node $(node -v) já instalado."; nota "node: ok ($(node -v))"
  elif run "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"; then nota "node: instalado"; else nota "node: FALHOU"; fi

  passo "Google Cloud CLI (gcloud). Demora: no celular, ~13 min"
  if tem gcloud; then echo "   gcloud já instalado."; nota "gcloud: ok"
  elif run "curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor --yes -o /usr/share/keyrings/cloud.google.gpg && echo 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' > /etc/apt/sources.list.d/google-cloud-sdk.list && apt-get update -y && apt-get install -y google-cloud-cli"; then nota "gcloud: instalado (sem login global: o cshub faz um login por conta)"; else nota "gcloud: FALHOU"; fi

  passo "Cloud Shell Hub (cshub)"
  local hub="$HOME/cloudshell-hub"
  if [ -d "$hub/.git" ]; then run "git -C '$hub' pull --ff-only"; else run "git clone '$HUB_REPO' '$hub'"; fi
  if run "cd '$hub' && npm ci --omit=dev"; then
    run "ln -sf '$hub/cshub' '$BIN/cshub'"
    if run "cd '$hub' && npm test >/tmp/cshub-test.log 2>&1"; then nota "cshub: ok (npm test passou)"; else nota "cshub: instalado, mas npm test FALHOU (veja /tmp/cshub-test.log)"; fi
    run "'$BIN/cshub' skill instalar" && nota "skill cloudshell-hub: instalada em ~/.claude/skills"
  else nota "cshub: FALHOU no npm ci"; fi

  if [ "$CLAUDE" = 1 ]; then
    passo "Claude Code (CLI)"
    if tem claude; then nota "claude: ok"; elif run "npm install -g @anthropic-ai/claude-code"; then nota "claude: instalado"; else nota "claude: FALHOU"; fi
  fi

  if [ "$COLAB" = 1 ]; then
    passo "uv e Colab CLI. Demora: compila em ARM"
    export PATH="$HOME/.local/bin:$PATH"
    tem uv || run "curl -LsSf https://astral.sh/uv/install.sh | sh"
    if tem colab; then nota "colab: ok"; elif run "\$HOME/.local/bin/uv tool install google-colab-cli"; then nota "colab: instalado (use sempre: timeout 120 colab ... </dev/null)"; else nota "colab: FALHOU"; fi
  fi

  if [ -n "$REPO" ]; then
    passo "Repositório $REPO (pelo gh)"
    tem gh || run "apt-get install -y gh"
    local dir="$HOME/${REPO#*/}"
    if [ "$SIMULAR" = 0 ] && ! gh auth status >/dev/null 2>&1; then nota "$REPO: PULADO (rode 'gh auth login' e o script de novo)"
    else
      if [ -d "$dir/.git" ]; then run "git -C '$dir' pull --ff-only"; else run "gh repo clone '$REPO' '$dir'"; fi
      if run "cd '$dir' && npm ci --ignore-scripts"; then nota "$REPO: ok em $dir"; else nota "$REPO: FALHOU no npm ci"; fi
    fi
  fi

  passo "Antigravity (agy): só confere"
  if tem agy; then nota "agy: ok ($(agy --version 2>/dev/null | head -1))"; else nota "agy: AUSENTE (instale pelo método oficial para Linux arm64; se o login der erro x509, os certificados já foram instalados acima)"; fi

  # ---------------------------------------------------------------- resumo
  printf '\n================ RESUMO%s ================\n' "$([ "$SIMULAR" = 1 ] && echo ' (SIMULAÇÃO: nada foi instalado)')"
  for l in "${RESUMO[@]}"; do printf ' - %s\n' "$l"; done
  cat <<'EOF'

Próximos passos (logins, feitos por você no navegador):
  1. Contas do Cloud Shell, uma por vez:   cshub login          (mostra o link; cole o código no terminal)
  2. Conferir o agy das VMs:               cshub agy-login --todas
  3. GitHub (para --repo):                 gh auth login
  4. Claude (se instalou):                 claude               (faça o login e saia com /exit)
  5. Colab (se instalou):                  timeout 300 colab usage </dev/null
Para entrar no Ubuntu depois:              proot-distro login ubuntu
Detalhes: README do cloudshell-hub, seção "Só o CLI", e a skill (cshub skill instalar).
EOF
}

LOG="$HOME/instalar-android.log"; [ "$SIMULAR" = 1 ] && LOG=/dev/null
case "$(detectar_etapa)" in
  termux) etapa_termux ;;
  ubuntu) etapa_ubuntu 2>&1 | tee -a "$LOG"; echo "Log: $LOG" ;;
  *) echo "Não reconheci o ambiente (nem Termux nem Ubuntu). Use --etapa termux ou --etapa ubuntu."; exit 2 ;;
esac
