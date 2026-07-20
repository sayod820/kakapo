#!/usr/bin/env bash
# Вернуть nginx только на HTTP (если HTTPS сломан / 443 не отвечает)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
HTTP_CONF="$SCRIPT_DIR/nginx/default.http.conf"
ACTIVE_CONF="$SCRIPT_DIR/nginx/default.conf"

cd "$REPO_ROOT"

if [[ -f "$SCRIPT_DIR/nginx/default.conf.http-bak" ]]; then
  :
fi

# Эталон HTTP-конфига (без 443)
cat > "$HTTP_CONF" <<'EOF'
resolver 127.0.0.11 valid=10s ipv6=off;

server {
    listen 80;
    server_name _;

    client_max_body_size 200m;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /health {
        set $api_upstream http://api:8000;
        proxy_pass $api_upstream/health;
        proxy_connect_timeout 30s;
        proxy_read_timeout 30s;
        proxy_set_header Host $host;
    }

    location /ws/ {
        set $api_upstream http://api:8000;
        proxy_pass $api_upstream;
        proxy_http_version 1.1;
        proxy_connect_timeout 30s;
        proxy_read_timeout 86400;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        set $web_upstream http://web:3000;
        proxy_pass $web_upstream;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

cp "$HTTP_CONF" "$ACTIVE_CONF"
cp "$SCRIPT_DIR/nginx/default.conf" "$SCRIPT_DIR/nginx/default.conf" 2>/dev/null || true

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d nginx
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart nginx

echo ""
echo "✅ nginx только HTTP (порт 80)."
echo "   В Chrome сбросьте HSTS, иначе браузер всё равно откроет https:"
echo "   chrome://net-internals/#hsts  →  Delete domain security policies"
echo "   Domain: kakappo.shop"
echo "   Затем откройте: http://kakappo.shop/admin"
echo ""
echo "   Чтобы снова включить HTTPS: bash deploy/hetzner/ssl-init.sh"
