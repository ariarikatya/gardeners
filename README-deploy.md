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

## Почасовая синхронизация Google Таблиц (Google Sheets Hourly Sync)

Синхронизация заказов с Google Таблицами выполняется через защищённый эндпоинт `POST /api/admin/sync-sheets-cron`.

### Настройка на VPS через crontab
Для бесплатной авто-синхронизации добавьте запись в системный crontab на VPS (`crontab -e`):
```bash
0 * * * * curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://<ваш-домен>/api/admin/sync-sheets-cron
```
Значение `CRON_SECRET` задаётся в окружении PM2 / `.env`.

Дополнительно (страховка на клиенте): при открытии страницы `/admin` браузер диспетчера проверяет время последней синхронизации в `localStorage` (`last_sheets_sync_ts`). Если прошло > 60 минут, выполняется фоновая синхронизация без дублирования одновременных вызовов.

## Первый деплой на чистый сервер

Пошаговые действия для настройки первого развертывания системы и планировщика reminders:

1. **Создать env-файл `/etc/gardening-site.env`**:
   Скопировать рабочий `.env` с ключами или создать файл вручную с правами `600`:
   ```bash
   sudo cp -n /opt/anemon/.env /etc/gardening-site.env
   sudo chmod 600 /etc/gardening-site.env
   ```
   Убедитесь, что в файле присутствуют:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/gardening?schema=public"
   TZ=Europe/Moscow
   NEXT_PUBLIC_VAPID_PUBLIC_KEY="YOUR_VAPID_PUBLIC_KEY"
   VAPID_PRIVATE_KEY="YOUR_VAPID_PRIVATE_KEY"
   VAPID_SUBJECT="mailto:admin@example.com"
   CRON_SECRET="YOUR_CRON_SECRET"
   ```

2. **Скопировать systemd-юниты и включить таймер**:
   ```bash
   sudo cp deploy/systemd/run-scheduled.service /etc/systemd/system/
   sudo cp deploy/systemd/run-scheduled.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl reset-failed run-scheduled.service
   sudo systemctl enable --now run-scheduled.timer
   ```

3. **Выполнить проверочные команды**:
   ```bash
   # Проверка статуса таймера и времени следующего запуска:
   systemctl list-timers | grep run-scheduled

   # Проверка статуса службы:
   systemctl status run-scheduled.service

   # Просмотр системных логов планировщика:
   journalctl -u run-scheduled.service -n 50 --no-pager
   ```

## Установка серверного планировщика (systemd timer для напоминаний)

Пошаговая инструкция по настройке `systemd` на сервере (`/opt/anemon`):

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
   sudo systemctl reset-failed run-scheduled.service
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

## Диагностика: напоминание не отправилось

Если в 10:00 МСК (звонки) или 19:00 МСК (карточки) садовники не получили пуш-уведомление, выполните следующую пошаговую диагностику на сервере:

1. **Проверить активность systemd-таймера**:
   ```bash
   systemctl list-timers | grep run-scheduled
   ```
   Убедитесь, что таймер находится в состоянии `active (waiting)` и колонки `NEXT` / `LEFT` показывают ближайший запуск на `:00` или `:30` минут текущего часа.

2. **Проверить статус сервиса**:
   ```bash
   systemctl status run-scheduled.service
   ```
   Проверьте, что последний запуск завершился с кодом `code=exited, status=0/SUCCESS`.

3. **Просмотреть журналы выполнения за сегодня**:
   ```bash
   journalctl -u run-scheduled.service --since today -n 100 --no-pager
   ```
   Ищите сообщения:
   - `[reminders] ...` — статус отправки напоминаний.
   - `[WebPush] ERROR: VAPID keys missing...` — отсутствие VAPID-ключей.

4. **Проверить env-файл `/etc/gardening-site.env`**:
   Убедитесь, что файл существует и содержит все необходимые переменные:
   - `DATABASE_URL`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`

5. **Ручной запуск скрипта напоминаний**:
   ```bash
   cd /opt/anemon
   node scripts/run-order-reminders.js
   ```
   Если текущее время находится вне окон (10:00–11:59 или 19:00–20:59 МСК), скрипт выведет `time_threshold_not_reached`.

6. **Тест с обходом порога времени (`ignoreTimeThreshold`)**:
   Для проверки доставки уведомлений в любое время без сжигания продуктовой идемпотентности выполните POST-запрос с токеном авторизации:
   ```bash
   curl -X POST https://your-domain.com/api/push/test \
     -H "Content-Type: application/json" \
     -d '{"type":"call"}' \
     -b "token=YOUR_JWT_TOKEN"
   ```
   Это отправит тестовое напоминание `order_reminder_test`, подтверждающее работоспособность Web Push канала.

2) VK notifications (leader approves expense)

- Environment variable required: VK_GROUP_TOKEN — community token with messages permission.
- Gardener model now has `vkId` field which should store VK peer id (user id or peer id) to send a message to.
- API helper implemented at lib/vkApi.js that calls VK method messages.send.
- When leader approves an operation via PUT /api/leader/operations, system will attempt to send a VK message to gardener.vkId (if present) and VK token is configured.

- Message example: "Ваша трата на 1000 ₽ по заказу <orderId> была подтверждана на 800 ₽."

Security and notes:
- VK community tokens should be stored in environment variables and not committed.
- Make sure community has permission to message users (users must start conversation with community or have allowed messages from community).
- For reliable delivery consider using VK callback API or storing failed notifications and retrying.

3) Уведомления (Web Push)

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

4) Интеграция с amoCRM (API v4 + автоматический дедуп контактов)

- Требования к правам и токенам amoCRM API:
  - Для полной работы API v4 интеграции токен должен иметь права на чтение и запись контактов (`contacts`), сделок (`leads`), примечаний и связь сущностей (`leads ↔ contacts`).
  - При отсутствии токена или прав система автоматически пишет предупреждение в лог и безопасно отправляет заявку через резервную веб-форму (`forwardToAmo` / `forwardToAmoUnsorted`). Заявки клиентов никогда не теряются.

5) Вход на устройстве (Remember Device)

- После успешной первичной авторизации номер телефона сохраняется в `localStorage` под ключом `auth_phone`.
- При повторном посещении страницы входа (`/login`) система автоматически предлагает войти в 1 тап: «Войти как <номер>?» с кнопками [Войти] (обращение к `/api/auth/auto-login`) и [Другой номер].
