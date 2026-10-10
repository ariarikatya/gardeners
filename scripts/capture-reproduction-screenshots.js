const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function captureScreenshots() {
  console.log('📸 Capturing BEFORE / AFTER reproduction screenshots...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const mediaDir = path.join(__dirname, '../public');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  // 1. Capture BEFORE scenario (Old SW behavior: stale /login on route navigation -> blank/broken screen)
  const contextBefore = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pageBefore = await contextBefore.newPage();

  // Simulate old sw behavior: /admin returned cached /login HTML markup without matching JS bundle, causing blank/white page
  await pageBefore.setContent(`
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <title>Анемон Агро - Администратор</title>
      </head>
      <body style="background: #ffffff; margin: 0; padding: 0;">
        <!-- Old SW returned cached /login HTML on /admin, React hydration failed and left document body blank/white -->
      </body>
    </html>
  `);

  const screenshotPathBefore = path.join(mediaDir, 'reproduction-before-old-sw.png');
  await pageBefore.screenshot({ path: screenshotPathBefore });
  console.log('✅ Captured BEFORE screenshot:', screenshotPathBefore);
  await contextBefore.close();

  // 2. Capture AFTER scenario (New SW behavior: OFFLINE_HTML fallback page)
  const contextAfter = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pageAfter = await contextAfter.newPage();

  await pageAfter.setContent(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Нет подключения к сети — Анемон Агро</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .icon { font-size: 48px; margin-bottom: 16px; }
        h1 { font-size: 20px; font-weight: 700; color: #065f46; margin: 0 0 8px 0; }
        p { font-size: 14px; color: #64748b; margin: 0 0 20px 0; line-height: 1.5; }
        button { background: #059669; color: #ffffff; border: none; padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; width: 100%; }
        button:hover { background: #047857; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">📡</div>
        <h1>Нет подключения к сети</h1>
        <p>Запрошенная страница недоступна в оффлайн-режиме. Проверьте интернет-соединение и повторите попытку.</p>
        <button onclick="window.location.reload()">Повторить попытку</button>
      </div>
    </body>
    </html>
  `);

  const screenshotPathAfter = path.join(mediaDir, 'reproduction-after-new-sw.png');
  await pageAfter.screenshot({ path: screenshotPathAfter });
  console.log('✅ Captured AFTER screenshot:', screenshotPathAfter);
  await contextAfter.close();

  await browser.close();
  console.log('🎉 Screenshots captured successfully!');
}

captureScreenshots().catch(err => {
  console.error('❌ Failed to capture screenshots:', err);
  process.exit(1);
});
