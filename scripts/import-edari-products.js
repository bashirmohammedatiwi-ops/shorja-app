#!/usr/bin/env node
/**
 * استيراد كل مواد Edari (File13n) إلى منتجات الشورجة بسعر نصف الجملة.
 *
 * الاستخدام:
 *   node scripts/import-edari-products.js                 # معاينة العدد
 *   node scripts/import-edari-products.js --execute       # استيراد كامل
 *   node scripts/import-edari-products.js --execute --publish
 *   node scripts/import-edari-products.js --execute --max-batches 2
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { countEdariMaterials } = require('../server/lib/edari-lookup');
const { importAllEdariProducts } = require('../server/lib/edari-product-import');
const { stats } = require('../server/lib/products');

const EXECUTE = process.argv.includes('--execute');
const PUBLISH = process.argv.includes('--publish');
const maxArg = process.argv.find((a) => a.startsWith('--max-batches='));
const MAX_BATCHES = maxArg ? Number(maxArg.split('=')[1]) : (process.argv.includes('--max-batches') ? 2 : 0);

(async () => {
  const totalInEdari = await countEdariMaterials();
  const local = stats();
  console.log(`مواد Edari (SubCount=0): ${totalInEdari}`);
  console.log(`منتجات محلية حالياً: ${local.total}`);
  console.log('وضع السعر: نصف الجملة (SellPr2 أو SellPr4 للمواد القديمة)');

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    console.log('لرفع الأسعار للفروع بعد الاستيراد: --execute --publish');
    return;
  }

  console.log('\nبدء الاستيراد...');
  let lastPct = -1;
  const result = await importAllEdariProducts({
    batchSize: 500,
    maxBatches: MAX_BATCHES,
    publish: PUBLISH,
    onBatch: ({ batchSize, importedTotal, skippedTotal, lastSeq, hasMore }) => {
      const pct = totalInEdari ? Math.min(100, Math.round((lastSeq / totalInEdari) * 100)) : 0;
      if (pct >= lastPct + 5 || !hasMore) {
        lastPct = pct;
        process.stdout.write(`\r  ${importedTotal} مستورد · ${skippedTotal} متخطى · Seq=${lastSeq} · ~${pct}%   `);
      }
    }
  });

  console.log('\n\nانتهى الاستيراد.');
  console.log(JSON.stringify({
    imported: result.imported,
    skipped: result.skipped,
    batches: result.batches,
    hasMore: result.hasMore,
    publish: result.publish
  }, null, 2));
  console.log(`منتجات محلية الآن: ${stats().total}`);
  if (PUBLISH && result.publish) {
    console.log(`حزمة أسعار: v${result.publish.version} (${result.publish.itemCount} منتج)`);
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
