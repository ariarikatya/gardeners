const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BASE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://127.0.0.1:3000';
const TARGET_DIR = path.join(__dirname, '..', 'public', 'offline-cache');

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

const { SignJWT } = require('jose');
const prisma = require('../lib/prisma');

async function generateRoleToken(role) {
  if (process.env.WARMUP_TOKEN) {
    return process.env.WARMUP_TOKEN;
  }

  const secretStr = process.env.JWT_SECRET || 'fallback-secret-use-env-in-prod';
  const secret = new TextEncoder().encode(secretStr);

  let userId = 'warmup_user_' + role.toLowerCase();
  let phone = '79990000000';
  let gardenerId = null;

  try {
    if (role === 'GARDENER') {
      const dbGardener = await prisma.gardener.findFirst({ select: { id: true, phone: true } });
      if (dbGardener) {
        gardenerId = dbGardener.id;
        if (dbGardener.phone) phone = dbGardener.phone;
      }
    } else {
      const dbUser = await prisma.user.findFirst({ where: { role }, select: { id: true, phone: true } });
      if (dbUser) {
        userId = dbUser.id;
        if (dbUser.phone) phone = dbUser.phone;
      }
    }
  } catch (e) {
    // If DB is offline, fall back to default token payload
  }

  const payload = { userId, phone, role, ...(gardenerId ? { gardenerId } : {}) };
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(secret);
}

function fetchUrlWithAuth(urlStr, token = null) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith('https') ? https : http;
    const urlObj = new URL(urlStr);

    const headers = {};
    if (token) {
      headers['Cookie'] = `token=${token}`;
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlStr.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: 10000,
    };

    const req = client.request(options, (res) => {
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

    req.end();
  });
}

async function warmup() {
  console.log(`[warmup-offline-cache] Starting offline cache warmup from ${BASE_URL}...`);

  const adminToken = await generateRoleToken('ADMIN');
  const leaderToken = await generateRoleToken('LEADER');
  const gardenerToken = await generateRoleToken('GARDENER');

  const routes = [
    { path: '/login', file: 'login.html', token: null },
    { path: '/admin', file: 'admin.html', token: adminToken },
    { path: '/leader', file: 'leader.html', token: leaderToken },
    { path: '/gardener', file: 'gardener.html', token: gardenerToken },
    { path: '/api/public/offline-users', file: 'offline-users.json', token: null },
  ];

  let successCount = 0;

  for (const item of routes) {
    const fullUrl = `${BASE_URL.replace(/\/$/, '')}${item.path}`;
    const destPath = path.join(TARGET_DIR, item.file);
    try {
      const content = await fetchUrlWithAuth(fullUrl, item.token);
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
