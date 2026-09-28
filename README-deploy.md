Deployment notes — scheduled tasks and VK notifications

1) Scheduled tasks (automatic fines)

- Script: scripts/run-scheduled-tasks.js
  - Run via node: node scripts/run-scheduled-tasks.js
  - Requires environment variable DATABASE_URL to connect to database.
  - Runs once a day at 23:55 MSK (20:55 UTC).

- Example crontab entries (on the server, edit with `crontab -e`):

# Run fines check at 23:55 MSK every day
55 23 * * * cd /path/to/repo && TZ=Europe/Moscow /usr/bin/node ./scripts/run-scheduled-tasks.js >> /var/log/gardeners/scheduled.log 2>&1

- Ensure the user running cron has access to the repository and env file (or system env variables). For deployments on platforms like Vercel, use their Scheduler (see below).

2) Vercel scheduler

- If deploying to Vercel, use 'Vercel Scheduled Functions' or an external service to call the HTTP endpoint:
  POST https://your-site.com/api/admin/scheduled
  The endpoint requires ADMIN auth (cookie-based) or `x-cron-secret` header matching `CRON_SECRET`.

3) systemd timer (example)

Create a systemd service `/etc/systemd/system/gardeners-scheduled.service`:

[Unit]
Description=Gardeners scheduled tasks

[Service]
Type=oneshot
WorkingDirectory=/path/to/repo
ExecStart=/usr/bin/node /path/to/repo/scripts/run-scheduled-tasks.js
Environment=DATABASE_URL=postgres://user:pass@host:5432/db TZ=Europe/Moscow

Then create `/etc/systemd/system/gardeners-scheduled.timer`:

[Unit]
Description=Run gardeners scheduled tasks daily at 23:55 MSK

[Timer]
OnCalendar=*-*-* 23:55:00
Persistent=true

[Install]
WantedBy=timers.target

Enable and start:

sudo systemctl enable gardeners-scheduled.timer
sudo systemctl start gardeners-scheduled.timer

4) VK notifications (leader approves expense)

- Environment variable required: VK_GROUP_TOKEN — community token with messages permission.
- Gardener model now has `vkId` field which should store VK peer id (user id or peer id) to send a message to.
- API helper implemented at lib/vkApi.js that calls VK method messages.send.
- When leader approves an operation via PUT /api/leader/operations, system will attempt to send a VK message to gardener.vkId (if present) and VK token is configured.

- Message example: "Ваша трата на 1000 ₽ по заказу <orderId> была подтверждена на 800 ₽."

Security and notes:
- VK community tokens should be stored in environment variables and not committed.
- Make sure community has permission to message users (users must start conversation with community or have allowed messages from community).
- For reliable delivery consider using VK callback API or storing failed notifications and retrying.

5) Next steps
- If you want, I can:
  - Add an admin UI to bulk set vkId for gardeners (e.g., by phone lookup/mapping),
  - Implement retry/queue for failed VK sends,
  - Add email or SMS fallback notifications.

6) Уведомления (Web Push)

- Как включить пуш-уведомления:
  - В панели диспетчера (`/admin`): в шапке нажать кнопку «Включить уведомления». Браузер запросит разрешение на отправку push-уведомлений.
  - В кабинете садовника (`/gardener`): в шапке нажать кнопку «Включить уведомления».
  - Подписка автоматически привязывается к авторизованному пользователю (`userId`).

- iPhone: обязательные шаги (Safari / PWA):
  1) В Safari нажмите кнопку «Поделиться» (квадрат со стрелкой).
  2) Нажмите «На экран „Домой“» («Add to Home Screen»).
  3) Откройте приложение Anemon Agro с иконки на домашнем экране.
  4) В шапке нажмите «Включить уведомления» еще раз.

- Безопасность контактных данных клиентов:
  - В текстах Web Push уведомлений осознанно исключены имя и телефон клиента. Отображается только адрес/объект, дата и услуга. Полная информация о клиенте доступна в панели управления.

- Требования к протоколу (HTTPS):
  - Service Worker и Push API требуют HTTPS соединения (за исключением `localhost` при локальной разработке).

- Переменные окружения:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY` должны быть заданы в `.env`.

## Диагностика Web Push

1. **Проверка переменных окружения VAPID**:
   - В Vercel (или другой платформе деплоя) проверьте `Vercel Project Settings → Environment Variables`:
     - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
     - `VAPID_PRIVATE_KEY`
     - `VAPID_SUBJECT` (например `mailto:admin@example.com`)
   - **ОБЯЗАТЕЛЬНО сделайте Redeploy после добавления переменных окружения!** Значения переменных окружения запекаются/читаются при запуске бессерверной функции, и без повторного деплоя ключи не подтянутся.

2. **Проверка привязки и отправка тестового уведомления**:
   - Залогиньтесь под администратором (`/admin`) или садовником (`/gardener`).
   - Нажмите кнопку «Включить уведомления».
   - После успешного сохранения подписки система автоматически отправит тестовый пуш с выводом алерта о статусе.

3. **Диагностический эндпоинт `/api/push/diagnose`**:
   - Откройте в браузере `https://your-domain.com/api/push/diagnose` для разбора статуса:
     - `privateKeySet: false` → ключи не загружены, выполните Redeploy проекта.
     - `user: "НЕ ПРИВЯЗАНА"` → подписка создана без привязки к `userId`, перезайдите в аккаунт и переподпишитесь.
     - `statusCode: 410` или `404` → браузерная подписка устарела/аннулирована сервером браузера, переподпишитесь заново.
     - `testSend OK`, но пуш не появился на экране macOS → проверьте режим «Не беспокоить» (Focus mode) в macOS или `Системные настройки → Уведомления → Google Chrome` (разрешены ли уведомления).

4. **Просмотр логов функций**:
   - В консоли Vercel: `Deployments → текущий деплой → Logs` или в CLI командой `vercel logs`.
   - В логах ищите префикс `[WebPush]` для анализа количества найденных подписок и ошибок отправки.

7) Интеграция с amoCRM (API v4 + автоматический дедуп контактов)

- Требования к правам и токенам amoCRM API:
  - Для полной работы API v4 интеграции токен должен иметь права на чтение и запись контактов (`contacts`), сделок (`leads`), примечаний и связь сущностей (`leads ↔ contacts`).
  - При отсутствии токена или прав система автоматически пишет предупреждение в лог и безопасно отправляет заявку через резервную веб-форму (`forwardToAmo` / `forwardToAmoUnsorted`). Заявки клиентов никогда не теряются.

- Привязка контактов:
  - Новые сделки создаются с поиском существующего контакта по нормализованному номеру телефона. Если контакт существует — сделка связывается с ним без создания дубля контакта.
