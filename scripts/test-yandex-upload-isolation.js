process.env.NODE_ENV = 'test';

import assert from 'assert';
import fs from 'fs';
import path from 'path';

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

async function runUploadIsolationTest() {
  console.log('🧪 Starting Yandex.Disk Upload Isolation Test...');

  const testUploadsDir = path.resolve('./uploads_test_isolation_temp');
  process.env.UPLOADS_DIR = testUploadsDir;

  try {
    // Dynamically load route logic from app/api/gardener/upload/route.js
    const routePath = path.resolve('app/api/gardener/upload/route.js');
    let routeCode = fs.readFileSync(routePath, 'utf8');

    routeCode = routeCode
      .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
      .replace(/import\s*{\s*verifyToken\s*}\s*from\s*['"]@\/lib\/jwt['"];?/, '')
      .replace(/import\s+prisma\s+from\s+['"]@\/lib\/prisma['"];?/, '')
      .replace(/import\s*{\s*scheduleYandexUpload\s*}\s*from\s*['"]@\/lib\/yandexDisk['"];?/, '')
      .replace(/import\s*{\s*saveUploadedImage\s*}\s*from\s*['"]@\/lib\/uploads['"];?/, '')
      .replace(/async function checkGardener\(req\)\s*{[\s\S]*?\n}/, 'async function checkGardener(req) { return { payload: { name: "TestGardener", role: "GARDENER", gardenerId: "g1" } }; }')
      .replace(/export async function POST/, 'async function POST');

    const mockSaveUploadedImage = async () => '/api/files/2026/10/mock_uuid.jpg';
    const mockFailingScheduleYandexUpload = () => {
      throw new Error('Yandex.Disk connection failed or queue crashed!');
    };

    const createPostHandler = new Function(
      'NextResponse',
      'saveUploadedImage',
      'scheduleYandexUpload',
      `
      ${routeCode}
      return POST;
      `
    );

    const handlePost = createPostHandler(
      MockNextResponse,
      mockSaveUploadedImage,
      mockFailingScheduleYandexUpload
    );

    // Mock incoming Request with formData
    const mockFile = {
      name: 'photo.jpg',
      type: 'image/jpeg',
      async arrayBuffer() {
        return Buffer.from('mock jpeg binary content').buffer;
      }
    };

    const mockFormData = {
      getAll(key) {
        if (key === 'image') return [mockFile];
        return [];
      },
      get(key) {
        if (key === 'type') return 'order';
        if (key === 'which') return 'photo';
        return null;
      }
    };

    const mockReq = {
      cookies: {
        get(key) {
          if (key === 'token') return { value: 'valid-mock-token' };
          return null;
        }
      },
      async formData() {
        return mockFormData;
      }
    };

    console.log('Sending upload request while Yandex.Disk scheduleYandexUpload throws an exception...');
    const response = await handlePost(mockReq);

    assert.strictEqual(response.status, 200, `Expected HTTP 200, got ${response.status}`);
    const body = await response.json();

    assert.strictEqual(body.url, '/api/files/2026/10/mock_uuid.jpg', 'Primary image URL should be returned');
    assert.deepStrictEqual(body.urls, ['/api/files/2026/10/mock_uuid.jpg'], 'Array of image URLs should be returned');

    console.log('✅ Yandex.Disk Upload Isolation Test Passed! Upload succeeded with 200 despite Yandex.Disk exception.');
    process.exit(0);
  } finally {
    if (fs.existsSync(testUploadsDir)) {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
    }
  }
}

runUploadIsolationTest().catch(err => {
  console.error('❌ Upload isolation test failed:', err);
  process.exit(1);
});
