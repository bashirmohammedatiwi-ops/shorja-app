const db = require('../db');

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
    isActive: !!row.is_active,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listAccounts({ q = '', hasDebt = false, limit = 100, offset = 0 } = {}) {
  const where = ['is_active = 1'];
  const params = [];
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

function createAccount(data) {
  const code = String(data.code || '').trim() || nextAccountCode();
  const row = db.prepare(`
    INSERT INTO accounts (code, name, phone, address, balance, credit_limit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    code, data.name, data.phone || '', data.address || '',
    Number(data.balance || 0), Number(data.creditLimit || 0), data.notes || ''
  );
  return getAccount(Number(row.id));
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

function accountStats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE is_active = 1').get().c;
  const withDebt = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE is_active = 1 AND balance > 0').get().c;
  const totalDebt = db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM accounts WHERE is_active = 1 AND balance > 0').get().s;
  return { total, withDebt, totalDebt: Number(totalDebt) };
}

module.exports = {
  mapAccount,
  listAccounts,
  getAccount,
  createAccount,
  updateBalance,
  accountStats
};
