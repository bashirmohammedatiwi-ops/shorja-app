#!/bin/bash
# تشغيل مرة واحدة على السيرفر: bash scripts/apply-server-edari-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ملف .env غير موجود"
  exit 1
fi

ensure_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    echo "  ✓ ${key} موجود"
  else
    echo "${key}=${value}" >> .env
    echo "  + أضيف ${key}"
  fi
}

echo "=== إعداد مزامنة الإداري في .env ==="
ensure_env SYNC_KEY "shorja-sync-key-2026-change-me"
ensure_env EDARI_SHORJA_PARENT_NUM 12111
ensure_env EDARI_SHORJA_PARENT_NAME "زبائن محل الشورجه"
ensure_env EDARI_SYNC_ACCOUNTS 1
ensure_env EDARI_SYNC_EVENTS 1
ensure_env EDARI_SALES_ACCOUNT_SEQ 41
ensure_env EDARI_RETURNS_ACCOUNT_SEQ 42
ensure_env EDARI_CASH_ACCOUNT_SEQ 316
ensure_env EDARI_DISCOUNT_ACCOUNT_SEQ 132
ensure_env EDARI_SHORJA_BILL_NUM_START 9000000

if command -v docker >/dev/null 2>&1 && docker compose ps -q shorja 2>/dev/null | grep -q .; then
  echo "إعادة تشغيل الحاوية..."
  docker compose up -d
fi

echo "تم."
