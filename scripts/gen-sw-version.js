const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version || '1.0.0';
const todayCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const swCacheName = `anemon-agro-v${version}-${todayCode}`;
const clientVersion = `v${version}-${todayCode}`;

// 1. Generate lib/swVersion.generated.js
const generatedJsContent = `// Auto-generated build version file. Do not edit manually.
export const GENERATED_CLIENT_VERSION = '${clientVersion}';
export const GENERATED_SW_CACHE_NAME = '${swCacheName}';
`;

fs.writeFileSync(path.join(__dirname, '..', 'lib', 'swVersion.generated.js'), generatedJsContent, 'utf8');

// 2. Update CACHE_NAME in public/sw.js
const swPath = path.join(__dirname, '..', 'public', 'sw.js');
let swContent = fs.readFileSync(swPath, 'utf8');

swContent = swContent.replace(/const CACHE_NAME = 'anemon-agro-v[^']+';/, `const CACHE_NAME = '${swCacheName}';`);

fs.writeFileSync(swPath, swContent, 'utf8');

console.log(`[gen-sw-version] Generated clientVersion: ${clientVersion}, swCacheName: ${swCacheName}`);
