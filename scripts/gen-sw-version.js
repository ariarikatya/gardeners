const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version || '1.0.0';
const todayCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');

let gitSha = '';
try {
  gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch (e) {
  gitSha = process.env.COMMIT_REF
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.NETLIFY_BUILD_ID
    || Date.now().toString(36).slice(-6);
}

if (!gitSha) {
  gitSha = 'dev';
}

const swCacheName = `anemon-agro-v${version}-${todayCode}-${gitSha}`;
const clientVersion = `v${version}-${todayCode}-${gitSha}`;

const libDir = path.join(__dirname, '..', 'lib');
if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

// 1. Generate lib/swVersion.generated.js & lib/version.js
const generatedJsContent = `// Auto-generated build version file. Do not edit manually.
export const GENERATED_CLIENT_VERSION = '${clientVersion}';
export const GENERATED_SW_CACHE_NAME = '${swCacheName}';
`;

fs.writeFileSync(path.join(libDir, 'swVersion.generated.js'), generatedJsContent, 'utf8');

const versionJsContent = `// Auto-generated build version file. Do not edit manually.
export const CLIENT_VERSION = '${clientVersion}';
export const SW_CACHE_NAME = '${swCacheName}';
export const CACHE_NAME = '${swCacheName}';
`;

fs.writeFileSync(path.join(libDir, 'version.js'), versionJsContent, 'utf8');

// 2. Ensure public/sw.js exists if deleted
const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
const swPath = path.join(publicDir, 'sw.js');

if (!fs.existsSync(swPath)) {
  const defaultSwContent = `// Fallback Service Worker template
function getCacheName() {
  try {
    if (typeof self !== 'undefined' && self.location) {
      const url = new URL(self.location.href || self.location);
      const v = url.searchParams.get('v');
      if (v) {
        return v.startsWith('anemon-agro-') ? v : \`anemon-agro-\${v}\`;
      }
    }
  } catch (e) {}
  return 'anemon-agro-v1.0.0';
}

let CACHE_NAME = getCacheName();
const APP_SHELL = ['/', '/gardener', '/admin', '/leader', '/login', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
`;
  fs.writeFileSync(swPath, defaultSwContent, 'utf8');
  console.log('[gen-sw-version] Recreated missing public/sw.js placeholder');
}

console.log(`[gen-sw-version] Generated clientVersion: ${clientVersion}, swCacheName: ${swCacheName}`);
