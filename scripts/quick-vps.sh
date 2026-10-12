#!/usr/bin/env bash
# Thiết lập nhanh để thử VPS: một lệnh, vào web bằng http://IP:PORT. CHỈ cho web cá nhân/thử nghiệm.
#   bash scripts/quick-vps.sh            # tự lấy IP công khai
#   bash scripts/quick-vps.sh 1.2.3.4    # tự chỉ định IP hoặc tên miền
# Ghi/cập nhật apps/server/.env (giữ nguyên các khóa khác, giữ API_TOKEN cũ nếu đã đủ dài),
# mở cổng (ufw nếu đang bật) và khởi động lại pm2 `tutien-server` nếu có.
# Cảnh báo: chạy HTTP thường, mật khẩu/token đi qua mạng không mã hoá. Production phải dùng HTTPS + PUBLIC_ORIGIN.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/server/.env"
PM2_NAME="${PM2_NAME:-tutien-server}"

get_val() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
set_val() {
  local key="$1" value="$2"
  touch "$ENV_FILE"
  if grep -qE "^$key=" "$ENV_FILE"; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

PORT="${PORT:-$(get_val PORT)}"; PORT="${PORT:-4000}"
ADDR="${1:-}"
if [ -z "$ADDR" ]; then
  ADDR="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$ADDR" ] || ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$ADDR" ] || { echo "Không lấy được IP. Chạy lại: bash scripts/quick-vps.sh <IP-hoặc-tên-miền>"; exit 1; }
ORIGIN="http://$ADDR:$PORT"

TOKEN="$(get_val API_TOKEN)"
if [ "${#TOKEN}" -lt 32 ]; then TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi

set_val HOST 0.0.0.0
set_val PORT "$PORT"
set_val TRUST_PROXY 1
set_val API_TOKEN "$TOKEN"
set_val PUBLIC_ORIGIN "$ORIGIN"
set_val ALLOWED_ORIGINS "$ORIGIN,http://localhost:$PORT,http://127.0.0.1:$PORT"
chmod 600 "$ENV_FILE" 2>/dev/null || true

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null && echo "Đã mở cổng $PORT trên ufw."
fi

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null && echo "Đã khởi động lại pm2 '$PM2_NAME'."
else
  echo "Chưa có tiến trình pm2 '$PM2_NAME'. Chạy: cd $ROOT/apps/server && pm2 start dist/index.js --name $PM2_NAME --time"
fi

echo
echo "Xong. Mở: $ORIGIN"
echo "Nếu vẫn không vào được: mở cổng $PORT ở firewall/security group của nhà cung cấp VPS."
echo "Cảnh báo: đang chạy HTTP không mã hoá, chỉ dùng thử nghiệm/web cá nhân."
