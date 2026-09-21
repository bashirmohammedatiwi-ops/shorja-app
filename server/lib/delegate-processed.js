/**
 * استقبال طلبات «تم التجهيز» من بوابة المندوبين وعرضها في فرع المندوبين بالإدارة.
 */
const db = require('../db');
const { getAccount, updateBalance } = require('./accounts');
const { loadInvoice, addJournalEntry, mapInvoice } = require('./invoices');
const { queueInvoiceEdariSync } = require('./edari-sync');
const { localStamp } = require('./datetime');

const DELEGATE_BRANCH_CODE = 'DELEGATE';

function ensureDelegateBranch() {
  let row = db.prepare('SELECT id FROM branches WHERE code = ?').get(DELEGATE_BRANCH_CODE);
  if (!row) {
    db.prepare('INSERT INTO branches (code, name) VALUES (?, ?)').run(DELEGATE_BRANCH_CODE, 'المندوبين');
    row = db.prepare('SELECT id FROM branches WHERE code = ?').get(DELEGATE_BRANCH_CODE);
  } else {
    db.prepare('UPDATE branches SET name = ? WHERE id = ?').run('المندوبين', row.id);
  }
  return Number(row.id);
}

function nextLinkedAccountCode() {
  const last = db.prepare('SELECT code FROM accounts ORDER BY id DESC LIMIT 1').get();
  if (!last) return 'C001';
  const n = Number(String(last.code).replace(/\D/g, '')) || 0;
  return `C${String(n + 1).padStart(3, '0')}`;
}

function resolveAccountId(edariSeq, customerName) {
  const seq = String(edariSeq || '').trim();
  if (seq) {
    const existing = db.prepare('SELECT id FROM accounts WHERE edari_seq = ?').get(seq);
    if (existing) {
      db.prepare("UPDATE accounts SET account_scope = 'delegate' WHERE id = ? AND account_scope != 'delegate'")
        .run(Number(existing.id));
      return Number(existing.id);
    }
    const row = db.prepare(`
      INSERT INTO accounts (code, name, edari_seq, edari_sync_status, edari_sync_error, account_scope)
      VALUES (?, ?, ?, 'synced', '', 'delegate')
      RETURNING id
    `).get(nextLinkedAccountCode(), String(customerName || 'زبون مندوب').trim() || 'زبون مندوب', seq);
    return Number(row.id);
  }
  const name = String(customerName || '').trim();
  if (name) {
    const byName = db.prepare('SELECT id FROM accounts WHERE name = ? AND is_active = 1 ORDER BY id DESC LIMIT 1').get(name);
    if (byName) {
      db.prepare("UPDATE accounts SET account_scope = 'delegate' WHERE id = ? AND account_scope != 'delegate'")
        .run(Number(byName.id));
      return Number(byName.id);
    }
  }
  return null;
}

function normalizeLines(lines = []) {
  return lines
    .map((line) => {
      const qty = Math.max(0, Number(line.quant ?? line.qty ?? 0));
      const giftQty = Math.max(0, Math.round(Number(line.bonus ?? line.giftQty ?? 0)));
      const testerQty = Math.max(0, Math.round(Number(line.tester ?? 0)));
      const unitPrice = Number(line.unitPrice || 0);
      const lineTotal = Number(line.lineTotal ?? (qty * unitPrice));
      const name = String(line.matName || line.name || '').trim();
      return {
        barcode: String(line.barcode || '').trim(),
        name,
        qty,
        giftQty,
        testerQty,
        unitPrice,
        lineDiscount: 0,
        lineTotal: Math.round(lineTotal)
      };
    })
    .filter((l) => l.name && (l.qty > 0 || l.giftQty > 0 || l.testerQty > 0));
}

function queueInvoiceForEdari(invoiceId) {
  const invoice = loadInvoice(invoiceId);
  if (!invoice) return { invoice: null, queueId: null };
  if (invoice.edariSyncStatus === 'archived') return { invoice, queueId: null };
  const acc = invoice.accountId ? getAccount(invoice.accountId) : null;
  const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(invoice.branchId);
  const queueId = queueInvoiceEdariSync({
    ...invoice,
    edariSeq: acc?.edariSeq || '',
    branchName: branch?.name || ''
  });
  return { invoice: loadInvoice(invoiceId), queueId };
}

