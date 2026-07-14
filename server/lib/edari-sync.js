const db = require('../db');
const { createEdariCustomerAccount } = require('./edari-accounts');
const { createEdariInvoice, createEdariPayment } = require('./edari-invoices');
const { canWriteEdari } = require('./edari-bridge');

function enqueueEdariSync({ kind, refType, refId, payload }) {
  const existing = db.prepare(`
    SELECT id FROM edari_sync_queue
    WHERE kind = ? AND ref_type = ? AND ref_id = ? AND status IN ('pending', 'error')
    ORDER BY id DESC LIMIT 1
  `).get(kind, refType || null, refId || null);

  if (existing) {
    db.prepare(`
      UPDATE edari_sync_queue
      SET payload = ?, status = 'pending', error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(payload || {}), existing.id);
    return existing.id;
  }

  const row = db.prepare(`
    INSERT INTO edari_sync_queue (kind, ref_type, ref_id, payload, status)
    VALUES (?, ?, ?, ?, 'pending')
    RETURNING id
  `).get(kind, refType || null, refId || null, JSON.stringify(payload || {}));
  return Number(row.id);
}

function syncQueueStats() {
  const pending = db.prepare(`SELECT COUNT(*) AS c FROM edari_sync_queue WHERE status = 'pending'`).get().c;
  const error = db.prepare(`SELECT COUNT(*) AS c FROM edari_sync_queue WHERE status = 'error'`).get().c;
  const accountsPending = db.prepare(`
    SELECT COUNT(*) AS c FROM accounts WHERE edari_sync_status IN ('pending', 'error')
  `).get().c;
  const invoicesPending = db.prepare(`
    SELECT COUNT(*) AS c FROM invoices WHERE edari_sync_status IN ('pending', 'error')
  `).get().c;
  const paymentsPending = db.prepare(`
    SELECT COUNT(*) AS c FROM payments WHERE edari_sync_status IN ('pending', 'error')
  `).get().c;
  const byKind = db.prepare(`
    SELECT kind, COUNT(*) AS c FROM edari_sync_queue WHERE status IN ('pending', 'error') GROUP BY kind
  `).all();
  const queueByKind = Object.fromEntries(byKind.map((r) => [r.kind, Number(r.c)]));
  return {
    pending: Number(pending),
    error: Number(error),
    accountsPending: Number(accountsPending),
    invoicesPending: Number(invoicesPending),
    paymentsPending: Number(paymentsPending),
    queueByKind,
    total: Number(pending) + Number(error)
  };
}

function listPendingSync(limit = 50) {
  return db.prepare(`
    SELECT * FROM edari_sync_queue
    WHERE status IN ('pending', 'error')
    ORDER BY id ASC LIMIT ?
  `).all(limit);
}

function markSyncItem(id, status, error = '') {
  db.prepare(`
    UPDATE edari_sync_queue
    SET status = ?, error = ?, attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, error || null, id);
}

function getSyncItem(id) {
  return db.prepare('SELECT * FROM edari_sync_queue WHERE id = ?').get(id);
}

function completeEdariSyncFromRemote(itemId, result) {
  const item = getSyncItem(itemId);
  if (!item) throw new Error('عنصر المزامنة غير موجود');

  if (item.kind === 'account') {
    const accountId = Number(item.ref_id);
    if (result.ok) {
      db.prepare(`
        UPDATE accounts SET edari_seq = ?, edari_num = ?, edari_sync_status = 'synced',
          edari_sync_error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(result.edariSeq, result.edariNum, accountId);
      markSyncItem(itemId, 'done');
      return { ok: true };
    }
    markSyncItem(itemId, 'error', result.error || 'فشل');
    db.prepare(`
      UPDATE accounts SET edari_sync_status = 'error', edari_sync_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.error || 'فشل', accountId);
    return { ok: false, error: result.error };
  }

  if (item.kind === 'invoice') {
    const invoiceId = Number(item.ref_id);
    if (result.ok) {
      if (result.skipped) {
        markSyncItem(itemId, 'done');
        db.prepare(`
          UPDATE invoices SET edari_sync_status = 'synced', edari_sync_error = NULL WHERE id = ?
        `).run(invoiceId);
        return { ok: true, skipped: true };
      }
      db.prepare(`
        UPDATE invoices SET edari_bill_seq = ?, edari_bill_num = ?, edari_sync_status = 'synced',
          edari_sync_error = NULL
        WHERE id = ?
      `).run(result.edariBillSeq, result.edariBillNum, invoiceId);
      markSyncItem(itemId, 'done');
      return { ok: true };
    }
    markSyncItem(itemId, 'error', result.error || 'فشل');
    db.prepare(`
      UPDATE invoices SET edari_sync_status = 'error', edari_sync_error = ? WHERE id = ?
    `).run(result.error || 'فشل', invoiceId);
    return { ok: false, error: result.error };
  }

  if (item.kind === 'payment') {
    const paymentId = Number(item.ref_id);
    if (result.ok) {
      db.prepare(`
        UPDATE payments SET edari_journal_seq = ?, edari_sync_status = 'synced', edari_sync_error = NULL
        WHERE id = ?
      `).run(result.edariJournalSeq || '', paymentId);
      markSyncItem(itemId, 'done');
      return { ok: true };
    }
    markSyncItem(itemId, 'error', result.error || 'فشل');
    db.prepare(`
      UPDATE payments SET edari_sync_status = 'error', edari_sync_error = ? WHERE id = ?
    `).run(result.error || 'فشل', paymentId);
    return { ok: false, error: result.error };
  }

  throw new Error(`نوع غير مدعوم: ${item.kind}`);
}

/** @deprecated use completeEdariSyncFromRemote */
function completeAccountSyncFromRemote(itemId, result) {
  return completeEdariSyncFromRemote(itemId, result);
}

async function processAccountSyncItem(item) {
  const payload = JSON.parse(item.payload || '{}');
  const accountId = Number(item.ref_id);
  const result = await createEdariCustomerAccount(payload);
  if (!result.ok) {
    markSyncItem(item.id, result.queued ? 'pending' : 'error', result.error || 'فشل');
    return result;
  }
  db.prepare(`
    UPDATE accounts SET edari_seq = ?, edari_num = ?, edari_sync_status = 'synced',
      edari_sync_error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(result.edariSeq, result.edariNum, accountId);
  markSyncItem(item.id, 'done');
  return { ok: true, ...result };
}

async function processInvoiceSyncItem(item) {
  const payload = JSON.parse(item.payload || '{}');
  const invoiceId = Number(item.ref_id);
  if (payload.kind === 'issue') {
    markSyncItem(item.id, 'done');
    db.prepare(`UPDATE invoices SET edari_sync_status = 'synced' WHERE id = ?`).run(invoiceId);
    return { ok: true, skipped: true, reason: 'issue' };
  }
  const result = await createEdariInvoice(payload);
  if (!result.ok) {
    markSyncItem(item.id, result.queued ? 'pending' : 'error', result.error || 'فشل');
    if (!result.queued) {
      db.prepare(`UPDATE invoices SET edari_sync_status = 'error', edari_sync_error = ? WHERE id = ?`)
        .run(result.error || 'فشل', invoiceId);
    }
    return result;
  }
  if (result.skipped) {
    markSyncItem(item.id, 'done');
    db.prepare(`UPDATE invoices SET edari_sync_status = 'synced', edari_sync_error = NULL WHERE id = ?`).run(invoiceId);
    return result;
  }
  db.prepare(`
    UPDATE invoices SET edari_bill_seq = ?, edari_bill_num = ?, edari_sync_status = 'synced', edari_sync_error = NULL
    WHERE id = ?
  `).run(result.edariBillSeq, result.edariBillNum, invoiceId);
  markSyncItem(item.id, 'done');
  return { ok: true, ...result };
}

async function processPaymentSyncItem(item) {
  const payload = JSON.parse(item.payload || '{}');
  const paymentId = Number(item.ref_id);
  const result = await createEdariPayment(payload);
  if (!result.ok) {
    markSyncItem(item.id, result.queued ? 'pending' : 'error', result.error || 'فشل');
    if (!result.queued) {
      db.prepare(`UPDATE payments SET edari_sync_status = 'error', edari_sync_error = ? WHERE id = ?`)
        .run(result.error || 'فشل', paymentId);
    }
    return result;
  }
  db.prepare(`
    UPDATE payments SET edari_journal_seq = ?, edari_sync_status = 'synced', edari_sync_error = NULL
    WHERE id = ?
  `).run(result.edariJournalSeq || '', paymentId);
  markSyncItem(item.id, 'done');
  return { ok: true, ...result };
}

async function processEdariQueue(limit = 20) {
  const items = listPendingSync(limit);
  const results = [];
  for (const item of items) {
    try {
      if (item.kind === 'account') {
        results.push({ id: item.id, ...(await processAccountSyncItem(item)) });
      } else if (item.kind === 'invoice') {
        results.push({ id: item.id, ...(await processInvoiceSyncItem(item)) });
      } else if (item.kind === 'payment') {
        results.push({ id: item.id, ...(await processPaymentSyncItem(item)) });
      } else {
        markSyncItem(item.id, 'error', `نوع غير مدعوم: ${item.kind}`);
        results.push({ id: item.id, ok: false, error: item.kind });
      }
    } catch (err) {
      markSyncItem(item.id, 'error', err.message);
      results.push({ id: item.id, ok: false, error: err.message });
    }
  }
  return results;
}

async function syncAccountToEdari(account, data = {}) {
  const payload = {
    name: data.name || account.name,
    phone: data.phone || account.phone,
    address: data.address || account.address,
    notes: data.notes || account.notes
  };

  if (!canWriteEdari()) {
    enqueueEdariSync({ kind: 'account', refType: 'account', refId: account.id, payload });
    db.prepare(`
      UPDATE accounts SET edari_sync_status = 'pending', edari_sync_error = 'بانتظار جهاز الإدارة',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(account.id);
    return { synced: false, queued: true };
  }

  try {
    const result = await createEdariCustomerAccount(payload);
    if (result.ok) {
      db.prepare(`
        UPDATE accounts SET edari_seq = ?, edari_num = ?, edari_sync_status = 'synced',
          edari_sync_error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(result.edariSeq, result.edariNum, account.id);
      return { synced: true, ...result };
    }
    enqueueEdariSync({ kind: 'account', refType: 'account', refId: account.id, payload });
    db.prepare(`
      UPDATE accounts SET edari_sync_status = 'pending', edari_sync_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(result.error || 'في انتظار المزامنة', account.id);
    return { synced: false, queued: true, error: result.error };
  } catch (err) {
    enqueueEdariSync({ kind: 'account', refType: 'account', refId: account.id, payload });
    db.prepare(`
      UPDATE accounts SET edari_sync_status = 'error', edari_sync_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(err.message, account.id);
    return { synced: false, queued: true, error: err.message };
  }
}

function queueInvoiceEdariSync(invoice) {
  if (invoice.kind === 'issue') return null;
  enqueueEdariSync({
    kind: 'invoice',
    refType: 'invoice',
    refId: invoice.id,
    payload: {
      invoiceNo: invoice.invoiceNo,
      kind: invoice.kind,
      accountId: invoice.accountId,
      edariSeq: invoice.edariSeq || null,
      total: invoice.total,
      dueAmount: invoice.dueAmount,
      paidAmount: invoice.paidAmount,
      discount: invoice.discount,
      paymentMethod: invoice.paymentMethod,
      customerName: invoice.customerName,
      branchName: invoice.branchName || '',
      notes: invoice.notes,
      invoiceDate: invoice.invoiceDate,
      lines: (invoice.lines || []).map((l) => ({
        barcode: l.barcode,
        name: l.name,
        qty: l.qty,
        giftQty: l.giftQty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal
      }))
    }
  });
  db.prepare(`
    UPDATE invoices SET edari_sync_status = 'pending', edari_sync_error = 'بانتظار الإداري'
    WHERE id = ?
  `).run(invoice.id);
}

function queuePaymentEdariSync(payment, account) {
  enqueueEdariSync({
    kind: 'payment',
    refType: 'payment',
    refId: payment.id,
    payload: {
      paymentNo: payment.paymentNo,
      accountId: payment.accountId,
      edariSeq: account?.edariSeq || '',
      amount: payment.amount,
      method: payment.method,
      notes: payment.notes,
      paymentDate: payment.paymentDate
    }
  });
  db.prepare(`
    UPDATE payments SET edari_sync_status = 'pending', edari_sync_error = 'بانتظار الإداري'
    WHERE id = ?
  `).run(payment.id);
}

module.exports = {
  enqueueEdariSync,
  listPendingSync,
  getSyncItem,
  syncQueueStats,
  processEdariQueue,
  syncAccountToEdari,
  queueInvoiceEdariSync,
  queuePaymentEdariSync,
  completeEdariSyncFromRemote,
  completeAccountSyncFromRemote
};
