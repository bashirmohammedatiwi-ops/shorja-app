const db = require('../db');
const { bumpDataRevision } = require('./data-revision');
const { normalizeCurrency } = require('./currency');

function isManuallyPriced(p) {
  if (!p) return false;
  const price = Number(p.price || 0);
  if (!(price > 0)) return false;
  if (p.priced === false || p.priced === 0) return false;
  return true;
}

function mapProduct(row) {
  if (!row) return null;
  const priced = Number(row.priced || 0) === 1;
  const price = Number(row.price || 0);
  return {
    id: row.id,
    barcode: row.barcode,
    sku: row.sku || '',
    name: row.name,
    unit: row.unit || 'قطعة',
    price,
    priceCurrency: normalizeCurrency(row.price_currency),
    priced: priced && price > 0,
    costPrice: Number(row.cost_price || 0),
    stockQty: Number(row.stock_qty || 0),
    category: row.category || '',
    hasOffer: !!row.has_offer,
    offerName: row.offer_name || '',
    originalPrice: row.original_price != null ? Number(row.original_price) : null,
    isActive: !!row.is_active,
    updatedAt: row.updated_at
  };
}

function listProducts({
  q = '',
  category = '',
  limit = 100,
  offset = 0,
  activeOnly = true,
  pricedOnly = false,
  pricedFilter = '',
  stockFilter = 'all',
  lowThreshold = 5,
  sort = 'name'
} = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push('is_active = 1');
  if (pricedOnly || pricedFilter === 'priced') where.push('priced = 1 AND COALESCE(price, 0) > 0');
  if (pricedFilter === 'unpriced') where.push('(priced = 0 OR COALESCE(price, 0) <= 0)');
  const cat = String(category || '').trim();
  if (cat === '__none__') {
    where.push("(TRIM(COALESCE(category, '')) = '')");
  } else if (cat) {
    where.push('category = ?');
    params.push(cat);
  }
  if (q) {
    where.push('(barcode LIKE ? OR name LIKE ? OR sku LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const threshold = Math.max(0, Number(lowThreshold) || 5);
  if (stockFilter === 'in') {
    where.push('stock_qty > ?');
    params.push(threshold);
  } else if (stockFilter === 'low') {
    where.push('stock_qty > 0 AND stock_qty <= ?');
    params.push(threshold);
  } else if (stockFilter === 'out') {
    where.push('stock_qty <= 0');
  }
  const orderBy = {
    stock_asc: 'stock_qty ASC, name COLLATE NOCASE',
    stock_desc: 'stock_qty DESC, name COLLATE NOCASE',
    price_asc: 'price ASC, name COLLATE NOCASE',
    price_desc: 'price DESC, name COLLATE NOCASE',
    name: 'name COLLATE NOCASE'
  }[sort] || 'name COLLATE NOCASE';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM products
    ${whereSql}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `;
  const queryParams = [...params, limit, offset];
  const rows = db.prepare(sql).all(...queryParams);
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM products ${whereSql}
  `).get(...params).c;
  return { products: rows.map(mapProduct), total, limit, offset };
}

function stockSummary(threshold = 5) {
  const t = Math.max(0, Number(threshold) || 5);
  const total = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c;
  const out = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_qty <= 0').get().c;
  const low = db.prepare(`
    SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_qty > 0 AND stock_qty <= ?
  `).get(t).c;
  const inStock = db.prepare(`
    SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_qty > ?
  `).get(t).c;
  return { total, inStock, low, out, threshold: t };
}

function getByBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  let row = db.prepare('SELECT * FROM products WHERE barcode = ? AND is_active = 1').get(code);
  if (!row) row = db.prepare('SELECT * FROM products WHERE sku = ? AND is_active = 1').get(code);
  return mapProduct(row);
}

