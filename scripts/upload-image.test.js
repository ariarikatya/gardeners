import fs from 'fs';
import path from 'path';
import { saveUploadedImage, getUploadsDir } from '../lib/uploads.js';

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

// Load POST handler from app/api/upload-image/route.js dynamically
const routePath = path.resolve('app/api/upload-image/route.js');
let routeCode = fs.readFileSync(routePath, 'utf8');
routeCode = routeCode
  .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
  .replace(/import\s*{\s*saveUploadedImage\s*}\s*from\s*['"]@\/lib\/uploads['"];?/, '')
  .replace(/export async function POST/, 'async function POST');

const createPostHandler = new Function('NextResponse', 'saveUploadedImage', `
  ${routeCode}
  return POST;
`);

const handlePost = createPostHandler(MockNextResponse, saveUploadedImage);

function createMockJsonRequest(bodyObj) {
  return {
    async json() {
      return bodyObj;
    }
  };
}

async function runUploadImageRouteTests() {
  console.log('🧪 Starting POST /api/upload-image Route Integration Tests...');

  const testUploadsDir = path.resolve('./uploads_test_route_temp');
  process.env.UPLOADS_DIR = testUploadsDir;

  try {
    // 1. Test 1: Successful image upload (base64 1x1 PNG)
    console.log('Test 1: Uploading valid base64 image via POST /api/upload-image...');
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const req = createMockJsonRequest({ image: sampleBase64 });
    const res = await handlePost(req);

    assert(res.status === 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();

    assert(data.success === true, 'Expected success: true in response');
    assert(typeof data.url === 'string' && data.url.startsWith('/api/files/'), `Expected valid file URL starting with /api/files/, got ${data.url}`);

    // Verify physical file existence in UPLOADS_DIR
    const pathParts = data.url.replace('/api/files/', '').split('/');
    const physicalPath = path.join(testUploadsDir, ...pathParts);

    assert(fs.existsSync(physicalPath), `Expected saved file to exist physically at ${physicalPath}`);
    assert(fs.statSync(physicalPath).size > 0, 'Saved file must not be empty');
    console.log('✅ Test 1 Passed! Valid 200 response with url and physical file present on disk.');

    // 2. Test 2: Missing image payload (400)
    console.log('Test 2: Rejection of missing image payload...');
    const emptyReq = createMockJsonRequest({});
    const resEmpty = await handlePost(emptyReq);

    assert(resEmpty.status === 400, `Expected HTTP 400 for missing payload, got ${resEmpty.status}`);
    const emptyData = await resEmpty.json();
    assert(emptyData.error === 'No image data provided', `Unexpected error message: ${emptyData.error}`);
    console.log('✅ Test 2 Passed! Missing image payload rejected with 400.');

    // 3. Test 3: Oversized image payload (>25MB)
    console.log('Test 3: Rejection of oversized image payload (>25 MB)...');
    const hugeBuffer = Buffer.alloc(26 * 1024 * 1024); // 26 MB
    const oversizedReq = createMockJsonRequest({ image: hugeBuffer.toString('base64') });
    const resOversized = await handlePost(oversizedReq);

    assert(resOversized.status === 500, `Expected HTTP 500 for oversized payload, got ${resOversized.status}`);
    const oversizedData = await resOversized.json();
    assert(oversizedData.error.includes('слишком большой'), `Expected "слишком большой" error, got: ${oversizedData.error}`);
    console.log('✅ Test 3 Passed! Oversized image (>25MB) correctly rejected.');

    // 4. Test 4: Invalid image payload data type
    console.log('Test 4: Rejection of invalid data format...');
    const invalidReq = createMockJsonRequest({ image: 123456 });
    const resInvalid = await handlePost(invalidReq);

    assert(resInvalid.status === 500, `Expected HTTP 500 for invalid data format, got ${resInvalid.status}`);
    const invalidData = await resInvalid.json();
    assert(invalidData.error === 'Некорректные данные изображения', `Unexpected error message: ${invalidData.error}`);
    console.log('✅ Test 4 Passed! Invalid data format rejected.');

    console.log('\n🎉 ALL POST /api/upload-image ROUTE TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (fs.existsSync(testUploadsDir)) {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
    }
  }
}

runUploadImageRouteTests().catch(err => {
  console.error('❌ Upload-image route test failed:', err);
  process.exit(1);
});
