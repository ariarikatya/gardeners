import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

test('verify order cards fact sum display and inline editing', async ({ page, context }) => {
  const mockGardeners = [
    { id: 'g1', name: 'Иван Иванов', phone: '79990000001', jobTitle: 'садовник', services: [] },
    { id: 'g2', name: 'Пётр Петров', phone: '79990000002', jobTitle: 'мастер', services: [] }
  ];

  const todayStr = new Date().toISOString().split('T')[0];

  let mockOrders = [
    {
      id: 'o1',
      date: `${todayStr}T12:00:00.000Z`,
      status: 'Выполнен',
      priceFact: 1650,
      clientName: 'Алексей',
      clientPhone: '79991112233',
      address: 'ул. Ленина 10',
      district: 'Центр',
      description: 'Обрезка яблони',
      gardenerId: 'g1',
      amoDealId: '123'
    },
    {
      id: 'o2',
      date: `${todayStr}T12:00:00.000Z`,
      status: 'Выполнен',
      priceFact: 0,
      clientName: 'Борис',
      clientPhone: '79992223344',
      address: 'ул. Мира 5',
      district: 'Центр',
      description: 'Полив',
      gardenerId: 'g1',
      amoDealId: '124'
    },
    {
      id: 'o3',
      date: `${todayStr}T12:00:00.000Z`,
      status: 'Новый заказ',
      priceFact: 0,
      clientName: 'Владимир',
      clientPhone: '79993334455',
      address: 'ул. Садовая 15',
      district: 'Заводской',
      description: 'Стрижка газона',
      gardenerId: 'g2',
      amoDealId: '125'
    }
  ];

  // Set JWT cookie using lib/jwt secret fallback
  const secret = new TextEncoder().encode('fallback-secret-use-env-in-prod');
  const token = await new SignJWT({ userId: 'u1', role: 'ADMIN', name: 'Диспетчер' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1d')
    .sign(secret);

  await context.addCookies([
    {
      name: 'token',
      value: token,
      url: 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Lax'
    }
  ]);

  await page.route('**/api/auth/me', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 'u1', role: 'ADMIN', name: 'Диспетчер' } })
    });
  });

  await page.route('**/api/admin/gardeners', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ gardeners: mockGardeners }) });
  });

  await page.route('**/api/admin/orders*', route => {
    if (route.request().method() === 'PUT') {
      const postData = JSON.parse(route.request().postData());
      mockOrders = mockOrders.map(o => o.id === postData.id ? { ...o, priceFact: postData.priceFact } : o);
      const updated = mockOrders.find(o => o.id === postData.id);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ order: updated }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: mockOrders }) });
    }
  });

  await page.route('**/api/admin/dayoff*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dayOffs: [] }) }));
  await page.route('**/api/admin/blockday*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ blockedDays: [] }) }));
  await page.route('**/api/admin/services', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) }));
  await page.route('**/api/admin/webleads', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ webLeads: [], hasAdminVk: false }) }));

  // Set desktop viewport and navigate to /admin
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:3000/admin');

  // Verify redirected to /admin and header loaded
  await expect(page.locator('text=Панель Диспетчера')).toBeVisible();

  // Desktop screenshot (a) completed with sum (1650), (b) non-completed without sum, (c) completed without sum (+ сумма)
  await page.screenshot({ path: 'test-desktop-cards.png', fullPage: true });

  // Open inline input for o2 ("+ сумма")
  await page.locator('text="+ сумма"').click();
  await page.screenshot({ path: 'test-inline-input-open.png' });

  // Type new value 2100 and press Enter
  const input = page.locator('input[aria-label="Сумма по факту"]');
  await input.fill('2100');
  await input.press('Enter');

  // Verify updated sum "2100" visible
  await expect(page.locator('text="2100"')).toBeVisible();
  await page.screenshot({ path: 'test-inline-input-saved.png' });

  // Test status filter and column sum (Σ)
  const statusSelect = page.locator('select').filter({ hasText: 'Любой' });
  await statusSelect.selectOption('Новый заказ');

  // Check that header sum Σ 3750 (1650 + 2100) is still visible even when status filter is "Новый заказ"
  await expect(page.locator('text="Σ 3750"')).toBeVisible();
  await page.screenshot({ path: 'test-status-filter-sum.png' });

  // Mobile 320px viewport verification
  await page.setViewportSize({ width: 320, height: 600 });
  await page.screenshot({ path: 'test-mobile-320px.png', fullPage: true });

  // Verify scrollWidth <= clientWidth on 320px
  const isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(isOverflowing).toBe(false);
});
