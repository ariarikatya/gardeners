Deployment notes — scheduled tasks and VK notifications

1) Scheduled tasks (automatic fines)

- Script: scripts/run-scheduled-tasks.js
  - Run via node: node scripts/run-scheduled-tasks.js
  - Requires environment variable DATABASE_URL to connect to database.
  - Should be run once a day around 20:05 (or twice: 18:05 and 20:05) depending on needs.

- Example crontab entries (on the server, edit with `crontab -e`):

# Run fines check at 20:05 every day
5 20 * * * cd /path/to/repo && /usr/bin/node ./scripts/run-scheduled-tasks.js >> /var/log/gardeners/scheduled.log 2>&1

# (Optional) Run call-check at 18:05 every day
5 18 * * * cd /path/to/repo && /usr/bin/node ./scripts/run-scheduled-tasks.js >> /var/log/gardeners/scheduled.log 2>&1

- Ensure the user running cron has access to the repository and env file (or system env variables). For deployments on platforms like Vercel, use their Scheduler (see below).

2) Vercel scheduler

- If deploying to Vercel, use 'Vercel Scheduled Functions' or an external service to call the HTTP endpoint:
  POST https://your-site.com/api/admin/scheduled
  The endpoint requires ADMIN auth (cookie-based). For simplicity, you can create a server-side scheduled job that triggers internally with server credentials, or implement a token-based endpoint if needed.

3) systemd timer (example)

Create a systemd service `/etc/systemd/system/gardeners-scheduled.service`:

[Unit]
Description=Gardeners scheduled tasks

[Service]
Type=oneshot
WorkingDirectory=/path/to/repo
ExecStart=/usr/bin/node /path/to/repo/scripts/run-scheduled-tasks.js
Environment=DATABASE_URL=postgres://user:pass@host:5432/db

Then create `/etc/systemd/system/gardeners-scheduled.timer`:

[Unit]
Description=Run gardeners scheduled tasks daily at 20:05

[Timer]
OnCalendar=*-*-* 20:05:00
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

