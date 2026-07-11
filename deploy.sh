#!/bin/bash
set -euo pipefail

echo "=== Shorja — نشر على VPS ==="

if [ ! -f .env ]; then
  echo "إنشاء ملف .env من .env.example ..."
  cp .env.example .env
  echo "عدّل .env (JWT_SECRET وكلمات المرور) ثم أعد تشغيل السكربت."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker غير مثبت. ثبّته أولاً."
  exit 1
fi

docker compose down 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo ""
echo "تم التشغيل على المنفذ 5007"
echo "  نقطة البيع:  http://$(hostname -I | awk '{print $1}'):5007/branch/"
echo "  الإدارة:     http://$(hostname -I | awk '{print $1}'):5007/admin/"
echo "  API:         http://$(hostname -I | awk '{print $1}'):5007/api/health"
echo ""
docker compose ps
