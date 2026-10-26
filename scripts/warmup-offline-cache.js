const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000';
const TARGET_DIR = path.join(__dirname, '..', 'public', 'offline-cache');

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

function fetchUrlNoRedirect(urlStr) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith('https') ? https : http;
    const req = client.get(urlStr, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        return reject(new Error(`HTTP ${res.statusCode} redirect to ${res.headers.location}`));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${urlStr}`));
    });
  });
}

async function warmup() {
  console.log(`[warmup-offline-cache] Starting offline cache warmup from ${BASE_URL}...`);

  const routes = [
    { path: '/login', file: 'login.html' },
    { path: '/admin', file: 'admin.html' },
    { path: '/leader', file: 'leader.html' },
    { path: '/gardener', file: 'gardener.html' },
    { path: '/api/public/offline-users', file: 'offline-users.json' },
  ];

  let successCount = 0;

  for (const item of routes) {
    const fullUrl = `${BASE_URL.replace(/\/$/, '')}${item.path}`;
    const destPath = path.join(TARGET_DIR, item.file);
    try {
      const content = await fetchUrlNoRedirect(fullUrl);
      fs.writeFileSync(destPath, content, 'utf8');
      console.log(`  ✓ Saved ${item.path} -> public/offline-cache/${item.file}`);
      successCount++;
    } catch (err) {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      console.warn(`  ⚠️ Skipped ${item.path}: ${err.message}`);
    }
  }

  console.log(`[warmup-offline-cache] Warmup complete. ${successCount}/${routes.length} artifacts created.`);
}

warmup().catch((err) => {
  console.error('[warmup-offline-cache] Fatal warmup error:', err.message);
  process.exit(0); // non-zero exit avoided to not break deploy pipeline
});
