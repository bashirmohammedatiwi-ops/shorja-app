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

function listPendingSync(limit = 50, { kinds = null } = {}) {
  const kindList = Array.isArray(kinds) && kinds.length
    ? kinds.map((k) => `'${String(k).replace(/'/g, "''")}'`).join(', ')
    : null;
  const kindFilter = kindList ? `AND q.kind IN (${kindList})` : '';
  return db.prepare(`
    SELECT q.* FROM edari_sync_queue q
    LEFT JOIN invoices i ON q.kind = 'invoice' AND q.ref_type = 'invoice' AND i.id = q.ref_id
    LEFT JOIN payments p ON q.kind = 'payment' AND q.ref_type = 'payment' AND p.id = q.ref_id
    WHERE q.status IN ('pending', 'error')
      AND NOT (
        q.kind = 'invoice'
        AND COALESCE(i.edari_sync_status, '') = 'synced'
        AND COALESCE(i.edari_bill_seq, '') != ''
      )
      AND NOT (
        q.kind = 'payment'
        AND COALESCE(p.edari_sync_status, '') = 'synced'
        AND COALESCE(p.edari_journal_seq, '') != ''
      )
      ${kindFilter}
    ORDER BY q.id ASC LIMIT ?
  `).all(limit);
}

function hydrateQueuePayload(item) {
  let payload;
  try { payload = JSON.parse(item.payload || '{}'); } catch { payload = {}; }

  if (item.kind === 'invoice' && item.ref_type === 'invoice') {
    const inv = db.prepare(`
      SELECT i.account_id, i.customer_name, a.edari_seq, a.edari_sync_status, a.name AS account_name
      FROM invoices i
      LEFT JOIN accounts a ON a.id = i.account_id
      WHERE i.id = ?
    `).get(item.ref_id);
    if (inv?.account_id) payload.accountId = inv.account_id;
    if (inv?.edari_seq) payload.edariSeq = String(inv.edari_seq);
    payload.customerName = payload.customerName || inv?.customer_name || inv?.account_name || '';
    payload.accountEdariSyncStatus = inv?.edari_sync_status || '';
  }

  if (item.kind === 'payment' && item.ref_type === 'payment') {
    const pay = db.prepare(`
      SELECT p.account_id, a.edari_seq, a.edari_sync_status, a.name AS account_name
      FROM payments p
      LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.id = ?
    `).get(item.ref_id);
    if (pay?.account_id) payload.accountId = pay.account_id;
    if (pay?.edari_seq) payload.edariSeq = String(pay.edari_seq);
    payload.accountEdariSyncStatus = pay?.edari_sync_status || '';
    payload.customerName = payload.customerName || pay?.account_name || '';
  }

  return payload;
}

