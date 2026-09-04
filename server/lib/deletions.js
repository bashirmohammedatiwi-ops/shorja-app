const db = require('../db');
const { loadInvoice } = require('./invoices');
const { getAccount, updateBalance } = require('./accounts');
const { adjustStock } = require('./products');
const { bumpDataRevision } = require('./data-revision');

function purgeEdariQueue(refType, refId) {
  db.prepare('DELETE FROM edari_sync_queue WHERE ref_type = ? AND ref_id = ?').run(refType, refId);
}

function deleteInvoiceById(id) {
  const invoice = loadInvoice(Number(id));
  if (!invoice) throw new Error('الفاتورة غير موجودة');

  const childReturns = db.prepare(`
    SELECT id, invoice_no FROM invoices WHERE parent_invoice_id = ? AND kind = 'return'
  `).all(invoice.id);
  if (childReturns.length) {
    const nums = childReturns.map((r) => r.invoice_no).join('، ');
    throw new Error(`لا يمكن الحذف — توجد مرتجعات مرتبطة: ${nums}. احذف المرتجعات أولاً.`);
  }

  const kind = invoice.kind || 'sale';
  const skipBranchStock = kind === 'sale' && invoice.prepMode === 'warehouse';

  const tx = db.transaction(() => {
    if (!skipBranchStock) {
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

    db.prepare("DELETE FROM journal_entries WHERE ref_type = 'invoice' AND ref_id = ?").run(invoice.id);
    purgeEdariQueue('invoice', invoice.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
  });

  tx();
  const revision = bumpDataRevision();
  return { ok: true, deletedId: invoice.id, invoiceNo: invoice.invoiceNo, revision };
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

function deletePaymentById(id) {
  const payment = getPayment(Number(id));
  if (!payment) throw new Error('التسديد غير موجود');

  const tx = db.transaction(() => {
    updateBalance(payment.accountId, payment.amount);
    db.prepare("DELETE FROM journal_entries WHERE ref_type = 'payment' AND ref_id = ?").run(payment.id);
    purgeEdariQueue('payment', payment.id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
  });

  tx();
  const revision = bumpDataRevision();
  return { ok: true, deletedId: payment.id, paymentNo: payment.paymentNo, revision };
}

function deleteAccountById(id, { force = false } = {}) {
  const account = getAccount(Number(id));
  if (!account) throw new Error('الحساب غير موجود');
  if (!account.isActive && !force) throw new Error('الحساب محذوف مسبقاً');

  const balance = Number(account.balance || 0);
  if (balance !== 0 && !force) {
    throw new Error(`لا يمكن الحذف — رصيد الحساب ${balance}. سدّد الدين أو صفّر الرصيد أولاً.`);
  }

  const invCount = db.prepare('SELECT COUNT(*) AS c FROM invoices WHERE account_id = ?').get(account.id).c;
  const payCount = db.prepare('SELECT COUNT(*) AS c FROM payments WHERE account_id = ?').get(account.id).c;
  if ((invCount > 0 || payCount > 0) && !force) {
    throw new Error(`لا يمكن الحذف — الحساب مرتبط بـ ${invCount} فاتورة و ${payCount} تسديد. احذفها أولاً.`);
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM journal_entries WHERE account_id = ?").run(account.id);
    purgeEdariQueue('account', account.id);
    db.prepare(`
      UPDATE accounts
      SET is_active = 0, balance = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(account.id);
  });

  tx();
  const revision = bumpDataRevision();
  return { ok: true, deletedId: account.id, code: account.code, name: account.name, revision };
}

function deleteJournalEntryById(id) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(Number(id));
  if (!entry) throw new Error('القيد غير موجود');

  const refType = entry.ref_type || '';
  if (refType === 'invoice' || refType === 'payment') {
    throw new Error('هذا القيد مرتبط بفاتورة أو تسديد — احذف المستند الأصلي بدلاً من القيد.');
  }

  const tx = db.transaction(() => {
    if (entry.account_id) {
      updateBalance(entry.account_id, -Number(entry.amount || 0));
    }
    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id);
  });

  tx();
  const revision = bumpDataRevision();
  return { ok: true, deletedId: entry.id, entryNo: entry.entry_no, revision };
}

module.exports = {
  deleteInvoiceById,
  deletePaymentById,
  deleteAccountById,
  deleteJournalEntryById,
  getPayment
};
