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
  console.log('Test 2: Mock API v4 phone filter search, contact creation, PATCH phone field, and lead linkage');

  process.env.AMO_WORK_PHONE_FIELD_ID = '142';

  // Seed realistic production state: contact ID 101 with phone ONLY in _embedded.phones (no custom_fields_values)
  const contactsDb = [
    {
      id: 101,
      name: 'Петр Петров',
      _embedded: {
        phones: [{ value: '+79991234567' }],
      },
    },
  ];
  const leadsDb = [];
  const notesDb = [];
  const linksDb = [];
  const patchCallsDb = [];
  let contactPostCount = 0;
  let simulatePathAFailure = false;
  let simulateBothLinkPathsFailure = false;

  // Helper function to match contact phone against normalized query
  function matchContactPhone(c, normQuery) {
    if (!normQuery) return false;
    // Check _embedded.phones
    if (c._embedded?.phones) {
      for (const p of c._embedded.phones) {
        if (p?.value && amoApi.normalizePhone(p.value) === normQuery) return true;
      }
    }
    // Check custom_fields_values
    if (c.custom_fields_values) {
      for (const f of c.custom_fields_values) {
        for (const v of f.values || []) {
          if (v?.value && amoApi.normalizePhone(v.value) === normQuery) return true;
        }
      }
    }
    return false;
  }

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

    // Contact custom fields discovery
    if ((path.startsWith('/api/v4/contacts/custom_fields') || path.startsWith('/api/v4/contact/custom_fields')) && method === 'GET') {
      const payload = {
        _embedded: {
          custom_fields: [
            { id: 142, name: 'Раб. тел.', type: 'multitext', code: 'PHONE' },
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

    // Fulltext contact search
    if (path.startsWith('/api/v4/contacts/fulltext?') && method === 'GET') {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get('query');
      const normQuery = amoApi.normalizePhone(query);
      const found = contactsDb.filter((c) => matchContactPhone(c, normQuery));
      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: found } }),
        text: async () => JSON.stringify({ _embedded: { contacts: found } }),
      };
    }

    // Contact query by phone filter query[phone] or query or id[]
    if (path.startsWith('/api/v4/contacts?') && method === 'GET') {
      const parsedUrl = new URL(url);
      const phoneQuery = parsedUrl.searchParams.get('query[phone]') || parsedUrl.searchParams.get('query');
      if (phoneQuery) {
        const normQuery = amoApi.normalizePhone(phoneQuery);
        const found = contactsDb.filter((c) => matchContactPhone(c, normQuery));
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { contacts: found } }),
          text: async () => JSON.stringify({ _embedded: { contacts: found } }),
        };
      }

      // Query by id[]
      const idParams = parsedUrl.searchParams.getAll('id[]');
      if (idParams.length > 0) {
        const found = contactsDb.filter((c) => idParams.includes(String(c.id)));
        return {
          ok: true,
          status: 200,
          json: async () => ({ _embedded: { contacts: found } }),
          text: async () => JSON.stringify({ _embedded: { contacts: found } }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { contacts: contactsDb } }),
        text: async () => JSON.stringify({ _embedded: { contacts: contactsDb } }),
      };
    }

    // Contact creation
    if (path === '/api/v4/contacts' && method === 'POST') {
      contactPostCount++;
      const createdList = [];
      for (const item of body) {
        // Assert custom_fields_values does NOT contain code 'PHONE'
        const phoneField = item.custom_fields_values?.find((f) => f.code === 'PHONE');
        assert.strictEqual(phoneField, undefined, 'Contact creation payload MUST NOT contain custom_fields_values with code: "PHONE"');

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

    // PATCH contact endpoint
    if (path.startsWith('/api/v4/contacts/') && method === 'PATCH') {
      const idStr = path.replace('/api/v4/contacts/', '');
      patchCallsDb.push({ path, body, id: idStr });
      const contact = contactsDb.find((c) => String(c.id) === idStr);
      if (contact && body) {
        const patchItem = Array.isArray(body) ? body[0] : body;
        if (patchItem.custom_fields_values) {
          contact.custom_fields_values = patchItem.custom_fields_values;
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
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
      if (simulatePathAFailure || simulateBothLinkPathsFailure) {
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
      if (simulateBothLinkPathsFailure) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Bad request' }),
          text: async () => JSON.stringify({ error: 'Bad request' }),
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
    // Call 1: Realistic prod case where contact 101 already exists in contactsDb with phone ONLY in _embedded.phones
    console.log('  -> Call 1: createLeadWithContact ("8(999)1234567") against existing contact 101 with phone ONLY in _embedded.phones...');
    const res1 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '8(999)1234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.contactId, 101, 'Must reuse pre-existing contact ID 101');
    assert.strictEqual(contactPostCount, 0, 'contactPostCount must remain 0 (NO POST /api/v4/contacts)!');
    console.log('  ✅ Call 1 matched pre-existing contact 101 via _embedded.phones without creating a new contact!');

    // Call 2: Repeat call with "79991234567"
    console.log('  -> Call 2: createLeadWithContact ("79991234567")...');
    const res2 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '79991234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res2.ok, true);
    assert.strictEqual(res2.contactId, 101, 'Linked to existing contact ID 101');
    assert.strictEqual(contactPostCount, 0, 'NO POST /api/v4/contacts executed on repeat call!');
    console.log('  ✅ Call 2 re-used contact ID 101 without creating a new contact!');

    // Call 3: Link Path A failure triggers Path B fallback
    console.log('  -> Call 3: Testing Path B link fallback when Path A returns 404...');
    simulatePathAFailure = true;
    const res3 = await amoApi.createLeadWithContact({
      name: 'Петр Петров',
      phone: '79991234567',
      serviceName: 'Обрезка деревьев',
      address: 'ул. Садовая 15',
    });

    assert.strictEqual(res3.ok, true);
    const pathBLink = linksDb.find((l) => l.path.startsWith('/api/v4/contacts/101/link'));
    assert.ok(pathBLink, 'Path B fallback link (/api/v4/contacts/101/link) must be called when Path A fails');
    console.log('  ✅ Call 3 successfully fell back to Path B link endpoint!');

    // Call 4: Brand new contact creation case (phone "+7 908 553-53-11")
    console.log('  -> Call 4: Testing creation of a new contact for phone +7 908 553-53-11...');
    simulatePathAFailure = false;
    const res4 = await amoApi.createLeadWithContact({
      name: 'Иван Иванов',
      phone: '+7 908 553-53-11',
      serviceName: 'Обрезка деревьев',
    });
    assert.strictEqual(res4.ok, true);
    assert.strictEqual(contactsDb.length, 2, 'New contact created in DB for new phone');
    assert.strictEqual(res4.contactId, 102, 'New contact ID is 102');
    assert.strictEqual(contactPostCount, 1, 'POST /api/v4/contacts executed exactly once');

    // Verify PATCH was executed with field_id 142
    const patchCall = patchCallsDb.find((p) => p.id === '102');
    assert.ok(patchCall, 'PATCH /api/v4/contacts/102 must be called after creation');
    const fieldVal = patchCall.body?.[0]?.custom_fields_values?.[0];
    assert.strictEqual(fieldVal?.field_id, 142, 'PATCH payload must use field_id 142');
    assert.strictEqual(fieldVal?.values?.[0]?.value, '+79085535311', 'PATCH payload value must be formatted phone +79085535311');
    console.log('  ✅ Call 4 created contact 102 (without code: "PHONE" in POST) and executed PATCH with field_id 142!');

    // Call 5: Case when link fails on both Path A and Path B -> createLeadWithContact throws error
    console.log('  -> Call 5: Testing failure when both link Path A and Path B fail...');
    simulateBothLinkPathsFailure = true;
    let didThrow = false;
    try {
      await amoApi.createLeadWithContact({
        name: 'Сидор Сидоров',
        phone: '79991234567',
        serviceName: 'Обрезка деревьев',
      });
    } catch (linkErr) {
      didThrow = true;
      assert.ok(linkErr.message.includes('Failed to link contact'), 'Error message should indicate link failure');
    }
    assert.strictEqual(didThrow, true, 'createLeadWithContact must throw when both link paths fail');
    console.log('  ✅ Call 5 threw error as expected when both link paths failed!');

    console.log('\n🎉 All contact deduplication tests passed successfully!');
  } finally {
    global.fetch = originalFetch;
  }

  // Test 3: Widget submission anti-flood deduplication
  console.log('\nTest 3: Widget submission anti-flood deduplication logic');

  const mockWebLeadsDb = [];

  async function simulateWidgetSubmitAntiFlood(body, now = Date.now()) {
    const { phone, serviceName, serviceId, preferredDate, preferredGardenerId, gardenerId } = body;
    const phoneClean = String(phone || '').trim();
    const normPhone = amoApi.normalizePhone(phoneClean);
    const prefDate = preferredDate ? new Date(preferredDate) : null;
    const finalGardenerId = preferredGardenerId || gardenerId || null;

    const LEAD_DEDUPE_WINDOW_MINUTES = Number(process.env.LEAD_DEDUPE_WINDOW_MIN ?? 2);
    const windowStart = new Date(now - LEAD_DEDUPE_WINDOW_MINUTES * 60 * 1000);

    const recentLeads = mockWebLeadsDb.filter((l) => new Date(l.createdAt) >= windowStart);

    const existingLead = recentLeads.find((l) => {
      if (!normPhone || amoApi.normalizePhone(l.phone) !== normPhone) return false;

      const lDate = l.preferredDate ? new Date(l.preferredDate).getTime() : null;
      const reqDate = prefDate ? prefDate.getTime() : null;
      if (lDate !== reqDate) return false;

      const lGardener = l.preferredGardenerId ? String(l.preferredGardenerId) : null;
      const reqGardener = finalGardenerId ? String(finalGardenerId) : null;
      if (lGardener !== reqGardener) return false;

      const sameName = serviceName && l.serviceName && String(serviceName).trim() === String(l.serviceName).trim();
      const sameId = serviceId && l.serviceId && String(serviceId).trim() === String(l.serviceId).trim();
      const bothNoService = !serviceName && !serviceId && !l.serviceName && !l.serviceId;

      return sameName || sameId || bothNoService;
    });

    if (existingLead) {
      return { success: true, id: existingLead.id, duplicate: true };
    }

    const newLead = {
      id: `lead_${mockWebLeadsDb.length + 1}`,
      phone: phoneClean,
      serviceName: serviceName || null,
      serviceId: serviceId || null,
      preferredDate: prefDate,
      preferredGardenerId: finalGardenerId,
      createdAt: new Date(now),
    };
    mockWebLeadsDb.push(newLead);
    return { success: true, id: newLead.id };
  }

  const baseTime = Date.now();

  // 1. First submission
  const w1 = await simulateWidgetSubmitAntiFlood({
    phone: '+7 999 123-45-67',
    serviceName: 'Обрезка деревьев',
    preferredDate: '2026-10-01',
  }, baseTime);
  assert.strictEqual(w1.success, true);
  assert.strictEqual(w1.duplicate, undefined);
  assert.strictEqual(w1.id, 'lead_1');

  // 2. Immediate duplicate submission within window (5 seconds later) -> duplicate: true
  const w2 = await simulateWidgetSubmitAntiFlood({
    phone: '+7 999 123-45-67',
    serviceName: 'Обрезка деревьев',
    preferredDate: '2026-10-01',
  }, baseTime + 5000);
  assert.strictEqual(w2.success, true);
  assert.strictEqual(w2.duplicate, true);
  assert.strictEqual(w2.id, 'lead_1');
  console.log('  ✅ Two consecutive submissions within window correctly flagged as duplicate.');

  // 3. Same submission outside 2-minute window (3 minutes later) -> new lead_2 created
  const w3 = await simulateWidgetSubmitAntiFlood({
    phone: '+7 999 123-45-67',
    serviceName: 'Обрезка деревьев',
    preferredDate: '2026-10-01',
  }, baseTime + 3 * 60 * 1000);
  assert.strictEqual(w3.success, true);
  assert.strictEqual(w3.duplicate, undefined);
  assert.strictEqual(w3.id, 'lead_2');
  console.log('  ✅ Same submission outside anti-flood window allowed as new lead_2.');

  // 4. Submission with different service within window -> new lead_3 created
  const w4 = await simulateWidgetSubmitAntiFlood({
    phone: '+7 999 123-45-67',
    serviceName: 'Консервация автополива',
    preferredDate: '2026-10-01',
  }, baseTime + 3 * 60 * 1000 + 10000);
  assert.strictEqual(w4.success, true);
  assert.strictEqual(w4.duplicate, undefined);
  assert.strictEqual(w4.id, 'lead_3');
  console.log('  ✅ Different service within window allowed as new lead_3.');

  // 5. Submission with different date within window -> new lead_4 created
  const w5 = await simulateWidgetSubmitAntiFlood({
    phone: '+7 999 123-45-67',
    serviceName: 'Обрезка деревьев',
    preferredDate: '2026-10-02',
  }, baseTime + 3 * 60 * 1000 + 20000);
  assert.strictEqual(w5.success, true);
  assert.strictEqual(w5.duplicate, undefined);
  assert.strictEqual(w5.id, 'lead_4');
  console.log('  ✅ Different date within window allowed as new lead_4.');

  // 6. Submission with different phone format ("8(999)1234567") for same date & service as w5 within window -> blocked as duplicate of lead_4
  const w6 = await simulateWidgetSubmitAntiFlood({
    phone: '8(999)1234567',
    serviceName: 'Обрезка деревьев',
    preferredDate: '2026-10-02',
  }, baseTime + 3 * 60 * 1000 + 25000);
  assert.strictEqual(w6.success, true);
  assert.strictEqual(w6.duplicate, true);
  assert.strictEqual(w6.id, 'lead_4');
  console.log('  ✅ Different phone format within window matched normalized phone and blocked as duplicate.');

  console.log('🎉 Widget anti-flood tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
