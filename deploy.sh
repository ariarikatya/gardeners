#!/bin/bash
set -e
cd /opt/anemon
# Принудительно сбрасываем автогенерируемые файлы к состоянию репозитория перед pull, чтобы избежать конфликтов
git checkout HEAD -- lib/swVersion.generated.js public/sw.js 2>/dev/null || true
echo "=== тяну код из GitHub ==="
git pull
echo "=== ставлю зависимости ==="
npm ci
echo "=== собираю ==="
npm run build
echo "=== перезапускаю ==="
pm2 restart anemon
echo "=== ГОТОВО ==="
