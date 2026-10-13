const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting ImgBB to Yandex.Disk migration...');

  const { uploadToYandexDiskDirect, saveLocalFallback } = await import('../lib/yandexDisk.js');

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { photoBefore: { startsWith: 'http' } },
        { photoAfter: { startsWith: 'http' } },
        { photoAct: { startsWith: 'http' } },
        { photoBefore: { startsWith: '/api/images' } },
        { photoAfter: { startsWith: '/api/images' } },
        { photoAct: { startsWith: '/api/images' } },
      ],
    },
  });

  console.log(`Found ${orders.length} orders to migrate.`);

  for (const order of orders) {
    let updated = false;
    const updateData = {};

    const fields = ['photoBefore', 'photoAfter', 'photoAct'];
    for (const field of fields) {
      const val = order[field];
      if (val && typeof val === 'string') {
        // Handle migration from previous /api/images?path= stored strings
        if (val.startsWith('/api/images?path=')) {
          try {
            const parsed = decodeURIComponent(val.slice('/api/images?path='.length));
            updateData[field] = parsed;
            updated = true;
          } catch (e) {}
        } else if (val.startsWith('http')) {
          try {
            console.log(`Downloading order ${order.id} ${field}: ${val.slice(0, 50)}...`);
            const res = await fetch(val);
            if (res.ok) {
              const arrayBuf = await res.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              const fileName = `migrated_${field}_${order.id.slice(0, 8)}_${Date.now()}.jpg`;
              const folderPath = `/Садовники/Migrated_Orders`;

              const ydRes = await uploadToYandexDiskDirect({ folderPath, fileName, fileBuffer: buffer });
              let savedPath = ydRes.success ? ydRes.ydPath : null;

              if (!savedPath) {
                const localRes = saveLocalFallback({ folderPath: 'Migrated_Orders', fileName, fileBuffer: buffer });
                savedPath = localRes.relativePath || localRes.localPath;
              }

              if (savedPath) {
                updateData[field] = savedPath;
                updated = true;
              }
            } else {
              console.warn(`Failed to download ${field} for order ${order.id}: HTTP ${res.status}`);
              updateData[field] = `missing:${field}`;
              updated = true;
            }
          } catch (err) {
            console.error(`Error migrating order ${order.id} field ${field}:`, err.message);
            updateData[field] = `missing:${field}`;
            updated = true;
          }
        }
      }
    }

    if (updated) {
      await prisma.order.update({
        where: { id: order.id },
        data: updateData,
      });
      console.log(`Updated order ${order.id} in DB.`);
    }
  }

  console.log('Migration complete!');
}

main()
  .catch((e) => {
    console.error('Migration error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
