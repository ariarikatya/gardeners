const assert = require('assert');

// Set dummy envs so getAmoCredentialsFromDb does not throw
process.env.AMO_CLIENT_ID = 'test_id';
process.env.AMO_CLIENT_SECRET = 'test_secret';
process.env.AMO_REFRESH_TOKEN = 'test_refresh';

const amoApi = require('../lib/amoApi').default;

async function runTests() {
  console.log('🧪 Starting tests for amoCRM contact deduplication and API v4 logic...\n');

  // Test 1: Phone Normalization
  console.log('Test 1: Phone normalization across various input formats');
  assert.strictEqual(amoApi.normalizePhone('+7 999 123-45-67'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('8(999)1234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('79991234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('9991234567'), '79991234567');
  assert.strictEqual(amoApi.normalizePhone('+7 (908) 553-53-11'), '79085535311');
  console.log('✅ Test 1 passed!\n');

  // Test 2: Mock API v4 behavior
  console.log('Test 2: Mock API v4 contact creation and lead linkage');

  const contactsDb = [];
  const leadsDb = [];
  const notesDb = [];
  const linksDb = [];

  // Mock global fetch to return valid token response on token exchange
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

    // Contact search
    if (path.startsWith('/api/v4/contacts?') && method === 'GET') {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get('query');
      const found = contactsDb.filter((c) => {
        const phoneVal = c.custom_fields_values?.[0]?.values?.[0]?.value || '';
        return phoneVal.includes(query) || (c.name && c.name.includes(query));
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: found } }),
        text: async () => JSON.stringify({ _embedded: { contacts: found } }),
      };
    }

    // Contact creation
    if (path === '/api/v4/contacts' && method === 'POST') {
      const createdList = [];
      for (const item of body) {
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

    // Link contact to lead
    if (path.includes('/link') && method === 'POST') {
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
    // Call 1: New phone (+7 999 111-22-33)
    console.log('  -> Calling createLeadWithContact for first time (+7 999 111-22-33)...');
    const res1 = await amoApi.createLeadWithContact({
      name: 'Иван Иванов',
      phone: '+7 999 111-22-33',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Ленина 10',
    });

    assert.strictEqual(res1.ok, true);
    assert.strictEqual(contactsDb.length, 1);
    assert.strictEqual(contactsDb[0].id, res1.contactId);
    assert.strictEqual(leadsDb.length, 1);
    assert.strictEqual(leadsDb[0].id, res1.leadId);
    assert.strictEqual(leadsDb[0]._embedded.contacts[0].id, res1.contactId);
    console.log('  ✅ First call created 1 contact and 1 lead linked together.');

    // Call 2: Second lead with SAME phone in different format (8(999)1112233)
    console.log('  -> Calling createLeadWithContact with SAME phone in different format (8(999)1112233)...');
    const res2 = await amoApi.createLeadWithContact({
      name: 'Иван Иванов',
      phone: '8(999)1112233',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Ленина 10',
    });

    assert.strictEqual(res2.ok, true);
    assert.strictEqual(contactsDb.length, 1, 'Contacts count must remain 1 (no duplicate contact created!)');
    assert.strictEqual(res2.contactId, res1.contactId, 'Must be linked to the same existing contact ID');
    assert.strictEqual(leadsDb.length, 2, 'Second lead must be created');
    assert.strictEqual(leadsDb[1].id, res2.leadId);
    assert.strictEqual(leadsDb[1]._embedded.contacts[0].id, res1.contactId, 'Second lead linked to existing contact ID');
    console.log('  ✅ Second call linked new lead to EXISTING contact without creating a duplicate contact!');

    console.log('\n🎉 All contact deduplication tests passed successfully!');
  } finally {
    global.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
