#!/bin/bash
set -e
cd /opt/anemon
# Принудительно сбрасываем автогенерируемые файлы к состоянию репозитория перед pull, чтобы избежать конфликтов
git checkout HEAD -- lib/swVersion.generated.js public/sw.js 2>/dev/null || true
echo "=== тяну код из GitHub ==="
git pull
echo "=== обновляю systemd-юниты для планировщика напоминаний ==="
if [ -f deploy/systemd/run-scheduled.service ] && [ -f deploy/systemd/run-scheduled.timer ]; then
  sudo cp -f deploy/systemd/run-scheduled.service /etc/systemd/system/
  sudo cp -f deploy/systemd/run-scheduled.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now run-scheduled.timer
fi
echo "=== ставлю зависимости ==="
npm ci
echo "=== собираю ==="
npm run build
echo "=== перезапускаю ==="
pm2 restart anemon
echo "=== ГОТОВО ==="
