// Verification test for isolated scheduled scripts (run-order-reminders.js and run-fine-checks.js)
const { execSync } = require('child_process');

console.log('🧪 Testing independent scheduled scripts execution...\n');

try {
  console.log('1. Testing node scripts/run-order-reminders.js...');
  const remindersOutput = execSync('node scripts/run-order-reminders.js', {
    env: { ...process.env, TZ: 'Europe/Moscow' },
    encoding: 'utf8',
  });
  console.log(remindersOutput);
  if (!remindersOutput.includes('Scheduled order reminders finished.')) {
    throw new Error('run-order-reminders.js output did not contain expected finish message');
  }
  console.log('✅ run-order-reminders.js executed successfully!\n');

  console.log('2. Testing node scripts/run-fine-checks.js...');
  const finesOutput = execSync('node scripts/run-fine-checks.js', {
    env: { ...process.env, TZ: 'Europe/Moscow' },
    encoding: 'utf8',
  });
  console.log(finesOutput);
  if (!finesOutput.includes('Scheduled fine checks finished.')) {
    throw new Error('run-fine-checks.js output did not contain expected finish message');
  }
  console.log('✅ run-fine-checks.js executed successfully!\n');

  console.log('3. Testing node scripts/run-scheduled-tasks.js...');
  const scheduledTasksOutput = execSync('node scripts/run-scheduled-tasks.js', {
    env: { ...process.env, TZ: 'Europe/Moscow' },
    encoding: 'utf8',
  });
  console.log(scheduledTasksOutput);
  if (
    !scheduledTasksOutput.includes('Scheduled fine checks finished.') ||
    !scheduledTasksOutput.includes('Scheduled order reminders finished.')
  ) {
    throw new Error('run-scheduled-tasks.js output did not contain expected finish messages');
  }
  console.log('✅ run-scheduled-tasks.js executed successfully!\n');

  console.log('🎉 All scheduled script tests passed successfully!');
} catch (e) {
  console.error('❌ Scheduled scripts test failed:', e.message);
  if (e.stdout) console.log('Stdout:', e.stdout);
  if (e.stderr) console.error('Stderr:', e.stderr);
  process.exit(1);
}
