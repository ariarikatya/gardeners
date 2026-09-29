const assert = require('assert');
const { round2, calculateOrderSplit, DEFAULT_GARDENER_PERCENT } = require('../lib/money');

function runTests() {
  console.log('🧪 Starting tests for money rounding and order split logic...\n');

  // Test 1: Standard calculation 17000 @ 64.5% writeoffPercent (gardener share)
  console.log('Test 1: Standard case 17000 @ 64.5% writeoffPercent');
  const res1 = calculateOrderSplit(17000, 64.5);
  assert.strictEqual(res1.employeeSalary, 10965, 'employeeSalary should be 10965 (17000 * 0.645)');
  assert.strictEqual(res1.companyShare, 6035, 'companyShare should be 6035 (17000 - 10965)');
  assert.strictEqual(res1.employeeSalary + res1.companyShare, 17000, 'Sum must equal price');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Leader aggregate totalCompanyShare for an order without saved companyShare field
  console.log('Test 2: Leader aggregate totalCompanyShare check for unsaved order (17000 @ 64.5%)');
  const gardeners = [{ id: 'g1', writeoffPercent: 64.5 }];
  const order = { id: 'o1', gardenerId: 'g1', priceFact: 17000, companyShare: 0 };
  const g = gardeners.find(item => item.id === order.gardenerId);
  const split = calculateOrderSplit(Number(order.priceFact || order.priceContract || 0), g?.writeoffPercent);
  assert.strictEqual(split.companyShare, 6035, 'totalCompanyShare fallback for unsaved order should be 6035');
  console.log('✅ Test 2 passed!\n');

  // Test 3: Contract only (priceContract=8000, writeoffPercent=64.5)
  console.log('Test 3: Contract only 8000 @ 64.5%');
  const res3 = calculateOrderSplit(8000, 64.5);
  assert.strictEqual(res3.employeeSalary, 5160, 'salary should be 5160 (8000 * 0.645)');
  assert.strictEqual(res3.companyShare, 2840, 'share should be 2840 (8000 - 5160)');
  assert.strictEqual(res3.employeeSalary + res3.companyShare, 8000, 'Sum must equal price');
  console.log('✅ Test 3 passed!\n');

  // Test 4: Fractional case (priceFact=10001, writeoffPercent=64.5)
  console.log('Test 4: Fractional case 10001 @ 64.5%');
  const res4 = calculateOrderSplit(10001, 64.5);
  assert.strictEqual(res4.employeeSalary, 6450.65, 'salary should be 6450.65');
  assert.strictEqual(res4.companyShare, 3550.35, 'share should be 3550.35');
  assert.strictEqual(round2(res4.employeeSalary + res4.companyShare), 10001, 'Exact sum');
  console.log('✅ Test 4 passed!\n');

  // Test 5: Default percentage fallback when writeoffPercent = 0 / undefined / null
  console.log('Test 5: Default percentage fallback when writeoffPercent = 0');
  assert.strictEqual(DEFAULT_GARDENER_PERCENT, 64.5, 'Default gardener percent should be 64.5');
  const res5 = calculateOrderSplit(17000, 0);
  assert.strictEqual(res5.employeeSalary, 10965);
  assert.strictEqual(res5.companyShare, 6035);
  console.log('✅ Test 5 passed!\n');

  // Test 6: Invariant verification across arbitrary prices
  console.log('Test 6: Invariant salary + share === price across arbitrary test prices');
  const testPrices = [1, 99, 100, 1000, 5555, 12345.67, 99999];
  for (const price of testPrices) {
    const split = calculateOrderSplit(price, 64.5);
    assert.strictEqual(round2(split.employeeSalary + split.companyShare), price, `Invariant failed for price ${price}`);
  }
  console.log('✅ Test 6 passed!\n');

  console.log('🎉 All money split tests passed successfully!');
}

runTests();
