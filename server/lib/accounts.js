const db = require('../db');
const { syncAccountToEdari } = require('./edari-sync');
const { normalizeCurrency } = require('./currency');

function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone || '',
    address: row.address || '',
    balance: Number(row.balance || 0),
    creditLimit: Number(row.credit_limit || 0),
    currency: normalizeCurrency(row.currency),
    isActive: !!row.is_active,
    notes: row.notes || '',
    edariSeq: row.edari_seq || '',
    edariNum: row.edari_num || '',
    edariSyncStatus: row.edari_sync_status || 'none',
    edariSyncError: row.edari_sync_error || '',
    accountScope: row.account_scope || 'warehouse',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listAccounts({ q = '', hasDebt = false, scope = '', edariStatus = '', limit = 100, offset = 0 } = {}) {
  const where = ['is_active = 1'];
  const params = [];
  if (scope === 'warehouse' || scope === 'delegate') {
    where.push('account_scope = ?');
    params.push(scope);
  }
  if (edariStatus === 'pending') {
    where.push("COALESCE(edari_sync_status, 'none') IN ('pending', 'none')");
  } else if (edariStatus === 'synced') {
    where.push("edari_sync_status = 'synced'");
  } else if (edariStatus === 'error') {
    where.push("edari_sync_status = 'error'");
  }
  if (q) {
    where.push('(name LIKE ? OR code LIKE ? OR phone LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (hasDebt) where.push('balance > 0');
  const sql = `
    SELECT * FROM accounts WHERE ${where.join(' AND ')}
    ORDER BY balance DESC, name LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE ${where.join(' AND ')}`)
    .get(...params.slice(0, -2)).c;
  return { accounts: rows.map(mapAccount), total };
}

function getAccount(id) {
  return mapAccount(db.prepare('SELECT * FROM accounts WHERE id = ?').get(id));
}

async function createAccount(data) {
  const code = String(data.code || '').trim() || nextAccountCode();
  const scope = data.accountScope === 'delegate' ? 'delegate' : 'warehouse';
  const row = db.prepare(`
    INSERT INTO accounts (code, name, phone, address, balance, credit_limit, notes, edari_sync_status, account_scope, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    RETURNING id
  `).get(
    code, data.name, data.phone || '', data.address || '',
    Number(data.balance || 0), Number(data.creditLimit || 0), data.notes || '', scope,
    normalizeCurrency(data.currency)
  );
  const account = getAccount(Number(row.id));
  if (process.env.EDARI_SYNC_ACCOUNTS !== '0') {
    await syncAccountToEdari(account, data);
  }
  return getAccount(Number(row.id));
}

async function updateAccount(id, data = {}) {
  const current = getAccount(id);
  if (!current) throw new Error('الحساب غير موجود');
  const name = String(data.name != null ? data.name : current.name).trim();
  if (!name) throw new Error('اسم الحساب مطلوب');
  db.prepare(`
    UPDATE accounts SET
      name = ?, phone = ?, address = ?, credit_limit = ?, notes = ?, currency = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name,
    data.phone != null ? String(data.phone) : current.phone,
    data.address != null ? String(data.address) : current.address,
    data.creditLimit != null ? Number(data.creditLimit) : current.creditLimit,
    data.notes != null ? String(data.notes) : current.notes,
    data.currency != null ? normalizeCurrency(data.currency) : current.currency,
    id
  );
  return getAccount(id);
}

function nextAccountCode() {
  const last = db.prepare('SELECT code FROM accounts ORDER BY id DESC LIMIT 1').get();
  if (!last) return 'C001';
  const n = Number(String(last.code).replace(/\D/g, '')) || 0;
  return `C${String(n + 1).padStart(3, '0')}`;
}

function updateBalance(accountId, delta) {
  db.prepare(`
    UPDATE accounts SET balance = balance + ?, updated_at = datetime('now') WHERE id = ?
  `).run(delta, accountId);
  return getAccount(accountId);
}

function accountStats({ scope = '' } = {}) {
  const scopeWhere = scope === 'warehouse' || scope === 'delegate' ? ' AND account_scope = ?' : '';
  const scopeParams = scopeWhere ? [scope] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE is_active = 1${scopeWhere}`).get(...scopeParams).c;
  const withDebt = db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE is_active = 1 AND balance > 0${scopeWhere}`).get(...scopeParams).c;
  const totalDebt = db.prepare(`SELECT COALESCE(SUM(balance), 0) AS s FROM accounts WHERE is_active = 1 AND balance > 0${scopeWhere}`).get(...scopeParams).s;
  return { total, withDebt, totalDebt: Number(totalDebt), scope: scope || 'all' };
}

/** Debt snapshot for invoice print: previous balance before this invoice, current invoice due, total after. */
function resolveInvoiceDebtInfo(invoice) {
  if (!invoice?.accountId) return null;
  const acc = getAccount(invoice.accountId);
  if (!acc) return null;
  const invoiceDue = Number(invoice.dueAmount || 0);
  const sign = invoice.kind === 'return' ? -1 : 1;
  const totalDebt = Number(acc.balance || 0);
  const previousDebt = totalDebt - sign * invoiceDue;
  return {
    accountId: acc.id,
    accountName: acc.name,
    previousDebt: Math.max(0, previousDebt),
    invoiceDue,
    totalDebt: Math.max(0, totalDebt)
  };
}

module.exports = {
  mapAccount,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  updateBalance,
  accountStats,
  resolveInvoiceDebtInfo
};
