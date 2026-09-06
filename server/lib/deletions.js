const db = require('../db');
const { loadInvoice } = require('./invoices');
const { getAccount, updateBalance } = require('./accounts');
const { adjustStock } = require('./products');
const { bumpDataRevision } = require('./data-revision');
const { getBranchSettings, isStockTracked } = require('./settings');

function purgeEdariQueue(refType, refId) {
  db.prepare('DELETE FROM edari_sync_queue WHERE ref_type = ? AND ref_id = ?').run(refType, refId);
}

function collectInvoiceIds(id) {
  const children = db.prepare('SELECT id FROM invoices WHERE parent_invoice_id = ?').all(Number(id));
  const ids = [];
  for (const child of children) ids.push(...collectInvoiceIds(child.id));
  ids.push(Number(id));
  return ids;
}

function revertInvoiceEffects(invoice) {
  const kind = invoice.kind || 'sale';
  const skipBranchStock = kind === 'sale' && invoice.prepMode === 'warehouse';
  const trackStock = isStockTracked(getBranchSettings(invoice.branchId));

  if (trackStock && !skipBranchStock) {
    for (const l of invoice.lines || []) {
      if (!l.barcode) continue;
      const pieces = Number(l.qty || 0) + Number(l.giftQty || 0);
      if (!pieces) continue;
      if (kind === 'sale' || kind === 'issue') {
        adjustStock(l.barcode, pieces);
      } else if (kind === 'return') {
        adjustStock(l.barcode, -pieces);
      }
    }
  }

  if (kind === 'sale' && invoice.accountId && Number(invoice.dueAmount || 0) > 0) {
    updateBalance(invoice.accountId, -Number(invoice.dueAmount));
  } else if (kind === 'return' && invoice.accountId && Number(invoice.total || 0) > 0) {
    updateBalance(invoice.accountId, Number(invoice.total));
  }
}

function purgeInvoiceRow(invoice) {
  revertInvoiceEffects(invoice);
  db.prepare("DELETE FROM journal_entries WHERE ref_type = 'invoice' AND ref_id = ?").run(invoice.id);
  purgeEdariQueue('invoice', invoice.id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
}

function deleteInvoiceById(id) {
  const root = loadInvoice(Number(id));
  if (!root) throw new Error('الفاتورة غير موجودة');

  const ids = collectInvoiceIds(root.id);
  const invoices = ids.map((invId) => loadInvoice(invId)).filter(Boolean);
  if (!invoices.length) throw new Error('الفاتورة غير موجودة');

  const tx = db.transaction(() => {
    for (const invoice of invoices) purgeInvoiceRow(invoice);
  });
  tx();

  const revision = bumpDataRevision();
  return {
    ok: true,
    deletedId: root.id,
    invoiceNo: root.invoiceNo,
    deletedCount: invoices.length,
    localOnly: true,
    revision
  };
}

function getPayment(id) {
  const r = db.prepare(`
    SELECT p.*, a.name AS account_name FROM payments p
    JOIN accounts a ON a.id = p.account_id WHERE p.id = ?
  `).get(Number(id));
  if (!r) return null;
  return {
    id: r.id,
    paymentNo: r.payment_no,
    accountId: r.account_id,
    accountName: r.account_name,
    amount: Number(r.amount),
    method: r.method,
    notes: r.notes || '',
    paymentDate: r.payment_date,
    edariJournalSeq: r.edari_journal_seq || '',
    edariSyncStatus: r.edari_sync_status || 'none'
  };
}

function purgePaymentRow(payment) {
  updateBalance(payment.accountId, payment.amount);
  db.prepare("DELETE FROM journal_entries WHERE ref_type = 'payment' AND ref_id = ?").run(payment.id);
  purgeEdariQueue('payment', payment.id);
  db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
}

function deletePaymentById(id) {
  const payment = getPayment(Number(id));
  if (!payment) throw new Error('التسديد غير موجود');

  const tx = db.transaction(() => purgePaymentRow(payment));
  tx();
  const revision = bumpDataRevision();
  return { ok: true, deletedId: payment.id, paymentNo: payment.paymentNo, localOnly: true, revision };
}

function deleteAccountById(id) {
  const account = getAccount(Number(id));
  if (!account) throw new Error('الحساب غير موجود');

  const invoiceIds = db.prepare('SELECT id FROM invoices WHERE account_id = ?').all(account.id).map((r) => r.id);
  const uniqueInvoiceIds = [...new Set(invoiceIds.flatMap((invId) => collectInvoiceIds(invId)))];
  const invoices = uniqueInvoiceIds.map((invId) => loadInvoice(invId)).filter(Boolean);
  const payments = db.prepare('SELECT id FROM payments WHERE account_id = ?').all(account.id);

  const tx = db.transaction(() => {
    for (const invoice of invoices) purgeInvoiceRow(invoice);
    for (const row of payments) {
      const payment = getPayment(row.id);
      if (payment) purgePaymentRow(payment);
    }
    db.prepare('DELETE FROM journal_entries WHERE account_id = ?').run(account.id);
    purgeEdariQueue('account', account.id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
  });
  tx();

  const revision = bumpDataRevision();
  return {
    ok: true,
    deletedId: account.id,
    code: account.code,
    name: account.name,
    deletedInvoices: invoices.length,
    deletedPayments: payments.length,
    localOnly: true,
    revision
  };
}

function deleteJournalEntryById(id) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(Number(id));
  if (!entry) throw new Error('القيد غير موجود');

  const tx = db.transaction(() => {
    const isStandalone = !entry.ref_type || entry.ref_type === 'adjustment' || entry.kind === 'adjustment';
    if (isStandalone && entry.account_id) {
      updateBalance(entry.account_id, -Number(entry.amount || 0));
    }
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id);
  });

  tx();
  const revision = bumpDataRevision();
  return {
    ok: true,
    deletedId: entry.id,
    entryNo: entry.entry_no,
    localOnly: true,
    revision
  };
}

module.exports = {
  deleteInvoiceById,
  deletePaymentById,
  deleteAccountById,
  deleteJournalEntryById,
  getPayment
};
