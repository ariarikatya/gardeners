import fs from 'fs';
import path from 'path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const routePath = path.resolve('app/api/upload-image/route.js');
let routeCode = fs.readFileSync(routePath, 'utf8');

// Convert ESM to execution-ready JS for Function constructor
routeCode = routeCode
  .replace(/import\s*{\s*NextResponse\s*}\s*from\s*['"]next\/server['"];?/, '')
  .replace(/export async function POST/, 'async function POST');

const MockNextResponse = {
  json: (data, init = {}) => ({
    status: init.status || 200,
    json: async () => data
  })
};

const createPostHandler = new Function('NextResponse', `
  ${routeCode}
  return POST;
`);

const POST = createPostHandler(MockNextResponse);

async function runTests() {
  console.log('🧪 Starting ImgBB Upload Resilience Tests...');

  const originalFetch = global.fetch;
  const originalKey = process.env.IMGBB_API_KEY;
  process.env.IMGBB_API_KEY = 'test_api_key_12345';

  try {
    // Test 1: Verify API key is passed in body and key is NOT in fetch URL
    {
      console.log('Test 1: Verify API key is passed in form body and not in URL query...');
      let requestedUrl = '';
      let requestedBody = '';

      global.fetch = async (url, options) => {
        requestedUrl = url;
        requestedBody = options.body;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { display_url: 'https://i.ibb.co/sample.jpg' } })
        };
      };

      const req = {
        json: async () => ({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' })
      };

      const res = await POST(req);
      const data = await res.json();

      assert(res.status === 200, 'Expected status 200');
      assert(data.success === true, 'Expected success true');
      assert(data.url === 'https://i.ibb.co/sample.jpg', 'Expected image URL');
      assert(requestedUrl === 'https://api.imgbb.com/1/upload', 'URL should not contain API key query params');
      assert(requestedBody.includes('key=test_api_key_12345'), 'Body should contain key=test_api_key_12345');
      console.log('✅ Test 1 Passed!');
    }

    // Test 2: Retryable ImgBB error code 111 returns 503 retryable after 3 attempts
    {
      console.log('Test 2: Verify code 111 causes 3 attempts and returns HTTP 503 retryable...');
      let attempts = 0;

      global.fetch = async (url, options) => {
        attempts++;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            status_code: 400,
            error: { message: 'Internal upload error', code: 111 },
            status_txt: 'Bad Request'
          })
        };
      };

      const req = {
        json: async () => ({ image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' })
      };

      const start = Date.now();
      const res = await POST(req);
      const duration = Date.now() - start;
      const data = await res.json();

      assert(attempts === 3, `Expected 3 attempts, got ${attempts}`);
      assert(res.status === 503, `Expected HTTP 503, got ${res.status}`);
      assert(data.retryable === true, 'Expected retryable: true');
      assert(duration >= 4000, `Expected delay >= 4000ms (1500+3000), got ${duration}ms`);
      console.log('✅ Test 2 Passed!');
    }

    // Test 3: Network exception returns 502 after 3 attempts
    {
      console.log('Test 3: Verify network error causes 3 attempts and returns HTTP 502...');
      let attempts = 0;

      global.fetch = async () => {
        attempts++;
        throw new Error('Fetch network failure');
      };

      const req = {
        json: async () => ({ image: 'somebase64data' })
      };

      const res = await POST(req);
      const data = await res.json();

      assert(attempts === 3, `Expected 3 attempts, got ${attempts}`);
      assert(res.status === 502, `Expected HTTP 502, got ${res.status}`);
      assert(data.error.includes('сеть недоступна'), 'Expected network error message');
      console.log('✅ Test 3 Passed!');
    }

    // Test 4: Non-retryable error (e.g., status 400 with invalid base64) stops immediately
    {
      console.log('Test 4: Non-retryable error stops on attempt 1...');
      let attempts = 0;

      global.fetch = async () => {
        attempts++;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            status_code: 400,
            error: { message: 'Invalid base64 string', code: 105 },
            status_txt: 'Bad Request'
          })
        };
      };

      const req = {
        json: async () => ({ image: 'invaliddata' })
      };

      const res = await POST(req);
      const data = await res.json();

      assert(attempts === 1, `Expected 1 attempt, got ${attempts}`);
      assert(res.status === 500, `Expected HTTP 500, got ${res.status}`);
      assert(data.error.includes('ImgBB API: 400 Invalid base64 string'), 'Expected formatted error message');
      console.log('✅ Test 4 Passed!');
    }

    console.log('\n🎉 ALL IMGBB UPLOAD TESTS PASSED SUCCESSFULLY!');
  } finally {
    global.fetch = originalFetch;
    process.env.IMGBB_API_KEY = originalKey;
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
