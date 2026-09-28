import assert from 'assert';

// Set dummy envs so getAmoCredentialsFromDb does not throw
process.env.AMO_CLIENT_ID = 'test_id';
process.env.AMO_CLIENT_SECRET = 'test_secret';
process.env.AMO_REFRESH_TOKEN = 'test_refresh';

async function runTests() {
  console.log('🧪 Starting tests for amoCRM contact deduplication and API v4 logic...\n');

  // Dynamic import of ES module amoApi
  const amoApiModule = await import('../lib/amoApi.js');
  const amoApi = amoApiModule.default || amoApiModule;

  // Test 1: Phone Normalization
  console.log('Test 1: Phone normalization across various input formats');
  assert.strictEqual(amoApi.normalizePhone('+7 999 123-45-67'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('8(999)1234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('79991234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('9991234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('+7 (908) 553-53-11'), '79085535311');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Mock API v4 behavior
  console.log('Test 2: Mock API v4 fulltext search, contact creation, and lead linkage');

  const contactsDb = [];
  const leadsDb = [];
  const notesDb = [];
  const linksDb = [];
  let contactPostCount = 0;
  let simulatePathAFailure = false;

  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/oauth2/access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
          expires_in: 3600,
        }),
        text: async () => JSON.stringify({ access_token: 'mock_access_token' }),
      };
    }

    const path = String(url).replace(/^https:\/\/[^\/]+/, '');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    // Fulltext contact search
    if (path.startsWith('/api/v4/contacts/fulltext?') && method === 'GET') {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get('query');
      const normQuery = amoApi.normalizePhone(query);
      const found = contactsDb.filter((c) => {
        const phoneVal = c.custom_fields_values?.[0]?.values?.[0]?.value || '';
        return amoApi.normalizePhone(phoneVal) === normQuery;
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: found } }),
        text: async () => JSON.stringify({ _embedded: { contacts: found } }),
      };
    }

    // Contact details query by ID
    if (path.startsWith('/api/v4/contacts?') && method === 'GET') {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get('query');
      if (query) {
        const normQuery = amoApi.normalizePhone(query);
        const found = contactsDb.filter((c) => {
          const phoneVal = c.custom_fields_values?.[0]?.values?.[0]?.value || '';
          return amoApi.normalizePhone(phoneVal) === normQuery;
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { contacts: found } }),
          text: async () => JSON.stringify({ _embedded: { contacts: found } }),
        };
      }

      // Query by id[]
      const found = contactsDb;
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: found } }),
        text: async () => JSON.stringify({ _embedded: { contacts: found } }),
      };
    }

    // Contact creation
    if (path === '/api/v4/contacts' && method === 'POST') {
      contactPostCount++;
      const createdList = [];
      for (const item of body) {
        // Assert custom field code is "PHONE"
        const phoneField = item.custom_fields_values?.find((f) => f.code === 'PHONE');
        assert.ok(phoneField, 'Contact creation payload must use code: "PHONE"');

        const c = { id: 100 + contactsDb.length + 1, created_at: Math.floor(Date.now() / 1000), ...item };
        contactsDb.push(c);
        createdList.push(c);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: createdList } }),
        text: async () => JSON.stringify({ _embedded: { contacts: createdList } }),
      };
    }

    // Pipelines
    if (path.startsWith('/api/v4/leads/pipelines') && method === 'GET') {
      const payload = {
        _embedded: {
          pipelines: [
            {
              id: 1,
              name: '2024 ОБРЕЗКА',
              _embedded: {
                stages: [
                  { id: 10, name: 'Назначен сотрудник' },
                ],
              },
            },
          ],
        },
      };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    }

    // Lead creation
    if (path === '/api/v4/leads' && method === 'POST') {
      const createdList = [];
      for (const item of body) {
        const lead = { id: 500 + leadsDb.length + 1, ...item };
        leadsDb.push(lead);
        createdList.push(lead);
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { leads: createdList } }),
        text: async () => JSON.stringify({ _embedded: { leads: createdList } }),
      };
    }

    // Link contact to lead Path A
    if (path.startsWith('/api/v4/leads/') && path.endsWith('/link') && method === 'POST') {
      if (simulatePathAFailure) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
          text: async () => JSON.stringify({ error: 'Not found' }),
        };
      }
      linksDb.push({ path, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }

    // Link contact to lead Path B (fallback)
    if (path.startsWith('/api/v4/contacts/') && path.endsWith('/link') && method === 'POST') {
      linksDb.push({ path, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }

    // Notes
    if (path === '/api/v4/leads/notes' && method === 'POST') {
      notesDb.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
    };
  };

  try {
    // Call 1: New phone (+7 999 123-45-67)
    console.log('  -> Call 1: createLeadWithContact (+7 999 123-45-67)...');
    const res1 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '+7 999 123-45-67',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res1.ok, true);
    assert.strictEqual(contactsDb.length, 1);
    assert.strictEqual(res1.contactId, 101);
    assert.strictEqual(contactPostCount, 1);
    console.log('  ✅ Call 1 created contact ID 101 and lead ID 501.');

    // Call 2: Repeat call with "8(999)1234567"
    console.log('  -> Call 2: createLeadWithContact ("8(999)1234567")...');
    const res2 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '8(999)1234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res2.ok, true);
    assert.strictEqual(contactsDb.length, 1, 'No duplicate contact created in DB!');
    assert.strictEqual(res2.contactId, 101, 'Linked to existing contact ID 101');
    assert.strictEqual(contactPostCount, 1, 'NO POST /api/v4/contacts executed on repeat call!');
    console.log('  ✅ Call 2 re-used contact ID 101 without creating a new contact!');

    // Call 3: Repeat call with "79991234567"
    console.log('  -> Call 3: createLeadWithContact ("79991234567")...');
    const res3 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '79991234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res3.ok, true);
    assert.strictEqual(contactsDb.length, 1);
    assert.strictEqual(res3.contactId, 101);
    assert.strictEqual(contactPostCount, 1, 'NO POST /api/v4/contacts executed on 3rd call!');
    console.log('  ✅ Call 3 re-used contact ID 101 without creating a new contact!');

    // Call 4: Link Path A failure triggers Path B fallback
    console.log('  -> Call 4: Testing Path B link fallback when Path A returns 404...');
    simulatePathAFailure = true;
    const res4 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '79991234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res4.ok, true);
    const pathBLink = linksDb.find((l) => l.path.startsWith('/api/v4/contacts/101/link'));
    assert.ok(pathBLink, 'Path B fallback link (/api/v4/contacts/101/link) must be called when Path A fails');
    console.log('  ✅ Call 4 successfully fell back to Path B link endpoint!');

    console.log('\n🎉 All contact deduplication tests passed successfully!');
  } finally {
    global.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
