const db = require('../db');
const { bumpDataRevision } = require('./data-revision');
const { normalizeCurrency } = require('./currency');

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
  stockFilter = 'all',
  lowThreshold = 5,
  sort = 'name'
} = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push('is_active = 1');
  if (pricedOnly) where.push('priced = 1 AND COALESCE(price, 0) > 0');
  if (category) {
    where.push('category = ?');
    params.push(category);
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
  upsertProduct,
  upsertCatalogProduct,
  bulkUpsert,
  adjustStock,
  categories,
  stats,
  listLowStock,
  stockSummary
};
