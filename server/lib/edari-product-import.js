const { listEdariMaterials, countEdariMaterials } = require('./edari-lookup');
const { cacheEdariMaterial, mapEdariToShorjaProduct } = require('./edari-materials');
const { bulkUpsert, listProducts } = require('./products');
const { publishPricePackage } = require('./prices');

function mapProductForPackage(p) {
  return {
    barcode: p.barcode,
    name: p.name,
    unit: p.unit,
    price: p.price,
    costPrice: p.costPrice,
    stockQty: p.stockQty,
    category: p.category,
    hasOffer: p.hasOffer,
    offerName: p.offerName,
    originalPrice: p.originalPrice,
    priceCurrency: p.priceCurrency || 'iqd',
    priced: !!p.priced
  };
}

function importMaterialRows(rows = []) {
  let imported = 0;
  let skipped = 0;
  const products = [];

  for (const row of rows) {
    const barcode = String(row.barcode || row.num || '').trim();
    const name = String(row.name || row.name1 || '').trim();
    if (!barcode || !name) {
      skipped += 1;
      continue;
    }
    cacheEdariMaterial(row);
    const product = mapEdariToShorjaProduct(row);
    if (!product?.barcode || !product?.name) {
      skipped += 1;
      continue;
    }
    products.push(product);
    imported += 1;
  }

  if (products.length) bulkUpsert(products, { fromEdari: true });
  return { imported, skipped, products };
}

async function importEdariProductsBatch({ afterSeq = 0, limit = 500 } = {}) {
  const { rows, lastSeq, hasMore } = await listEdariMaterials({ afterSeq, limit });
  const result = importMaterialRows(rows);
  return {
    ...result,
    afterSeq: Number(afterSeq) || 0,
    lastSeq,
    hasMore,
    batchSize: rows.length
  };
}

async function importAllEdariProducts({
  batchSize = 500,
  maxBatches = 0,
  onBatch = null,
  publish = false,
  publishNote = 'استيراد كامل من الإداري — بدون أسعار بيع'
} = {}) {
  const totalInEdari = await countEdariMaterials();
  let afterSeq = 0;
  let imported = 0;
  let skipped = 0;
  let batches = 0;
  let hasMore = true;

  while (hasMore) {
    const batch = await importEdariProductsBatch({ afterSeq, limit: batchSize });
    imported += batch.imported;
    skipped += batch.skipped;
    afterSeq = batch.lastSeq;
    hasMore = batch.hasMore;
    batches += 1;
    if (typeof onBatch === 'function') {
      onBatch({ ...batch, importedTotal: imported, skippedTotal: skipped, batches });
    }
    if (maxBatches > 0 && batches >= maxBatches) break;
  }

  let publishResult = null;
  if (publish && imported > 0) {
    const { products } = listProducts({ limit: 500000, activeOnly: true });
    publishResult = publishPricePackage({
      items: products.map(mapProductForPackage),
      note: publishNote
    });
  }

  return {
    ok: true,
    totalInEdari,
    imported,
    skipped,
    batches,
    lastSeq: afterSeq,
    hasMore,
    publish: publishResult
  };
}

module.exports = {
  importMaterialRows,
  importEdariProductsBatch,
  importAllEdariProducts
};
