const db = require('../db');
const { bulkUpsert } = require('./products');

function getLatestVersion(branchId = null) {
  const row = branchId
    ? db.prepare('SELECT MAX(version) AS v FROM price_packages WHERE branch_id IS NULL OR branch_id = ?').get(branchId)
    : db.prepare('SELECT MAX(version) AS v FROM price_packages').get();
  return Number(row?.v || 0);
}

function publishPricePackage({ items = [], branchId = null, note = '' } = {}) {
  if (!items.length) throw new Error('لا توجد منتجات في الحزمة');
  const version = getLatestVersion(branchId) + 1;
  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO price_packages (version, branch_id, item_count, note) VALUES (?, ?, ?, ?)
      RETURNING id
    `).get(version, branchId, items.length, note || '');
    const packageId = r.id;
    const insert = db.prepare(`
      INSERT INTO price_package_items
        (package_id, barcode, name, unit, price, cost_price, stock_qty, category, has_offer, offer_name, original_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insert.run(
        packageId, item.barcode, item.name, item.unit || 'قطعة',
        item.price || 0, item.costPrice || 0, item.stockQty || 0,
        item.category || '', item.hasOffer ? 1 : 0,
        item.offerName || null, item.originalPrice || null
      );
    }
    bulkUpsert(items);
    if (branchId) {
      db.prepare('UPDATE branches SET price_version = ? WHERE id = ?').run(version, branchId);
    } else {
      db.prepare('UPDATE branches SET price_version = ?').run(version);
    }
    db.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)')
      .run('last_price_version', String(version));
    return { packageId, version, itemCount: items.length };
  });
  return tx();
}

function getPricePackage(version, branchId = null) {
  const pkg = db.prepare(`
    SELECT * FROM price_packages WHERE version = ?
    AND (branch_id IS NULL OR branch_id = ?)
    ORDER BY id DESC LIMIT 1
  `).get(version, branchId);
  if (!pkg) return null;
  const items = db.prepare('SELECT * FROM price_package_items WHERE package_id = ?').all(pkg.id);
  return {
    version: pkg.version,
    branchId: pkg.branch_id,
    itemCount: pkg.item_count,
    note: pkg.note,
    createdAt: pkg.created_at,
    items: items.map((i) => ({
      barcode: i.barcode,
      name: i.name,
      unit: i.unit,
      price: Number(i.price),
      costPrice: Number(i.cost_price),
      stockQty: Number(i.stock_qty),
      category: i.category,
      hasOffer: !!i.has_offer,
      offerName: i.offer_name,
      originalPrice: i.original_price != null ? Number(i.original_price) : null
    }))
  };
}

function checkPriceUpdate(branchId, currentVersion) {
  const latest = getLatestVersion(branchId);
  if (latest <= Number(currentVersion || 0)) {
    return { hasUpdate: false, version: latest };
  }
  const pkg = getPricePackage(latest, branchId);
  return { hasUpdate: true, version: latest, package: pkg };
}

function listPackages(limit = 20) {
  return db.prepare(`
    SELECT p.*, b.name AS branch_name FROM price_packages p
    LEFT JOIN branches b ON b.id = p.branch_id
    ORDER BY p.version DESC LIMIT ?
  `).all(limit).map((p) => ({
    id: p.id,
    version: p.version,
    branchId: p.branch_id,
    branchName: p.branch_name || 'كل الفروع',
    itemCount: p.item_count,
    note: p.note,
    createdAt: p.created_at
  }));
}

function applyPricePackage(branchId, version) {
  const pkg = getPricePackage(version, branchId);
  if (!pkg) throw new Error('حزمة الأسعار غير موجودة');
  const items = pkg.items.map((i) => ({
    barcode: i.barcode,
    name: i.name,
    unit: i.unit,
    price: i.price,
    costPrice: i.costPrice,
    stockQty: i.stockQty,
    category: i.category,
    hasOffer: i.hasOffer,
    offerName: i.offerName,
    originalPrice: i.originalPrice
  }));
  bulkUpsert(items);
  if (branchId) {
    db.prepare('UPDATE branches SET price_version = ? WHERE id = ?').run(version, branchId);
  }
  return { version, itemCount: items.length };
}

module.exports = {
  getLatestVersion,
  publishPricePackage,
  getPricePackage,
  checkPriceUpdate,
  applyPricePackage,
  listPackages
};
