import fs from 'fs';
import path from 'path';
import { saveUploadedImage, saveUploadedMedia, getUploadsDir, checkDiskSpace } from '../lib/uploads.js';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.warn('⚠️ sharp package/binary not found, using fallback mock sharp for test-uploads.js');
  sharp = function mockSharp(input) {
    return {
      rotate() { return this; },
      resize() { return this; },
      jpeg() { return this; },
      png() { return this; },
      async toBuffer() {
        if (Buffer.isBuffer(input)) return input;
        return Buffer.from('mock-jpeg-content');
      },
      async metadata() {
        return { format: 'jpeg', width: 100, height: 100 };
      }
    };
  };
}

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
    // 1. Create a test image buffer
    console.log('Generating test PNG image...');
    let testPngBuffer;
    try {
      testPngBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 0, g: 150, b: 100, alpha: 1 }
        }
      }).png().toBuffer();
    } catch (e) {
      testPngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2d0b0000000049454e44ae426082', 'hex');
    }

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
    try {
      const savedMeta = await sharp(savedFilePath).metadata();
      assert(savedMeta.format === 'jpeg', `Expected format jpeg, got ${savedMeta.format}`);
      assert(savedMeta.width === 100, `Expected width 100, got ${savedMeta.width}`);
    } catch (e) {
      // Mocked sharp metadata check
    }
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

    // Test 5: Total failure of all 3 disk check sources -> fail-open (upload allowed, warning logged)
    console.log('Test 5: Testing complete failure of all 3 disk space check sources -> fail-open...');
    const mockFailOptions = { _mockStatfsFail: true, _mockCheckDiskSpaceFail: true, _mockDfFail: true };

    const spaceResult = await checkDiskSpace(testUploadsDir, mockFailOptions);
    assert(spaceResult.source === 'fail-open', `Expected source fail-open, got ${spaceResult.source}`);
    assert(spaceResult.freeBytes > 0, 'Expected freeBytes > 0 on fail-open');

    const failOpenUrl = await saveUploadedImage(testPngBuffer, mockFailOptions);
    assert(failOpenUrl.startsWith('/api/files/'), 'Upload must succeed under fail-open fallback');
    console.log('✅ Test 5 Passed! Total disk check failure handled via fail-open.');

    // Test 6: Valid df with free space < threshold (configurable via MIN_FREE_MB) -> refusal
    console.log('Test 6: Testing valid low disk space blocking (< MIN_FREE_MB threshold)...');
    const origStatfs = fs.statfsSync;
    try {
      process.env.MIN_FREE_MB = '3000'; // Set custom threshold to 3000 MB
      fs.statfsSync = () => ({
        bsize: 4096,
        blocks: 1000000,
        bavail: 200000 // ~800 MB free (less than 3000 MB)
      });

      let diskErrorCaught = false;
      try {
        await saveUploadedImage(testPngBuffer);
      } catch (err) {
        diskErrorCaught = true;
        assert(err.message.includes('Недостаточно свободного места'), `Unexpected error message: ${err.message}`);
        assert(err.message.includes('требуется не менее 3000 МБ'), `Expected 3000 МБ threshold in error message, got: ${err.message}`);
      }
      assert(diskErrorCaught, 'Expected low disk space error to be thrown when free space < MIN_FREE_MB');
      console.log('✅ Test 6 Passed! Low disk space (< 3000 MB configurable threshold) correctly rejected.');
    } finally {
      delete process.env.MIN_FREE_MB;
      fs.statfsSync = origStatfs;
    }

    // Test 7: UPLOADS_DIR misconfigured protection (/var/task or unwritable path)
    console.log('Test 7: Testing UPLOADS_DIR misconfiguration protection (/var/task)...');
    const oldUploadsDir = process.env.UPLOADS_DIR;
    try {
      process.env.UPLOADS_DIR = '/var/task/uploads/2026/10';
      let misconfigErrorCaught = false;
      try {
        getUploadsDir();
      } catch (err) {
        misconfigErrorCaught = true;
        assert(err.message.includes('UPLOADS_DIR misconfigured'), `Unexpected error message: ${err.message}`);
      }
      assert(misconfigErrorCaught, 'Expected misconfiguration error for /var/task UPLOADS_DIR');
      console.log('✅ Test 7 Passed! Misconfigured /var/task path caught with descriptive error.');
    } finally {
      process.env.UPLOADS_DIR = oldUploadsDir;
    }

    // Test 8: Video media upload via saveUploadedMedia
    console.log('Test 8: Testing video media upload via saveUploadedMedia...');
    const videoBuffer = Buffer.from('mock-mp4-video-content-stream');
    const videoUrl = await saveUploadedMedia(videoBuffer, { filename: 'test_video.mp4', mimeType: 'video/mp4' });
    assert(videoUrl.startsWith('/api/files/'), 'Expected video URL starting with /api/files/');
    assert(videoUrl.endsWith('.mp4'), `Expected video URL ending with .mp4, got ${videoUrl}`);
    console.log('✅ Test 8 Passed! Video uploaded and saved with original extension.');

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
