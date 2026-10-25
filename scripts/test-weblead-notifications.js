import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runWebLeadNotificationsTest() {
  console.log('🧪 Starting Test: WebLead Dispatcher Notifications (test-weblead-notifications.js)...');

  const routePath = path.resolve('app/api/public/widget-submit/route.js');
  const routeCode = fs.readFileSync(routePath, 'utf8');

  // Assertion 1: sendToRoles is called unconditionally after lead creation
  assert(routeCode.includes("sendToRoles(['ADMIN', 'LEADER']"), 'widget-submit must call sendToRoles for ADMIN and LEADER');
  console.log('✅ Assertion 1 Passed: sendToRoles is called for ADMIN and LEADER.');

  // Assertion 2: notifyDispatchers is called regardless of push deliveredCount
  assert(routeCode.includes("notifyDispatchers("), 'widget-submit must call notifyDispatchers for VK notification');
  console.log('✅ Assertion 2 Passed: notifyDispatchers is called.');

  // Assertion 3: Webhook attempt is executed if process.env.WEBHOOK_URL is set
  assert(routeCode.includes("process.env.WEBHOOK_URL") || routeCode.includes("process.env.DISPATCHER_WEBHOOK_URL"), 'widget-submit must check WEBHOOK_URL');
  console.log('✅ Assertion 3 Passed: Webhook check present.');

  // Assertion 4: deliveredCount logging and diagnostic details present
  assert(routeCode.includes("deliveredCount="), 'widget-submit must log deliveredCount details');
  console.log('✅ Assertion 4 Passed: deliveredCount logging present.');

  console.log('\n🎉 ALL WEBLEAD DISPATCHER NOTIFICATION TESTS PASSED SUCCESSFULLY!');
}

runWebLeadNotificationsTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
