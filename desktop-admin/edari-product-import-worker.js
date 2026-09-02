const fs = require('fs');
const path = require('path');
const { registerEdariModulePaths } = require('./edari-module-paths');

registerEdariModulePaths(require('electron').app);

function getEdariLibPath(name) {
  const { app } = require('electron');
  const packaged = path.join(process.resourcesPath, 'edari', name);
  if (app?.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'server', 'lib', name);
}

function clearEdariLibCache(names = []) {
  for (const name of names) {
    const p = getEdariLibPath(name);
    try {
      delete require.cache[require.resolve(p)];
    } catch {
      /* not loaded */
    }
  }
}

function loadImportLib() {
  clearEdariLibCache([
    'edari-connection.js',
    'edari-lookup.js'
  ]);
  const lookupPath = getEdariLibPath('edari-lookup.js');
  const { countEdariMaterials, listEdariMaterials, resetOdbcBridgeCache } = require(lookupPath);
  resetOdbcBridgeCache?.();
  return { countEdariMaterials, listEdariMaterials };
}

function mapEdariToShorjaProduct(material) {
  if (!material) return null;
  const wholesale = Number(material.wholesalePrice ?? material.sellPr1 ?? 0);
  const halfWholesale = Number(
    material.halfWholesalePrice ?? material.price ?? material.sellPr2 ?? material.sellPr4 ?? wholesale
  );
  return {
    barcode: String(material.barcode || material.num || '').trim(),
    sku: String(material.num || '').trim(),
    name: String(material.name || material.name1 || '').trim(),
    unit: String(material.unit || 'قطعة').trim() || 'قطعة',
    costPrice: wholesale,
    price: halfWholesale,
    stockQty: Number(material.stockQty ?? material.qty ?? 0),
    category: '',
    edariSeq: String(material.seq || '')
  };
}

async function getEdariProductImportStatus() {
  const { countEdariMaterials } = loadImportLib();
  const totalInEdari = await countEdariMaterials();
  return { ok: true, totalInEdari, priceMode: 'half_wholesale' };
}

async function fetchEdariProductImportBatch({ afterSeq = 0, limit = 500 } = {}) {
  const { listEdariMaterials } = loadImportLib();
  const { rows, lastSeq, hasMore } = await listEdariMaterials({ afterSeq, limit });
  const products = [];
  let skipped = 0;

  for (const row of rows) {
    const product = mapEdariToShorjaProduct(row);
    if (!product?.barcode || !product?.name) {
      skipped += 1;
      continue;
    }
    products.push(product);
  }

  return {
    ok: true,
    products,
    imported: products.length,
    skipped,
    afterSeq: Number(afterSeq) || 0,
    lastSeq,
    hasMore,
    batchSize: rows.length
  };
}

module.exports = {
  getEdariProductImportStatus,
  fetchEdariProductImportBatch
};
