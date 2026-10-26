#!/bin/bash
set -euo pipefail

cd /opt/anemon

echo "=== [deploy.sh] Сбрасываю сгенерированные файлы сборки (lib/version.js, lib/swVersion.generated.js, public/sw.js) ==="
git checkout HEAD -- lib/version.js lib/swVersion.generated.js public/sw.js 2>/dev/null || true

echo "=== [deploy.sh] Обновляю репозиторий из GitHub (git fetch & git reset --hard origin/main) ==="
git fetch origin
git reset --hard origin/main

echo "=== [deploy.sh] Проверяю/создаю /etc/gardening-site.env ==="
if [ ! -f /etc/gardening-site.env ] && [ -f /opt/anemon/.env ]; then
  sudo cp -n /opt/anemon/.env /etc/gardening-site.env
  sudo chmod 600 /etc/gardening-site.env
  echo "Создан /etc/gardening-site.env из /opt/anemon/.env"
fi

echo "=== [deploy.sh] Обновляю systemd-юниты для планировщика напоминаний ==="
if [ -f deploy/systemd/run-scheduled.service ] && [ -f deploy/systemd/run-scheduled.timer ]; then
  sudo cp -f deploy/systemd/run-scheduled.service /etc/systemd/system/
  sudo cp -f deploy/systemd/run-scheduled.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl reset-failed run-scheduled.service || true
  sudo systemctl enable --now run-scheduled.timer
fi

echo "=== [deploy.sh] Устанавливаю зависимости ==="
npm ci

echo "=== [deploy.sh] Выполняю сборку ==="
npm run build

echo "=== [deploy.sh] Перезапускаю PM2 (zero-downtime reload) ==="
pm2 reload anemon --update-env

echo "=== [deploy.sh] Выполняю прогрев офлайн-кэша ==="
npm run warmup-offline-cache || true

echo "=== [deploy.sh] ГОТОВО ==="
