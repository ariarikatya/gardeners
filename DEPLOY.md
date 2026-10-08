# Инструкция по безопасному деплою Анемон Агро на VPS

## Безопасный цикл обновления (Zero Downtime / Version Skew Safety)

При обновлении на VPS соблюдайте следующий порядок команд:

```bash
cd /opt/anemon
git pull
npm ci
npm run build            # Дождаться успешного завершения сборки!
pm2 restart anemon --update-env
sleep 3 && pm2 logs anemon --lines 20   # Убедиться в отсутствии ошибок старта
```

---

## ⚠️ Важные предостережения

1. **Никогда не выполняйте `rm -rf .next` без последующего `npm run build` до перезапуска `pm2`.**
   Если перезапустить `pm2` при отсутствии директории `.next` или с недостроенным билдом, Next.js упадет с ошибкой:
   `Error: Could not find a production build in the '.next' directory.`

2. **Не перезапускайте `pm2` во время сборки `npm run build`.**
   Это вызывает смешение чанков и рантайм-краши App Router (`TypeError: Cannot read properties of null (reading 'digest')` или `Failed to find Server Action`).

3. **Запуск через npm script:**
   Для исключения ручного пропуска шага сборки можно использовать:
   ```bash
   npm run deploy
   ```

---

## Почему пользователям больше не нужно чистить кэш / переустанавливать PWA

1. **Автоматический уникальный CACHE_NAME:**
   При каждом `npm run build` генерируется уникальное имя кэша `anemon-agro-v{version}-{date}-{sha}` (`scripts/gen-sw-version.js`).
2. **Бесшовное удаление старых кэшей:**
   В `sw.js` событие `activate` автоматически удаляет все предыдущие имена кэшей.
3. **Навигация всегда из сети:**
   HTML-страницы всегда запрашиваются из сети (`network-only` c оффлайн-фоллбэком на оффлайн-страницы только при отсутствии интернета).
4. **Контроль заголовков `/sw.js`:**
   `/sw.js` отдается с `Cache-Control: no-cache, no-store, must-revalidate`. Браузер подхватывает новые скрипты сразу при открытии.
5. **Авто-обновление страниц:**
   Компоненты `ServiceWorkerRegister` и `BuildVersionWatcher` автоматически производят `SKIP_WAITING` и мягкий перезапуск страницы при возврате на вкладку (`visibilitychange`).

---

## Настройка Nginx (на сервере VPS)

Убедитесь, что ваш конфиг Nginx (`/etc/nginx/sites-available/...`) содержит следующие локации для предотвращения кэширования сервис-воркера и манифеста:

```nginx
location /sw.js {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}

location /manifest.json {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

---

## Что делать, если у пользователя открыта старая вкладка
Если пользователь держал открытой вкладку с предыдущей версии, приложение автоматически покажет баннер:
«✨ Вышла новая версия — обновите страницу». Нажатие кнопки «Обновить» автоматически сбросит устаревший кэш и обновит страницу без необходимости вручную лезть в настройки браузера или переустанавливать иконку PWA.
