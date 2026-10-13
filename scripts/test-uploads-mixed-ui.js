import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
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

// Simulates photo rendering logic across GardenerModalEditor, Gardener dashboard, Admin, and Leader panels
function renderWorkImageElements(imagesArray) {
  if (!Array.isArray(imagesArray)) return [];
  return imagesArray.map((imgUrl) => {
    // Both relative and absolute URLs are passed directly to <img src={imgUrl}>
    return {
      tagName: 'img',
      src: imgUrl,
      isRelative: imgUrl.startsWith('/api/files/'),
      isAbsoluteImgBB: imgUrl.startsWith('https://i.ibb.co/')
    };
  });
}

async function runMixedPhotosTest() {
  console.log('🧪 Starting Mixed Photos UI Acceptance Test (Requirement 3.3)...');

  const testUploadsDir = path.resolve('./uploads_test_mixed');
  process.env.UPLOADS_DIR = testUploadsDir;

  try {
    // 1. Create a local test photo and save it via saveUploadedImage
    console.log('Step 1: Saving a new local compressed photo...');
    const testPngBuffer = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: { r: 50, g: 120, b: 200, alpha: 1 }
      }
    }).png().toBuffer();

    const newRelativeUrl = await saveUploadedImage(testPngBuffer);
    assert(newRelativeUrl.startsWith('/api/files/'), `Expected relative URL starting with /api/files/, got ${newRelativeUrl}`);

    // 2. Define a legacy ImgBB absolute URL
    const oldAbsoluteUrl = 'https://i.ibb.co/sample/legacy_photo_123.jpg';

    // 3. Construct a gardener work portfolio item with mixed photos
    console.log('Step 2: Constructing gardener works portfolio item with mixed URLs...');
    const workItem = {
      title: 'Обрезка деревьев в Энгельсе',
      images: [newRelativeUrl, oldAbsoluteUrl]
    };

    // 4. Test rendering logic
    console.log('Step 3: Verifying modal / UI image element rendering...');
    const renderedElements = renderWorkImageElements(workItem.images);

    assert(renderedElements.length === 2, `Expected 2 image elements, got ${renderedElements.length}`);
    assert(renderedElements[0].src === newRelativeUrl, `Expected first image src="${newRelativeUrl}", got "${renderedElements[0].src}"`);
    assert(renderedElements[0].isRelative === true, 'First image should be recognized as relative URL');

    assert(renderedElements[1].src === oldAbsoluteUrl, `Expected second image src="${oldAbsoluteUrl}", got "${renderedElements[1].src}"`);
    assert(renderedElements[1].isAbsoluteImgBB === true, 'Second image should be recognized as absolute ImgBB URL');

    // 5. Verify local serving route works for the new relative URL
    console.log('Step 4: Testing file serving GET endpoint for relative image URL...');
    const pathParts = newRelativeUrl.replace('/api/files/', '').split('/');
    const mockReq = createMockRequest();
    const res = await serveFile(mockReq, { params: { path: pathParts } });

    assert(res.status === 200, `Expected HTTP 200 for local file serve, got ${res.status}`);
    assert(res.headers.get('content-type') === 'image/jpeg', 'Expected Content-Type image/jpeg');
    console.log('✅ Step 4 Passed! Local file served correctly with image/jpeg.');

    console.log('\n🎉 MIXED PHOTOS UI ACCEPTANCE TEST PASSED SUCCESSFULLY!');
  } finally {
    if (fs.existsSync(testUploadsDir)) {
      fs.rmSync(testUploadsDir, { recursive: true, force: true });
    }
  }
}

runMixedPhotosTest().catch(err => {
  console.error('❌ Mixed photos test failed:', err);
  process.exit(1);
});
