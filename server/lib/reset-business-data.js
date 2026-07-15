const db = require('../db');

function tableCount(table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

function snapshotCounts() {
  return {
    accounts: tableCount('accounts'),
    invoices: tableCount('invoices'),
    invoice_lines: tableCount('invoice_lines'),
    payments: tableCount('payments'),
    journal_entries: tableCount('journal_entries'),
    edari_sync_queue: tableCount('edari_sync_queue'),
    products: tableCount('products'),
    price_packages: tableCount('price_packages'),
    edari_materials: tableCount('edari_materials')
  };
}

function resetBusinessData({ includeProducts = true } = {}) {
  const before = snapshotCounts();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM edari_sync_queue');
    db.exec('DELETE FROM invoice_lines');
    db.exec('DELETE FROM journal_entries');
    db.exec('DELETE FROM payments');
    db.exec('DELETE FROM invoices');
    db.exec('DELETE FROM accounts');
    if (includeProducts) {
      db.exec('DELETE FROM price_package_items');
      db.exec('DELETE FROM price_packages');
      db.exec('DELETE FROM products');
      db.exec('DELETE FROM edari_materials');
    }
    db.prepare(
      `INSERT INTO sync_meta (key, value) VALUES ('skip_demo_accounts', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run();
    if (includeProducts) {
      db.prepare(
        `INSERT INTO sync_meta (key, value) VALUES ('skip_demo_products', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run();
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return { before, after: snapshotCounts() };
}

module.exports = {
  resetBusinessData,
  snapshotCounts
};
