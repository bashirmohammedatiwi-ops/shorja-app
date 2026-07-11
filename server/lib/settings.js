const db = require('../db');

const { STORE_NAME } = require('./config');

const DEFAULTS = {
  lowStockThreshold: 5,
  blockZeroStock: false,
  blockOverStock: true,
  allowPriceEdit: true,
  receiptFooter: `شكراً لزيارتكم — ${STORE_NAME}`,
  thermalPrint: false
};

function key(branchId) {
  return `branch_settings_${branchId}`;
}

function getBranchSettings(branchId) {
  if (!branchId) return { ...DEFAULTS };
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key(branchId));
  if (!row?.value) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveBranchSettings(branchId, patch = {}) {
  const current = getBranchSettings(branchId);
  const next = { ...current, ...patch };
  db.prepare(`
    INSERT INTO sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key(branchId), JSON.stringify(next));
  return next;
}

module.exports = { DEFAULTS, getBranchSettings, saveBranchSettings };