function markWarehouseInvoiceProcessed(data) {
  const invoiceId = Number(data.shorjaInvoiceId || 0);
  if (!invoiceId) throw new Error('shorjaInvoiceId مطلوب لطلبات الشورجة');

  const row = db.prepare('SELECT id FROM invoices WHERE id = ?').get(invoiceId);
  if (!row) throw new Error('فاتورة الشورجة غير موجودة');

  db.prepare(`
    UPDATE invoices
    SET prep_status = 'processing',
        prep_order_id = COALESCE(prep_order_id, ?),
        prep_order_no = COALESCE(NULLIF(prep_order_no, ''), ?),
        edari_sync_status = CASE
          WHEN COALESCE(edari_sync_status, '') IN ('synced', 'archived') THEN edari_sync_status
          ELSE 'pending'
        END,
        edari_sync_error = CASE
          WHEN COALESCE(edari_sync_status, '') IN ('synced', 'archived') THEN edari_sync_error
          ELSE 'جاهز للترحيل بعد التجهيز'
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.orderId ? Number(data.orderId) : null,
    String(data.orderNo || ''),
    invoiceId
  );

  const invoice = loadInvoice(invoiceId);
  if (invoice.edariSyncStatus !== 'synced' && invoice.edariSyncStatus !== 'archived') {
    queueInvoiceForEdari(invoiceId);
  }
  return invoice;
}

function createDelegateInvoiceFromOrder(data) {
  const orderId = Number(data.orderId || 0);
  if (!orderId) throw new Error('orderId مطلوب');

  const existing = db.prepare(`
    SELECT id FROM invoices WHERE prep_mode = 'delegate' AND prep_order_id = ?
  `).get(orderId);
  if (existing) {
    db.prepare(`
      UPDATE invoices SET prep_status = 'processing', updated_at = datetime('now') WHERE id = ?
    `).run(existing.id);
    const invoice = loadInvoice(existing.id);
    if (invoice.edariSyncStatus !== 'synced' && invoice.edariSyncStatus !== 'archived') {
      queueInvoiceForEdari(existing.id);
    }
    return invoice;
  }

  const lines = normalizeLines(data.lines);
  if (!lines.length) throw new Error('لا توجد بنود صالحة في الطلب');

  const delegateBranchId = ensureDelegateBranch();
  const accountId = resolveAccountId(data.customerAccSeq, data.customerName);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const total = subtotal;
  const paymentMethod = accountId ? 'credit' : 'cash';
  const paidAmount = accountId ? 0 : total;
  const dueAmount = accountId ? total : 0;
  const customerName = String(data.customerName || '').trim() || 'زبون مندوب';
  const invoiceNo = `MND-${String(data.orderNo || orderId).replace(/\s+/g, '')}`;
  const noteParts = [
    `طلب مندوب: ${data.orderNo || orderId}`,
    data.agentName ? `المندوب: ${data.agentName}` : '',
    data.catalogBranchName ? `الفرع: ${data.catalogBranchName}` : '',
    data.notes || ''
  ].filter(Boolean);

  const tx = db.transaction(() => {
    const row = db.prepare(`
      INSERT INTO invoices
        (invoice_no, branch_id, cashier_id, account_id, customer_name, kind, status,
         subtotal, discount, total, paid_amount, due_amount, payment_method, notes,
         sync_status, invoice_date, created_at, prep_mode, prep_order_id, prep_order_no, prep_status,
         edari_sync_status, edari_sync_error)
      VALUES (?, ?, NULL, ?, ?, 'sale', 'posted', ?, 0, ?, ?, ?, ?, ?, 'synced', ?, ?, 'delegate', ?, ?, 'processing', 'pending', 'جاهز للترحيل')
      RETURNING id
    `).get(
      invoiceNo,
      delegateBranchId,
      accountId,
      customerName,
      subtotal,
      total,
      paidAmount,
      dueAmount,
      paymentMethod,
      noteParts.join('\n'),
      localStamp().date,
      localStamp().datetime,
      orderId,
      String(data.orderNo || '')
    );
    const invoiceId = Number(row.id);
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines
        (invoice_id, product_id, barcode, name, qty, unit_price, line_discount, line_total, original_price, price_edited, gift_qty)
      VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?, 0, ?)
    `);
    for (const l of lines) {
      insertLine.run(
        invoiceId, l.barcode, l.name, l.qty, l.unitPrice, l.lineTotal, l.unitPrice, l.giftQty
      );
    }
    if (accountId && dueAmount > 0) {
      updateBalance(accountId, dueAmount);
      addJournalEntry({
        accountId,
        branchId: delegateBranchId,
        kind: 'sale',
        amount: dueAmount,
        refType: 'invoice',
        refId: invoiceId,
        description: `فاتورة مندوب ${invoiceNo}`
      });
    }
    return invoiceId;
  });

  const invoiceId = tx();
  queueInvoiceForEdari(invoiceId);
  return loadInvoice(invoiceId);
}

