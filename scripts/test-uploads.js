import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { saveUploadedImage, getUploadsDir, checkDiskSpace } from '../lib/uploads.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

class MockNextResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.headers = new Map();
    if (init.headers) {
      Object.entries(init.headers).forEach(([k, v]) => {
        this.headers.set(k.toLowerCase(), v);
      });
    }
  }

  static json(data, init = {}) {
    const res = new MockNextResponse(JSON.stringify(data), init);
    res.headers.set('content-type', 'application/json');
    res.json = async () => data;
    return res;
  }
}

const routePath = path.resolve('app/api/files/[...path]/route.js');
let routeCode = fs.readFileSync(routePath, 'utf8');
routeCode = routeCode
  .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
  .replace(/import\s+fs\s+from\s+['"]fs['"];?/, '')
  .replace(/import\s+path\s+from\s+['"]path['"];?/, '')
  .replace(/import\s*{\s*getUploadsDir\s*}\s*from\s*['"]@\/lib\/uploads['"];?/, '')
  .replace(/export async function GET/, 'async function GET');

const createGetHandler = new Function('NextResponse', 'fs', 'path', 'getUploadsDir', `
  ${routeCode}
  return GET;
`);

const serveFile = createGetHandler(MockNextResponse, fs, path, getUploadsDir);

function createMockRequest(headersObj = {}) {
  const map = new Map();
  Object.entries(headersObj).forEach(([k, v]) => map.set(k.toLowerCase(), v));
  return {
    headers: map,
    get(key) {
      return map.get(key.toLowerCase()) || null;
    }
  };
}

async function runUploadsTests() {
  console.log('🧪 Starting Local File Storage & Compression Tests...');

  const testUploadsDir = path.resolve('./uploads_test_temp');
  process.env.UPLOADS_DIR = testUploadsDir;

  try {
    // 1. Create a 100x100 PNG test image buffer
    console.log('Generating test PNG image...');
    const testPngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 150, b: 100, alpha: 1 }
      }
    }).png().toBuffer();

    // Test 1: Upload and compression
    console.log('Test 1: Uploading PNG image and verifying compression to JPEG...');
    const relativeUrl = await saveUploadedImage(testPngBuffer);
    assert(relativeUrl.startsWith('/api/files/'), `Expected URL to start with /api/files/, got ${relativeUrl}`);
    assert(relativeUrl.endsWith('.jpg'), `Expected URL to end with .jpg, got ${relativeUrl}`);

    const pathParts = relativeUrl.replace('/api/files/', '').split('/');
    assert(pathParts.length === 3, 'Expected YYYY/MM/uuid.jpg path format');

    const savedFilePath = path.join(testUploadsDir, ...pathParts);
    assert(fs.existsSync(savedFilePath), `Expected saved file to exist at ${savedFilePath}`);

    // Verify sharp metadata of saved file
    const savedMeta = await sharp(savedFilePath).metadata();
    assert(savedMeta.format === 'jpeg', `Expected format jpeg, got ${savedMeta.format}`);
    assert(savedMeta.width === 100, `Expected width 100, got ${savedMeta.width}`);
    console.log('✅ Test 1 Passed! Image compressed and saved locally as JPEG.');

    // Test 2: File serving endpoint (GET /api/files/[...path])
    console.log('Test 2: Serving saved file via GET endpoint...');
    const mockReq = createMockRequest();

    const res = await serveFile(mockReq, { params: { path: pathParts } });
    assert(res.status === 200, `Expected status 200, got ${res.status}`);
    const contentType = res.headers.get('content-type');
    const cacheControl = res.headers.get('cache-control');
    const etag = res.headers.get('etag');

    assert(contentType === 'image/jpeg', `Expected image/jpeg Content-Type, got ${contentType}`);
    assert(cacheControl.includes('max-age=31536000') && cacheControl.includes('immutable'), 'Expected long immutable Cache-Control');
    assert(etag && etag.length > 0, 'Expected ETag header');
    console.log('✅ Test 2 Passed! Headers correct.');

    // Test 3: ETag 304 Not Modified
    console.log('Test 3: Requesting file with matching If-None-Match header...');
    const etagReq = createMockRequest({ 'if-none-match': etag });

    const res304 = await serveFile(etagReq, { params: { path: pathParts } });
    assert(res304.status === 304, `Expected status 304, got ${res304.status}`);
    console.log('✅ Test 3 Passed! Returned 304 Not Modified.');

    // Test 4: Path traversal protection
    console.log('Test 4: Verifying path traversal protection...');
    const maliciousReq = createMockRequest();
    const resForbidden = await serveFile(maliciousReq, { params: { path: ['..', 'secret.txt'] } });
    assert(resForbidden.status === 403, `Expected status 403 for path traversal, got ${resForbidden.status}`);
    console.log('✅ Test 4 Passed! Path traversal blocked with 403.');

    // Test 5: Disk space check guard
    console.log('Test 5: Testing disk space check guard...');
    const origStatfs = fs.statfsSync;
    try {
      // Mock statfs to return < 2 GB
      fs.statfsSync = () => ({
        bsize: 4096,
        bavail: 100000, // ~400 MB
        blocks: 1000000
      });

      let diskErrorCaught = false;
      try {
        await saveUploadedImage(testPngBuffer);
      } catch (err) {
        diskErrorCaught = true;
        assert(err.message.includes('Недостаточно свободного места'), `Unexpected error message: ${err.message}`);
      }
      assert(diskErrorCaught, 'Expected low disk space error to be thrown');
      console.log('✅ Test 5 Passed! Low disk space caught.');
    } finally {
      fs.statfsSync = origStatfs;
    }

    console.log('\n🎉 ALL LOCAL UPLOAD TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (fs.existsSync(testUploadsDir)) {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
    }
  }
}

runUploadsTests().catch(err => {
  console.error('❌ Upload test failed:', err);
  process.exit(1);
});