function getProduct(id) {
  return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function deactivateProduct(id) {
  const product = getProduct(id);
  if (!product) throw new Error('المنتج غير موجود');
  db.prepare(`
    UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?
  `).run(id);
  bumpDataRevision();
  return product;
}

function wipeCatalogProducts() {
  const before = Number(db.prepare('SELECT COUNT(*) AS c FROM products').get().c || 0);
  const tx = db.transaction(() => {
    try { db.exec('DELETE FROM price_package_items'); } catch { /* optional table */ }
    try { db.exec('DELETE FROM price_packages'); } catch { /* optional table */ }
    try { db.exec('DELETE FROM edari_materials'); } catch { /* optional table */ }
    db.exec('DELETE FROM products');
  });
  tx();
  bumpDataRevision();
  return before;
}

function deactivateProductsNotInBarcodes(barcodes = []) {
  const codes = [...new Set((barcodes || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (!codes.length) return wipeCatalogProducts();

  const tx = db.transaction(() => {
    db.prepare(`CREATE TEMP TABLE IF NOT EXISTS _keep_barcodes (barcode TEXT PRIMARY KEY)`).run();
    db.prepare(`DELETE FROM _keep_barcodes`).run();
    const ins = db.prepare(`INSERT OR IGNORE INTO _keep_barcodes (barcode) VALUES (?)`);
    for (const code of codes) ins.run(code);
    const r = db.prepare(`
      UPDATE products SET is_active = 0, updated_at = datetime('now')
      WHERE is_active = 1
        AND barcode NOT IN (SELECT barcode FROM _keep_barcodes)
        AND (sku IS NULL OR sku = '' OR sku NOT IN (SELECT barcode FROM _keep_barcodes))
    `).run();
    db.prepare(`DROP TABLE IF EXISTS _keep_barcodes`).run();
    return Number(r.changes || 0);
  });
  const changes = tx();
  bumpDataRevision();
  return changes;
}

function upsertProduct(data) {
  const barcode = String(data.barcode || '').trim();
  if (!barcode) throw new Error('الباركود مطلوب');
  const price = Number(data.price || 0);
  const priceCurrency = normalizeCurrency(data.priceCurrency);
  const priced = data.priced === false || data.priced === 0 ? 0 : (price > 0 ? 1 : 0);
  const existing = db.prepare('SELECT id FROM products WHERE barcode = ?').get(barcode);
  if (existing) {
    db.prepare(`
      UPDATE products SET
        name = ?, sku = ?, unit = ?, price = ?, price_currency = ?, priced = ?,
        cost_price = ?, stock_qty = ?,
        category = ?, has_offer = ?, offer_name = ?, original_price = ?,
        is_active = 1, updated_at = datetime('now')
      WHERE barcode = ?
    `).run(
      data.name, data.sku || '', data.unit || 'قطعة', price, priceCurrency, priced,
      data.costPrice || 0, data.stockQty || 0, data.category || '',
      data.hasOffer ? 1 : 0, data.offerName || null, data.originalPrice || null,
      barcode
    );
    return getByBarcode(barcode);
  }
  const r = db.prepare(`
    INSERT INTO products (barcode, sku, name, unit, price, price_currency, priced, cost_price, stock_qty, category, has_offer, offer_name, original_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    barcode, data.sku || '', data.name, data.unit || 'قطعة', price, priceCurrency, priced,
    data.costPrice || 0, data.stockQty || 0, data.category || '',
    data.hasOffer ? 1 : 0, data.offerName || null, data.originalPrice || null
  );
  return getProduct(r.lastInsertRowid);
}

function upsertCatalogProduct(data) {
  const barcode = String(data.barcode || '').trim();
  if (!barcode) throw new Error('الباركود مطلوب');
  const existing = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
  if (existing) {
    db.prepare(`
      UPDATE products SET
        name = ?, sku = ?, unit = ?, stock_qty = ?,
        category = COALESCE(NULLIF(?, ''), category),
        is_active = 1, updated_at = datetime('now')
      WHERE barcode = ?
    `).run(
      data.name || existing.name,
      data.sku || existing.sku || '',
      data.unit || existing.unit || 'قطعة',
      data.stockQty != null ? Number(data.stockQty) : existing.stock_qty,
      data.category || '',
      barcode
    );
    return getByBarcode(barcode);
  }
  const r = db.prepare(`
    INSERT INTO products (barcode, sku, name, unit, price, price_currency, priced, cost_price, stock_qty, category)
    VALUES (?, ?, ?, ?, 0, 'iqd', 0, 0, ?, ?)
  `).run(
    barcode,
    data.sku || '',
    data.name,
    data.unit || 'قطعة',
    Number(data.stockQty || 0),
    data.category || ''
  );
  return getProduct(r.lastInsertRowid);
}

function patchProduct(barcode, patch = {}) {
  const existing = getByBarcode(barcode);
  if (!existing) throw new Error(`المنتج غير موجود: ${barcode}`);
  const nextPrice = patch.price != null && patch.price !== ''
    ? Number(patch.price)
    : existing.price;
  return upsertProduct({
    barcode: existing.barcode,
    name: patch.name != null ? (String(patch.name).trim() || existing.name) : existing.name,
    sku: existing.sku,
    unit: patch.unit != null ? patch.unit : existing.unit,
    price: Number.isFinite(nextPrice) ? nextPrice : existing.price,
    priceCurrency: patch.priceCurrency || existing.priceCurrency,
    costPrice: patch.costPrice != null && patch.costPrice !== ''
      ? Number(patch.costPrice)
      : existing.costPrice,
    stockQty: existing.stockQty,
    category: patch.category != null ? String(patch.category).trim() : existing.category,
    hasOffer: existing.hasOffer,
    offerName: existing.offerName,
    originalPrice: existing.originalPrice
  });
}

function bulkPatchProducts(items = []) {
  if (!items.length) return [];
  const tx = db.transaction((rows) => rows.map((row) => {
    const code = String(row.barcode || '').trim();
    if (!code) throw new Error('الباركود مطلوب');
    return patchProduct(code, row);
  }));
  const updated = tx(items);
  bumpDataRevision();
  return updated;
}

function assignProductsCategory(barcodes = [], category = '') {
  const codes = [...new Set((barcodes || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (!codes.length) throw new Error('حدد منتجاً واحداً على الأقل');
  return bulkPatchProducts(codes.map((barcode) => ({ barcode, category: String(category || '').trim() })));
}

function categoryStats() {
  const rows = db.prepare(`
    SELECT
      TRIM(COALESCE(category, '')) AS name,
      COUNT(*) AS count,
      SUM(CASE WHEN priced = 1 AND COALESCE(price, 0) > 0 THEN 1 ELSE 0 END) AS pricedCount
    FROM products
    WHERE is_active = 1
    GROUP BY TRIM(COALESCE(category, ''))
    ORDER BY CASE WHEN TRIM(COALESCE(category, '')) = '' THEN 0 ELSE 1 END, name COLLATE NOCASE
  `).all();
  return rows.map((r) => ({
    name: String(r.name || ''),
    count: Number(r.count || 0),
    pricedCount: Number(r.pricedCount || 0)
  }));
}

function bulkUpsert(items = [], { fromEdari = false } = {}) {
  const tx = db.transaction((rows) => {
    let count = 0;
    for (const item of rows) {
      if (fromEdari) upsertCatalogProduct(item);
      else upsertProduct(item);
      count += 1;
    }
    return count;
  });
  return tx(items);
}

function adjustStock(barcode, delta) {
  db.prepare(`
    UPDATE products SET
      stock_qty = CASE WHEN stock_qty + ? < 0 THEN 0 ELSE stock_qty + ? END,
      updated_at = datetime('now')
    WHERE barcode = ?
  `).run(delta, delta, barcode);
}

function categories() {
  return db.prepare(`
    SELECT DISTINCT category FROM products WHERE category != '' AND is_active = 1 ORDER BY category
  `).all().map((r) => r.category);
}

function stats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c;
  const withStock = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_qty > 0').get().c;
  const offers = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND has_offer = 1').get().c;
  return { total, withStock, offers };
}

function listLowStock(threshold = 5, limit = 100, { pricedOnly = false } = {}) {
  const pricedSql = pricedOnly ? ' AND priced = 1 AND COALESCE(price, 0) > 0' : '';
  const rows = db.prepare(`
    SELECT * FROM products
    WHERE is_active = 1 AND stock_qty <= ?${pricedSql}
    ORDER BY stock_qty ASC, name LIMIT ?
  `).all(threshold, limit);
  return rows.map(mapProduct);
}

module.exports = {
  mapProduct,
  listProducts,
  getByBarcode,
  getProduct,
  deactivateProduct,
  wipeCatalogProducts,
  deactivateProductsNotInBarcodes,
  upsertProduct,
  upsertCatalogProduct,
  bulkUpsert,
  adjustStock,
  categories,
  stats,
  listLowStock,
  stockSummary,
  patchProduct,
  bulkPatchProducts,
  assignProductsCategory,
  categoryStats,
  isManuallyPriced
};