async function handleDelegateProcessedOrder(body = {}) {
  const sourceType = String(body.sourceType || 'delegate');
  if (sourceType === 'shorja' && body.shorjaInvoiceId) {
    return {
      action: 'updated',
      invoice: markWarehouseInvoiceProcessed(body)
    };
  }
  return {
    action: 'created',
    invoice: createDelegateInvoiceFromOrder(body)
  };
}

function getDelegateBranchId() {
  const row = db.prepare('SELECT id FROM branches WHERE code = ?').get(DELEGATE_BRANCH_CODE);
  return row ? Number(row.id) : null;
}

function delegateInvoiceMatchSql() {
  return `(
    i.prep_mode = 'delegate'
    OR UPPER(COALESCE(i.invoice_no, '')) LIKE 'MND%'
    OR COALESCE(b.code, '') = '${DELEGATE_BRANCH_CODE}'
    OR COALESCE(a.account_scope, '') = 'delegate'
    OR COALESCE(i.notes, '') LIKE '%مندوب%'
    OR COALESCE(b.name, '') LIKE '%مندوب%'
  )`;
}

function delegateInvoiceMatchPlainSql() {
  return `(
    prep_mode = 'delegate'
    OR UPPER(COALESCE(invoice_no, '')) LIKE 'MND%'
    OR COALESCE(notes, '') LIKE '%مندوب%'
    OR account_id IN (SELECT id FROM accounts WHERE account_scope = 'delegate')
    OR branch_id IN (
      SELECT id FROM branches
      WHERE code = '${DELEGATE_BRANCH_CODE}' OR name LIKE '%مندوب%'
    )
  )`;
}

function delegateSourceLabel(row) {
  const notes = String(row.notes || '');
  const agent = notes.match(/المندوب:\s*([^\n]+)/);
  if (agent && agent[1].trim()) return agent[1].trim();
  if (row.prep_order_no) return String(row.prep_order_no);
  return row.branch_name || row.customer_name || 'مندوب';
}

