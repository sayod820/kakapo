#!/usr/bin/env bash
# Первичная настройка Ubuntu на Hetzner (CX22 или больше)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
fi

KAKAPO_REPO_DIR="${KAKAPO_REPO_DIR:-/opt/kakapo}"

echo "==> Обновление системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Установка Docker"
if ! command -v docker &>/dev/null; then
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

echo "==> Firewall (SSH, HTTP, HTTPS)"
if command -v ufw &>/dev/null; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw --force enable || true
fi

echo "==> Копирование проекта в $KAKAPO_REPO_DIR"
mkdir -p "$(dirname "$KAKAPO_REPO_DIR")"
if [[ ! -d "$KAKAPO_REPO_DIR/.git" ]]; then
  if [[ -d "$REPO_ROOT/.git" ]]; then
    rsync -a --delete --exclude node_modules --exclude .next "$REPO_ROOT/" "$KAKAPO_REPO_DIR/"
  else
    echo "Клонируйте репозиторий в $KAKAPO_REPO_DIR и запустите снова:"
    echo "  git clone https://github.com/sayod820/kakapo.git $KAKAPO_REPO_DIR"
    exit 1
  fi
fi

if [[ ! -f "$KAKAPO_REPO_DIR/deploy/hetzner/.env" ]]; then
  cp "$KAKAPO_REPO_DIR/deploy/hetzner/.env.example" "$KAKAPO_REPO_DIR/deploy/hetzner/.env"
  echo ""
  echo "⚠️  Отредактируйте $KAKAPO_REPO_DIR/deploy/hetzner/.env (DOMAIN, PUBLIC_URL, WS_URL)"
  echo "    Затем: bash deploy/hetzner/deploy.sh"
  exit 0
fi

echo "==> Первый запуск контейнеров"
cd "$KAKAPO_REPO_DIR"
bash deploy/hetzner/deploy.sh

echo ""
echo "✅ Сервер готов (HTTP)."
echo "   Проверка: curl http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')/health"
echo "   После настройки DNS на домен запустите: bash deploy/hetzner/ssl-init.sh"
