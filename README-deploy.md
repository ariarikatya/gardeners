Deployment notes — scheduled tasks and VK notifications

1) Scheduled tasks (push reminders on server, fines in GitHub Actions)

- Scripts:
  - `scripts/run-order-reminders.js`: executes push reminders (`runOrderReminders`)
    - Call reminders at 10:00–11:59 MSK (push notification to gardeners for tomorrow's uncalled orders)
    - Card fill reminders at 19:00–20:59 MSK (push notification to gardeners for today's completed orders)
  - `scripts/run-fine-checks.js`: executes fine checks (`runFineChecks`)
    - Automatic fine checks at 23:55 MSK (runs via GitHub Actions workflow `.github/workflows/scheduled-tasks.yml`)
  - `scripts/run-scheduled-tasks.js`: combined wrapper script kept for backward compatibility

- Страховочные окна запуска (Tail Windows):
  - Основное окно звонков — 10:00 МСК. Хвост окна (10:00–11:59 МСК) позволяет автоматически доставить пропущенное напоминание при задержке или сбое крона.
  - Основное окно карточек — 19:00 МСК. Хвост окна (19:00–20:59 МСК) подстраховывает вечерние задержки.
  - На каждый заказ отправляется СТРОГО не более одного напоминания в сутки (любого исхода), повтор возможен только на следующий день (идемпотентность обеспечена через `ClientPushLog`).

## Установка серверного планировщика (systemd timer для напоминаний)

Пошаговая инструкция по настройке `systemd` на сервере (например, `/opt/anemon`):

1. **Скопировать unit-файлы в системную директорию**:
   ```bash
   sudo cp deploy/systemd/run-scheduled.service /etc/systemd/system/
   sudo cp deploy/systemd/run-scheduled.timer /etc/systemd/system/
   ```

2. **Создать env-файл `/etc/gardening-site.env`** с конфигурацией БД и VAPID-ключами:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/gardening?schema=public"
   TZ=Europe/Moscow
   NEXT_PUBLIC_VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY"
   VAPID_PRIVATE_KEY="YOUR_VAPID_PRIVATE_KEY"
   VAPID_SUBJECT="mailto:admin@example.com"
   ```

3. **Перезагрузить конфигурацию systemd и включить таймер**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now run-scheduled.timer
   ```

4. **Проверить статус таймера и просмотреть журналы**:
   ```bash
   systemctl list-timers | grep run-scheduled
   systemctl status run-scheduled.service
   ```

5. **Ручной тестовый запуск скрипта напоминаний**:
   ```bash
   cd /opt/anemon
   node scripts/run-order-reminders.js
   ```
   Если VAPID-ключи не заданы в env-файле, сервис выведет явную ошибку в системный лог:
   ```bash
   journalctl -u run-scheduled.service -n 50 --no-pager
   ```

2) Vercel scheduler

- If deploying to Vercel, use 'Vercel Scheduled Functions' or an external service to call the HTTP endpoint:
  POST https://your-site.com/api/admin/scheduled
  The endpoint requires ADMIN auth (cookie-based) or `x-cron-secret` header matching `CRON_SECRET`.

3) VK notifications (leader approves expense)

- Environment variable required: VK_GROUP_TOKEN — community token with messages permission.
- Gardener model now has `vkId` field which should store VK peer id (user id or peer id) to send a message to.
- API helper implemented at lib/vkApi.js that calls VK method messages.send.
- When leader approves an operation via PUT /api/leader/operations, system will attempt to send a VK message to gardener.vkId (if present) and VK token is configured.

- Message example: "Ваша трата на 1000 ₽ по заказу <orderId> была подтверждена на 800 ₽."

Security and notes:
- VK community tokens should be stored in environment variables and not committed.
- Make sure community has permission to message users (users must start conversation with community or have allowed messages from community).
- For reliable delivery consider using VK callback API or storing failed notifications and retrying.

4) Уведомления (Web Push)

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
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY` должны быть заданы в `.env` или `/etc/gardening-site.env`.

## Проверка настройки в проде (Web Push и задачи по расписанию)

1. **Проверка активного cron/timer на сервере**:
   ```bash
   systemctl list-timers | grep run-scheduled
   ```

2. **Проверка ключей VAPID в переменных окружения**:
   - Убедитесь, что в переменных окружения (`/etc/gardening-site.env` или `.env`) заданы `NEXT_PUBLIC_VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY`.

3. **Проверка активных подписок садовников в базе данных**:
   ```sql
   SELECT count(*)
   FROM "PushSubscription"
   WHERE "userId" IN (SELECT id FROM "User" WHERE role = 'GARDENER');
   ```

4. **Самопроверка канала уведомлений авторизованного пользователя**:
   Выполнить POST-запрос с токеном авторизации садовника/админа:
   ```bash
   # Стандартный тестовый пуш:
   curl -X POST https://your-domain.com/api/push/test -b "token=YOUR_JWT_TOKEN"

   # Тестовый прогон напоминаний 'call' или 'card' без сжигания продуктовой идемпотентности:
   curl -X POST https://your-domain.com/api/push/test -H "Content-Type: application/json" -d '{"type":"call"}' -b "token=YOUR_JWT_TOKEN"
   ```
   Или нажать кнопку «🧪 Отправить тест» в панели управления (`/admin` или `/gardener`).

## Диагностика Web Push

1. **Проверка переменных окружения VAPID**:
   - На сервере или в Vercel проверьте переменные окружения:
     - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
     - `VAPID_PRIVATE_KEY`
     - `VAPID_SUBJECT` (например `mailto:admin@example.com`)

2. **Просмотр логов таймера на сервере**:
   ```bash
   journalctl -u run-scheduled.service -n 50 --no-pager
   ```

5) Интеграция с amoCRM (API v4 + автоматический дедуп контактов)

- Требования к правам и токенам amoCRM API:
  - Для полной работы API v4 интеграции токен должен иметь права на чтение и запись контактов (`contacts`), сделок (`leads`), примечаний и связь сущностей (`leads ↔ contacts`).
  - При отсутствии токена или прав система автоматически пишет предупреждение в лог и безопасно отправляет заявку через резервную веб-форму (`forwardToAmo` / `forwardToAmoUnsorted`). Заявки клиентов никогда не теряются.

6) Вход на устройстве (Remember Device)

- После успешной первичной авторизации номер телефона сохраняется в `localStorage` под ключом `auth_phone`.
- При повторном посещении страницы входа (`/login`) система автоматически предлагает войти в 1 тап: «Войти как <номер>?» с кнопками [Войти] (обращение к `/api/auth/auto-login`) и [Другой номер].