function listPrepInvoices({
  prepMode,
  q,
  dateFrom,
  dateTo,
  limit = 2000,
  offset = 0,
  edariStatus = '',
  prepState = ''
} = {}) {
  const mode = String(prepMode || '').trim();
  if (mode !== 'warehouse' && mode !== 'delegate') {
    throw new Error('prepMode مطلوب: warehouse أو delegate');
  }
  const where = [];
  const params = [];
  if (mode === 'delegate') {
    where.push(delegateInvoiceMatchSql());
  } else {
    where.push("i.prep_mode = 'warehouse'");
  }
  where.push("COALESCE(i.kind, 'sale') IN ('sale', 'return')");
  if (prepState === 'processing') {
    where.push("i.prep_status = 'processing'");
  } else if (prepState === 'submitted') {
    where.push("COALESCE(i.prep_status, '') IN ('submitted', 'hold', 'error', 'skipped')");
  }
  if (dateFrom) { where.push("substr(COALESCE(i.invoice_date, i.created_at, ''), 1, 10) >= ?"); params.push(dateFrom); }
  if (dateTo) { where.push("substr(COALESCE(i.invoice_date, i.created_at, ''), 1, 10) <= ?"); params.push(dateTo); }
  if (edariStatus === 'pending') {
    where.push("COALESCE(i.edari_sync_status, '') NOT IN ('synced', 'archived')");
  } else if (edariStatus === 'synced') {
    where.push("i.edari_sync_status = 'synced'");
  } else if (edariStatus === 'archived') {
    where.push("i.edari_sync_status = 'archived'");
  }
  if (q) {
    where.push(`(
      i.invoice_no LIKE ? OR i.customer_name LIKE ? OR i.prep_order_no LIKE ? OR i.notes LIKE ?
      OR COALESCE(a.name, '') LIKE ?
      OR EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND (l.barcode LIKE ? OR l.name LIKE ?))
    )`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  const fromSql = `
    FROM invoices i
    LEFT JOIN accounts a ON a.id = i.account_id
    LEFT JOIN branches b ON b.id = i.branch_id
    WHERE ${where.join(' AND ')}
  `;
  const sql = `
    SELECT i.*, a.name AS account_name, a.account_scope AS account_scope,
           b.name AS branch_name, b.code AS branch_code
    ${fromSql}
    ORDER BY COALESCE(i.invoice_date, i.created_at, '') DESC, i.id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(sql).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c ${fromSql}`).get(...params).c;

  const invoices = rows.map((row) => {
    const inv = mapInvoice(row);
    return {
      ...inv,
      accountScope: row.account_scope || '',
      branchName: row.branch_name || inv.branchName || '',
      sourceLabel: mode === 'warehouse'
        ? (row.branch_name || 'فرع الشورجة')
        : delegateSourceLabel(row)
    };
  });

  return { invoices, total: Number(total) };
}

function listDelegateInvoices(opts = {}) {
  return listPrepInvoices({ ...opts, prepMode: 'delegate' });
}

function listWarehousePrepInvoices(opts = {}) {
  return listPrepInvoices({ ...opts, prepMode: 'warehouse' });
}

function prepInvoiceStats(prepMode) {
  const mode = String(prepMode || '').trim();
  if (mode !== 'warehouse' && mode !== 'delegate') {
    throw new Error('prepMode مطلوب: warehouse أو delegate');
  }
  const scopeSql = mode === 'delegate'
    ? delegateInvoiceMatchPlainSql()
    : "prep_mode = 'warehouse'";
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN prep_status = 'processing' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN COALESCE(prep_status, '') IN ('submitted', 'hold', 'error', 'skipped') THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN edari_sync_status = 'synced' THEN 1 ELSE 0 END) AS synced,
      SUM(CASE WHEN edari_sync_status = 'archived' THEN 1 ELSE 0 END) AS archived,
      SUM(CASE WHEN COALESCE(edari_sync_status, '') NOT IN ('synced', 'archived') THEN 1 ELSE 0 END) AS pending
    FROM invoices
    WHERE ${scopeSql}
      AND COALESCE(kind, 'sale') IN ('sale', 'return')
  `).get();
  return {
    total: Number(row?.total || 0),
    ready: Number(row?.ready || 0),
    waiting: Number(row?.waiting || 0),
    synced: Number(row?.synced || 0),
    archived: Number(row?.archived || 0),
    pending: Number(row?.pending || 0)
  };
}

function delegateInvoiceStats() {
  return prepInvoiceStats('delegate');
}

function warehousePrepStats() {
  return prepInvoiceStats('warehouse');
}

module.exports = {
  DELEGATE_BRANCH_CODE,
  ensureDelegateBranch,
  getDelegateBranchId,
  handleDelegateProcessedOrder,
  listPrepInvoices,
  listDelegateInvoices,
  listWarehousePrepInvoices,
  prepInvoiceStats,
  delegateInvoiceStats,
  warehousePrepStats,
  queueInvoiceForEdari,
  delegateInvoiceMatchSql
};
