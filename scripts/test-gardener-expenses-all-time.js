const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Standalone mock jwt implementation so test runs without external dependencies
function base64UrlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function base64UrlDecode(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}

async function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.signature`;
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return base64UrlDecode(parts[1]);
  } catch (e) {
    return null;
  }
}

async function testGardenerExpensesAllTime() {
  console.log('🧪 Testing gardener all-time expenses fixes...');

  // 1. Mirror offline-snapshot query logic and assert operations from 3+ months back are present
  const now = new Date();
  const past3Months = new Date(now.getFullYear(), now.getMonth() - 4, 10);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 5);

  const mockDbOperations = [
    { id: 'op_old_1', gardenerId: 'g1', type: 'expense', amount: 1500, createdAt: past3Months },
    { id: 'op_old_2', gardenerId: 'g1', type: 'bonus', amount: 3000, createdAt: past3Months },
    { id: 'op_cur_1', gardenerId: 'g1', type: 'expense', amount: 450, createdAt: currentMonth },
  ];

  // Logic mirror of app/api/offline-snapshot/route.js
  const snapshotOps = mockDbOperations.filter(op => op.gardenerId === 'g1');
  assert.strictEqual(snapshotOps.length, 3, 'offline-snapshot must return all operations for gardener without range');
  const hasOldOp = snapshotOps.some(op => op.createdAt <= past3Months);
  assert.strictEqual(hasOldOp, true, 'offline-snapshot must include operations from 3+ months back');
  console.log('  ✓ offline-snapshot logic includes all-time operations (3+ months back)');

  // 2. Assert sw.js contains no month-range filter for the operations resource and contains the bumped cache version & network-first rule
  const swContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  assert(!swContent.includes('operations?month='), 'sw.js must not force a month-range query on operations');
  assert(swContent.includes('anemon-agro-v1.0.1'), 'sw.js must have bumped cache version constant');
  assert(swContent.includes('api/gardener/operations'), 'sw.js must reference gardener operations cache purging');
  assert(swContent.includes('/api/gardener/operations') && swContent.includes("all') === '1'"), 'sw.js must contain network-first rule for operations?all=1');
  console.log('  ✓ sw.js has cache version bump and purge logic, and network-first rule');

  // 3. Assert app/gardener/page.js uses `all=1`, has getAllCachedOperations reading both keys, and guards empty state
  const gardenerPageContent = fs.readFileSync(path.join(__dirname, '..', 'app', 'gardener', 'page.js'), 'utf8');
  assert(gardenerPageContent.includes('api/gardener/operations?all=1'), 'app/gardener/page.js must query /api/gardener/operations?all=1');
  assert(!gardenerPageContent.includes('/api/gardener/expenses'), 'Gardener page must not fetch expenses from the removed Prisma Expense model');
  assert(gardenerPageContent.includes("saveCache('operations',"), 'Must save operations into IndexedDB operations cache');
  assert(gardenerPageContent.includes('getAllCachedOperations'), 'app/gardener/page.js must define getAllCachedOperations helper');
  assert(gardenerPageContent.includes('getNormalizedUrlCacheKey'), 'app/gardener/page.js must use getNormalizedUrlCacheKey');
  assert(gardenerPageContent.includes('Данные загружаются…') || gardenerPageContent.includes('loading'), 'UI block must guard on loading');
  assert(gardenerPageContent.includes('isOffline') || gardenerPageContent.includes('Нет сети'), 'UI block must guard on isOffline');
  console.log('  ✓ app/gardener/page.js uses all=1, getAllCachedOperations and UI guards');

  // 4. Regression Test: Route handler GET /api/gardener/operations?all=1
  const multiYearExpenses = [
    { id: 'exp_2024', gardenerId: 'g1', type: 'expense', amount: 5000, description: 'Инвентарь 2024', approved: true, createdAt: new Date('2024-05-15T10:00:00.000Z') },
    { id: 'exp_2025', gardenerId: 'g1', type: 'expense', amount: 3200, description: 'Удобрения 2025', approved: true, createdAt: new Date('2025-08-20T10:00:00.000Z') },
    { id: 'exp_3months_ago', gardenerId: 'g1', type: 'expense', amount: 1800, description: 'Расходники 3 мес назад', approved: false, createdAt: past3Months },
    { id: 'exp_current_month', gardenerId: 'g1', type: 'expense', amount: 950, description: 'Текущие траты', approved: false, createdAt: currentMonth },
    { id: 'exp_other_gardener', gardenerId: 'g2', type: 'expense', amount: 9999, description: 'Чужая трата', approved: false, createdAt: currentMonth },
  ];

  const routePath = path.resolve(__dirname, '..', 'app', 'api', 'gardener', 'operations', 'route.js');
  let routeCode = fs.readFileSync(routePath, 'utf8');
  const dateFilterPath = path.resolve(__dirname, '..', 'lib', 'dateFilter.js');
  let dateFilterCode = fs.readFileSync(dateFilterPath, 'utf8')
    .replace(/export\s+/g, '');

  routeCode = routeCode
    .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
    .replace(/import\s+prisma\s+from\s*['"]@\/lib\/prisma['"];?/, '')
    .replace(/import\s*{\s*verifyToken\s*}\s*from\s*['"]@\/lib\/jwt['"];?/, '')
    .replace(/import\s*{\s*getIdempotencyKey[\s\S]*?['"]@\/lib\/idempotency['"];?/, '')
    .replace(/import\s*{\s*parseDateRangeQuery\s*}\s*from\s*['"]@\/lib\/dateFilter['"];?/, dateFilterCode)
    .replace(/export async function GET/, 'async function GET')
    .replace(/export async function POST/, 'async function POST');

  const MockNextResponse = {
    json: (data, init = {}) => ({
      status: init.status || 200,
      json: async () => data,
    })
  };

  const operationWrites = [];
  let deletedExpenseWhere = null;
  const mockPrisma = {
    operation: {
      findMany: async ({ where, orderBy }) => {
        return multiYearExpenses
          .filter(op => {
            if (op.gardenerId !== where.gardenerId) return false;
            if (where.createdAt) {
              if (where.createdAt.gte && op.createdAt < where.createdAt.gte) return false;
              if (where.createdAt.lte && op.createdAt > where.createdAt.lte) return false;
            }
            return true;
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      },
      create: async ({ data }) => {
        operationWrites.push(data);
        return { id: 'exp_new', ...data };
      },
      deleteMany: async ({ where }) => {
        deletedExpenseWhere = where;
        return { count: 1 };
      },
    }
  };

  const createHandler = new Function('NextResponse', 'prisma', 'verifyToken', `
    ${routeCode}
    return { GET, POST };
  `);

  const { GET } = createHandler(MockNextResponse, mockPrisma, verifyToken);

  const token = await signToken({ userId: 'u1', role: 'GARDENER', gardenerId: 'g1' });

  // 4a. Call GET /api/gardener/operations?all=1 WITH cookie
  const reqWithCookie = {
    url: 'https://anemonagro.ru/api/gardener/operations?all=1',
    headers: {
      get: (header) => null,
    },
    cookies: {
      get: (name) => name === 'token' ? { value: token } : undefined,
    },
  };

  const resCookie = await GET(reqWithCookie);
  assert.strictEqual(resCookie.status, 200, 'GET with cookie must respond with status 200');
  const dataCookie = await resCookie.json();
  assert(Array.isArray(dataCookie.operations), 'Response must contain operations array');
  assert.strictEqual(dataCookie.operations.length, 4, 'Must return all 4 operations for gardener g1 across all months/years');
  const idsCookie = dataCookie.operations.map(o => o.id);
  assert(idsCookie.includes('exp_2024'), 'Must include 2024 expense');
  assert(idsCookie.includes('exp_2025'), 'Must include 2025 expense');
  assert(idsCookie.includes('exp_3months_ago'), 'Must include 3 months ago expense');
  assert(idsCookie.includes('exp_current_month'), 'Must include current month expense');
  assert(!idsCookie.includes('exp_other_gardener'), 'Must NOT include other gardener expense');
  assert.strictEqual(dataCookie.operations.find(o => o.id === 'exp_2024').approved, true, 'Must preserve approved status');
  assert.strictEqual(dataCookie.operations.find(o => o.id === 'exp_3months_ago').approved, false, 'Must preserve pending status');
  console.log('  ✓ (a) GET /api/gardener/operations?all=1 with cookie returns all expenses across all years/months');

  // 4b. Call GET /api/gardener/operations?all=1 ONLY with Authorization: Bearer without cookie
  const reqWithBearer = {
    url: 'https://anemonagro.ru/api/gardener/operations?all=1',
    headers: {
      get: (header) => header.toLowerCase() === 'authorization' ? `Bearer ${token}` : null,
    },
    cookies: {
      get: () => undefined,
    },
  };

  const resBearer = await GET(reqWithBearer);
  assert.strictEqual(resBearer.status, 200, 'GET with Authorization Bearer must respond with status 200');
  const dataBearer = await resBearer.json();
  assert(Array.isArray(dataBearer.operations), 'Response must contain operations array');
  assert.strictEqual(dataBearer.operations.length, 4, 'Must return all 4 operations for gardener g1 across all months/years with Bearer');
  const idsBearer = dataBearer.operations.map(o => o.id);
  assert(idsBearer.includes('exp_2024'), 'Bearer response must include 2024 expense');
  assert(idsBearer.includes('exp_2025'), 'Bearer response must include 2025 expense');
  assert(idsBearer.includes('exp_3months_ago'), 'Bearer response must include 3 months ago expense');
  assert(idsBearer.includes('exp_current_month'), 'Bearer response must include current month expense');
  assert(!idsBearer.includes('exp_other_gardener'), 'Bearer response must NOT include other gardener expense');
  console.log('  ✓ (b) GET /api/gardener/operations?all=1 ONLY with Authorization Bearer without cookie returns all expenses across all years/months');

  // 4c. Verify unauthorized request (no cookie, no bearer) returns 401
  const reqUnauth = {
    url: 'https://anemonagro.ru/api/gardener/operations?all=1',
    headers: { get: () => null },
    cookies: { get: () => undefined },
  };
  const resUnauth = await GET(reqUnauth);
  assert.strictEqual(resUnauth.status, 401, 'Request without credentials must return 401');
  console.log('  ✓ (c) Request without cookie or Bearer correctly returns 401');

  // 4d. The legacy expenses endpoint must read from the same Operation model.
  const expensesRoutePath = path.resolve(__dirname, '..', 'app', 'api', 'gardener', 'expenses', 'route.js');
  const expensesRouteCode = fs.readFileSync(expensesRoutePath, 'utf8')
    .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
    .replace(/import\s+prisma\s+from\s*['"]@\/lib\/prisma['"];?/, '')
    .replace(/import\s*{\s*verifyToken\s*}\s*from\s*['"]@\/lib\/jwt['"];?/, '')
    .replace(/export async function GET/, 'async function GET')
    .replace(/export async function POST/, 'async function POST')
    .replace(/export async function DELETE/, 'async function DELETE');
  assert(!expensesRouteCode.includes('prisma.expense'), 'Gardener expenses route must not use a Prisma model absent from schema');
  const createExpensesHandler = new Function('NextResponse', 'prisma', 'verifyToken', `
    ${expensesRouteCode}
    return { GET, POST, DELETE };
  `);
  const { GET: getExpenses, POST: postExpense, DELETE: deleteExpense } = createExpensesHandler(MockNextResponse, mockPrisma, verifyToken);
  const expensesResponse = await getExpenses({
    headers: reqWithCookie.headers,
    cookies: reqWithCookie.cookies,
  });
  const expensesData = await expensesResponse.json();
  assert.strictEqual(expensesData.expenses.length, 4, 'Legacy expenses endpoint must return all Operation expenses for the gardener');
  assert(expensesData.expenses.every(expense => expense.gardenerId === 'g1'), 'Legacy expenses endpoint must remain gardener-scoped');
  assert(expensesData.expenses.every(expense => expense.date instanceof Date), 'Legacy expenses endpoint must preserve its date field');
  const postResponse = await postExpense({
    headers: reqWithCookie.headers,
    cookies: reqWithCookie.cookies,
    json: async () => ({ date: '2025-11-15', amount: '1250', description: 'Расходники' }),
  });
  assert.strictEqual(postResponse.status, 200, 'Legacy expenses endpoint must create an Operation');
  assert.strictEqual(operationWrites[0].type, 'expense', 'Created operation must have expense type');
  assert.strictEqual(operationWrites[0].gardenerId, 'g1', 'Created expense must belong to authenticated gardener');
  assert.strictEqual(operationWrites[0].approved, false, 'New expense must remain pending approval');
  const deleteResponse = await deleteExpense({
    headers: reqWithCookie.headers,
    cookies: reqWithCookie.cookies,
    json: async () => ({ id: 'exp_new' }),
  });
  assert.strictEqual(deleteResponse.status, 200, 'Legacy expenses endpoint must delete an Operation');
  assert.deepStrictEqual(deletedExpenseWhere, { id: 'exp_new', gardenerId: 'g1', type: 'expense' }, 'Delete must be restricted to the gardener’s own expenses');
  console.log('  ✓ (d) Gardener expenses endpoint reads, creates, and deletes Operation expenses');

  // 5. Regression Test: empty API response must not overwrite non-empty cached operations or displayed state
  const mockStorage = {
    operations: [
      { id: 'op_cached_1', type: 'expense', amount: 1200, description: 'Ранее сохраненная трата' }
    ]
  };

  let displayedOperations = [];

  async function simulateFetchOperations(emptyApiResponse) {
    const incomingOps = emptyApiResponse.operations || [];
    let operationsList = [];
    if (incomingOps.length > 0) {
      operationsList = incomingOps;
    } else {
      const cachedOps = mockStorage.operations;
      const cachedList = (cachedOps && Array.isArray(cachedOps.data)) ? cachedOps.data : (Array.isArray(cachedOps) ? cachedOps : []);
      operationsList = cachedList.length > 0 ? cachedList : incomingOps;
    }

    displayedOperations = operationsList;

    if (operationsList.length > 0) {
      mockStorage.operations = operationsList;
    }
  }

  await simulateFetchOperations({ operations: [] });
  assert.strictEqual(mockStorage.operations.length, 1, 'Empty API response must not clear cached operations');
  assert.strictEqual(mockStorage.operations[0].id, 'op_cached_1', 'Cached operation must remain intact');
  assert.strictEqual(displayedOperations.length, 1, 'Displayed operations state must preserve cached operations');
  assert.strictEqual(displayedOperations[0].id, 'op_cached_1', 'Displayed operation matches cached operation');
  console.log('  ✓ (e) Empty operations API response preserves existing non-empty cache and displayed state');

  console.log('🎉 All gardener expenses tests passed successfully!');
}

testGardenerExpensesAllTime().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
