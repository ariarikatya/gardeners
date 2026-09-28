/**
 * Migration script to deduplicate contacts in amoCRM by phone number.
 * Finds all contacts sharing the same normalized phone number, re-links their leads to
 * the primary (earliest) contact, and deletes duplicate contact records.
 *
 * Usage:
 *   Dry run (default): node scripts/amo-dedupe-contacts.js
 *   Apply changes:     node scripts/amo-dedupe-contacts.js --apply
 */

const prisma = require('../lib/prisma');

async function deduplicateAmoContacts() {
  const amoModule = await import('../lib/amoApi.js');
  const amoApi = amoModule.default || amoModule;

  const isApply = process.argv.includes('--apply');
  console.log(`[amo-dedupe-contacts] Starting contact deduplication (Mode: ${isApply ? 'APPLY' : 'DRY-RUN'})...`);

  try {
    // 1. Collect distinct non-empty phone numbers from Order table
    const orders = await prisma.order.findMany({
      where: {
        clientPhone: {
          not: '',
        },
      },
      select: {
        clientPhone: true,
      },
    });

    const phones = new Set();
    for (const o of orders) {
      if (o.clientPhone) {
        const norm = amoApi.normalizePhone(o.clientPhone);
        if (norm) phones.add(norm);
      }
    }

    console.log(`[amo-dedupe-contacts] Found ${phones.size} unique normalized phone numbers in database orders.`);

    let processedPhones = 0;
    let duplicateContactsFound = 0;
    let leadsRelinked = 0;
    let contactsDeleted = 0;

    for (const phone of phones) {
      processedPhones++;
      try {
        const res = await amoApi.apiRequest(`/api/v4/contacts/fulltext?query=${encodeURIComponent(phone)}&with=leads`);
        const contacts = res?._embedded?.contacts || [];

        if (contacts.length <= 1) {
          continue;
        }

        duplicateContactsFound += (contacts.length - 1);
        console.log(`\n📱 Phone ${phone}: Found ${contacts.length} contacts in amoCRM.`);

        // Sort by created_at ascending (earliest contact is primary)
        contacts.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
        const primaryContact = contacts[0];
        const duplicates = contacts.slice(1);

        console.log(`  ⭐ Primary contact ID: ${primaryContact.id} (Name: "${primaryContact.name}", created: ${new Date(primaryContact.created_at * 1000).toISOString()})`);

        for (const dup of duplicates) {
          console.log(`  ❌ Duplicate contact ID: ${dup.id} (Name: "${dup.name}", created: ${new Date(dup.created_at * 1000).toISOString()})`);

          const linkedLeads = dup?._embedded?.leads || [];
          console.log(`     Linked leads count: ${linkedLeads.length}`);

          for (const lead of linkedLeads) {
            console.log(`     -> Re-linking Lead ID ${lead.id} to Primary Contact ID ${primaryContact.id}...`);
            if (isApply) {
              await amoApi.linkContactToLead(lead.id, primaryContact.id);
            }
            leadsRelinked++;
          }

          console.log(`     -> Deleting Duplicate Contact ID ${dup.id}...`);
          if (isApply) {
            try {
              await amoApi.apiRequest('/api/v4/contacts', {
                method: 'DELETE',
                body: JSON.stringify([{ id: Number(dup.id) }]),
              });
              contactsDeleted++;
              console.log(`     ✅ Deleted Contact ID ${dup.id}`);
            } catch (delErr) {
              console.error(`     ❌ Failed to delete Contact ID ${dup.id}:`, delErr.message);
            }
          }
        }
      } catch (phoneErr) {
        console.error(`⚠️ Error processing phone ${phone}:`, phoneErr.message);
      }
    }

    console.log(`\n==========================================`);
    console.log(`[amo-dedupe-contacts] Summary (${isApply ? 'APPLY' : 'DRY-RUN'}):`);
    console.log(`  Phones checked: ${processedPhones}`);
    console.log(`  Duplicate contacts found: ${duplicateContactsFound}`);
    console.log(`  Leads re-linked: ${leadsRelinked}`);
    console.log(`  Contacts deleted: ${contactsDeleted}`);
    if (!isApply) {
      console.log(`\nDRY-RUN completed. Pass --apply to execute re-linking and contact deletions.`);
    }
  } catch (err) {
    console.error(`❌ [amo-dedupe-contacts] Fatal error:`, err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

deduplicateAmoContacts();
