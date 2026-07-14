const db = require('../db');
const { createEdariCustomerAccount } = require('./edari-accounts');

function enqueueEdariSync({ kind, refType, refId, payload }) {
  db.prepare(`
    INSERT INTO edari_sync_queue (kind, ref_type, ref_id, payload, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(kind, refType || null, refId || null, JSON.stringify(payload || {}));
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

function completeAccountSyncFromRemote(itemId, result) {
  const item = getSyncItem(itemId);
  if (!item) throw new Error('عنصر المزامنة غير موجود');
  if (item.kind !== 'account') throw new Error('نوع غير مدعوم للإكمال عن بُعد');
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

async function processEdariQueue(limit = 20) {
  const items = listPendingSync(limit);
  const results = [];
  for (const item of items) {
    try {
      if (item.kind === 'account') {
        results.push({ id: item.id, ...(await processAccountSyncItem(item)) });
      } else {
        markSyncItem(item.id, 'pending', 'مزامنة الفواتير قيد التطوير — الحسابات فقط حالياً');
        results.push({ id: item.id, ok: false, pending: true, kind: item.kind });
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
      paymentMethod: invoice.paymentMethod,
      customerName: invoice.customerName,
      notes: invoice.notes,
      lines: (invoice.lines || []).map((l) => ({
        barcode: l.barcode,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal
      }))
    }
  });
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
}

module.exports = {
  enqueueEdariSync,
  listPendingSync,
  getSyncItem,
  processEdariQueue,
  syncAccountToEdari,
  queueInvoiceEdariSync,
  queuePaymentEdariSync,
  completeAccountSyncFromRemote
};
