import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode('fallback-secret-use-env-in-prod');

test.describe('Admin Order Cards & Header Totals', () => {
  test('Renders static priceFact, no inline inputs, and opens modal on click', async ({ page, context }) => {
    const now = new Date();
    const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).toISOString().split('T')[0];

    const mockGardeners = [
      { id: 'g1', name: 'Иван Иванов', phone: '79991112233', jobTitle: 'садовник', services: [] },
      { id: 'g2', name: 'Пётр Петров', phone: '79992223344', jobTitle: 'мастер', services: [] }
    ];

    const mockOrders = [
      {
        id: 'ord1',
        clientName: 'ТестВыполнен1',
        clientPhone: '79998887766',
        address: 'ул. Ленина 10',
        district: 'Центр',
        description: 'Обрезка яблони',
        priceContract: 2000,
        priceFact: 1650,
        status: 'Выполнен',
        date: `${todayStr}T12:00:00.000Z`,
        gardenerId: 'g1'
      },
      {
        id: 'ord2',
        clientName: 'ТестВыполнен2',
        clientPhone: '79998887755',
        address: 'ул. Мира 5',
        district: 'Центр',
        description: 'Полив',
        priceContract: 1000,
        priceFact: 0,
        status: 'Выполнен',
        date: `${todayStr}T12:00:00.000Z`,
        gardenerId: 'g1'
      },
      {
        id: 'ord3',
        clientName: 'ТестНовый1',
        clientPhone: '79998887744',
        address: 'ул. Садовая 15',
        district: 'Заводской',
        description: 'Стрижка газона',
        priceContract: 1500,
        priceFact: 0,
        status: 'Новый заказ',
        date: `${todayStr}T12:00:00.000Z`,
        gardenerId: 'g2'
      }
    ];

    // Mock API endpoints
    await page.route('**/api/auth/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 'admin1', role: 'ADMIN', name: 'Диспетчер' } })
    }));

    await page.route('**/api/admin/gardeners', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ gardeners: mockGardeners })
    }));

    await page.route('**/api/admin/orders*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: mockOrders })
    }));

    await page.route('**/api/admin/dayoff*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ dayOffs: [] })
    }));

    await page.route('**/api/admin/blockday*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ blockedDays: [] })
    }));

    await page.route('**/api/admin/services', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ services: [] })
    }));

    await page.route('**/api/admin/webleads', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ webLeads: [], hasAdminVk: false })
    }));

    const token = await new SignJWT({ userId: 'test-admin-id', role: 'ADMIN', phone: '79990000000' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1d')
      .sign(JWT_SECRET);

    await context.addCookies([
      {
        name: 'token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax'
      }
    ]);

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('response', resp => { if (!resp.ok()) console.log('FAILED RESP:', resp.url(), resp.status()); });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:3000/admin');
    await page.waitForLoadState('networkidle');

    // 1. Verify card with priceFact 1650
    const cardDone = page.locator('div.cursor-pointer', { hasText: 'ТестВыполнен1' }).first();
    await expect(cardDone).toBeVisible();
    await expect(cardDone).toContainText('1650');

    // Verify background badge styling
    const priceSpan = cardDone.locator('span.bg-green-700\\/60');
    await expect(priceSpan).toBeVisible();
    await expect(priceSpan).toHaveText('1650');

    // 2. Verify completed card with 0 priceFact has NO price badge and NO "+ сумма"
    const cardDoneNoPrice = page.locator('div.cursor-pointer', { hasText: 'ТестВыполнен2' }).first();
    await expect(cardDoneNoPrice).toBeVisible();
    await expect(cardDoneNoPrice).not.toContainText('+ сумма');
    await expect(cardDoneNoPrice).not.toContainText('0');

    // 3. Verify no <input type="number"> in grid cards
    const cardInputs = page.locator('table input[type="number"]');
    await expect(cardInputs).toHaveCount(0);

    // 4. Verify gardener column header total sum
    const header1 = page.locator('th', { hasText: 'Иван Иванов' });
    await expect(header1).toContainText('Σ 1650');

    await page.screenshot({ path: 'test-desktop-cards.png', fullPage: false });

    // 5. Test clicking card opens edit modal
    await cardDone.click();
    const modalTitle = page.locator('h3', { hasText: 'Редактировать / переместить заказ' });
    await expect(modalTitle).toBeVisible();

    const closeModalBtn = page.locator('button', { hasText: 'Отмена' }).first();
    await closeModalBtn.click();
    await expect(modalTitle).not.toBeVisible();

    // 6. Test status filter behavior on gardener column header total (Σ must NOT disappear when status filter is active)
    const statusSelect = page.locator('select', { hasText: 'Любой' }).first();
    await statusSelect.selectOption('Новый заказ');

    // Total Σ remains 1650 even when status filter is set to 'Новый заказ'
    await expect(header1).toContainText('Σ 1650');

    // Save screenshot for verification
    await page.screenshot({ path: '/home/jules/verification/verification.png', fullPage: false });

    // Reset status filter
    await statusSelect.selectOption('all');
    await expect(header1).toContainText('Σ 1650');

    // 7. Mobile 320px viewport test
    await page.setViewportSize({ width: 320, height: 600 });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowing).toBe(false);

    await page.screenshot({ path: 'test-mobile-320px.png', fullPage: false });
  });
});