function listPendingSyncForRemote(limit = 50, options = {}) {
  return listPendingSync(limit, options).map((item) => ({
    ...item,
    payload: hydrateQueuePayload(item)
  }));
}
function enrichQueueItem(item) {
  const payload = hydrateQueuePayload(item);
  let title = '';
  let subtitle = '';
  let amount = null;
  let refLabel = '';

  if (item.kind === 'account' && item.ref_type === 'account') {
    const acc = db.prepare('SELECT name, phone, edari_num FROM accounts WHERE id = ?').get(item.ref_id);
    title = acc?.name || payload.name || `حساب #${item.ref_id}`;
    subtitle = acc?.phone || payload.phone || '';
    refLabel = acc?.edari_num ? `إداري: ${acc.edari_num}` : 'غير مربوط';
  } else if (item.kind === 'invoice' && item.ref_type === 'invoice') {
    const inv = db.prepare('SELECT invoice_no, customer_name, total, kind FROM invoices WHERE id = ?').get(item.ref_id);
    title = inv?.invoice_no || payload.invoiceNo || `فاتورة #${item.ref_id}`;
    subtitle = inv?.customer_name || payload.customerName || '';
    amount = inv?.total ?? payload.total;
    refLabel = inv?.kind === 'return' ? 'مرتجع' : (inv?.kind === 'issue' ? 'إخراج مخزون' : 'بيع');
    if (payload.accountId && !payload.edariSeq) {
      refLabel = 'يحتاج ترحيل حساب العميل أولاً';
    } else if (payload.edariSeq) {
      refLabel += ` · إداري: ${payload.edariSeq}`;
    }
  } else if (item.kind === 'payment' && item.ref_type === 'payment') {
    const pay = db.prepare(`
      SELECT p.payment_no, p.amount, p.notes, a.name AS account_name
      FROM payments p LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.id = ?
    `).get(item.ref_id);
    title = pay?.payment_no || payload.paymentNo || `تسديد #${item.ref_id}`;
    subtitle = pay?.account_name || '';
    amount = pay?.amount ?? payload.amount;
    refLabel = 'قيد تسديد';
    if (payload.accountId && !payload.edariSeq) {
      refLabel = 'يحتاج ترحيل حساب العميل أولاً';
    }
  } else {
    title = `${item.kind} #${item.ref_id}`;
  }

  return {
    id: item.id,
    kind: item.kind,
    refType: item.ref_type,
    refId: item.ref_id,
    status: item.status,
    error: item.error || '',
    attempts: item.attempts,
    updatedAt: item.updated_at,
    title,
    subtitle,
    amount,
    refLabel,
    payload
  };
}

function listPendingSyncEnriched(limit = 100, options = {}) {
  return listPendingSync(limit, options).map(enrichQueueItem);
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

async function processEdariQueue(limit = 20, { kinds = null, itemIds = null } = {}) {
  if (!canWriteEdari()) {
    return [{ ok: false, skipped: true, reason: 'edari_writes_disabled' }];
  }
  let items = listPendingSync(limit, { kinds });
  if (Array.isArray(itemIds) && itemIds.length) {
    const idSet = new Set(itemIds.map(Number));
    items = items.filter((item) => idSet.has(Number(item.id)));
  }
  const results = [];
  let wroteAccounts = false;
  let wroteInvoices = false;
  let wrotePayments = false;

  for (const item of items) {
    try {
      if (item.kind === 'account') {
        results.push({ id: item.id, ...(await processAccountSyncItem(item)) });
        wroteAccounts = true;
      } else if (item.kind === 'invoice') {
        results.push({ id: item.id, ...(await processInvoiceSyncItem(item)) });
        wroteInvoices = true;
      } else if (item.kind === 'payment') {
        results.push({ id: item.id, ...(await processPaymentSyncItem(item)) });
        wrotePayments = true;
      } else {
        markSyncItem(item.id, 'error', `نوع غير مدعوم: ${item.kind}`);
        results.push({ id: item.id, ok: false, error: item.kind });
      }
    } catch (err) {
      markSyncItem(item.id, 'error', err.message);
      results.push({ id: item.id, ok: false, error: err.message });
    }
  }

  return { results, wroteAccounts, wroteInvoices, wrotePayments };
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
  if (invoice.edariSyncStatus === 'synced' && invoice.edariBillSeq) return null;
  enqueueEdariSync({
    kind: 'invoice',
    refType: 'invoice',
    refId: invoice.id,
    payload: {
      invoiceNo: invoice.invoiceNo,
      kind: invoice.kind,
      accountId: invoice.accountId,
      edariSeq: invoice.edariSeq || null,
      subtotal: invoice.subtotal,
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
        lineDiscount: l.lineDiscount,
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
  if (payment.edariSyncStatus === 'synced' && payment.edariJournalSeq) return null;
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
  listPendingSyncForRemote,
  hydrateQueuePayload,
  listPendingSyncEnriched,
  enrichQueueItem,
  getSyncItem,
  syncQueueStats,
  processEdariQueue,
  syncAccountToEdari,
  queueInvoiceEdariSync,
  queuePaymentEdariSync,
  completeEdariSyncFromRemote,
  completeAccountSyncFromRemote
};
