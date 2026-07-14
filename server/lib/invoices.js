const db = require('../db');
const { updateBalance, getAccount } = require('./accounts');
const { adjustStock, getByBarcode } = require('./products');
const { getBranchSettings } = require('./settings');
const { queueInvoiceEdariSync, queuePaymentEdariSync } = require('./edari-sync');

function nextInvoiceNo(branchId) {
  const prefix = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = db.prepare(`
    SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last?.invoice_no) {
    const part = Number(last.invoice_no.split('-').pop());
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function nextReturnNo() {
  const prefix = `RET-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = db.prepare(`
    SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last?.invoice_no) {
    const part = Number(last.invoice_no.split('-').pop());
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function nextIssueNo() {
  const prefix = `OUT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = db.prepare(`
    SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last?.invoice_no) {
    const part = Number(last.invoice_no.split('-').pop());
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function returnedQtyForLine(parentId, barcode) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.qty + COALESCE(l.gift_qty, 0)), 0) AS q FROM invoice_lines l
    JOIN invoices i ON i.id = l.invoice_id
    WHERE i.parent_invoice_id = ? AND i.kind = 'return' AND l.barcode = ?
  `).get(parentId, barcode);
  return Number(row?.q || 0);
}

function nextPaymentNo() {
  const prefix = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = db.prepare(`
    SELECT payment_no FROM payments WHERE payment_no LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last?.payment_no) {
    const part = Number(last.payment_no.split('-').pop());
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function nextEntryNo() {
  const prefix = `JE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const last = db.prepare(`
    SELECT entry_no FROM journal_entries WHERE entry_no LIKE ? ORDER BY id DESC LIMIT 1
  `).get(`${prefix}-%`);
  let seq = 1;
  if (last?.entry_no) {
    const part = Number(last.entry_no.split('-').pop());
    if (!Number.isNaN(part)) seq = part + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function addJournalEntry({ accountId, branchId, kind, amount, refType, refId, description, createdBy, entryDate }) {
  let balanceAfter = null;
  if (accountId) {
    const acc = getAccount(accountId);
    balanceAfter = Number(acc?.balance || 0);
  }
  db.prepare(`
    INSERT INTO journal_entries
      (entry_no, account_id, branch_id, kind, amount, balance_after, ref_type, ref_id, description, created_by, entry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nextEntryNo(), accountId || null, branchId || null, kind, amount,
    balanceAfter, refType || null, refId || null, description,
    createdBy || null, entryDate || new Date().toISOString().slice(0, 10)
  );
}

function mapInvoice(row, lines = []) {
  return {
    id: row.id,
    localId: row.local_id,
    invoiceNo: row.invoice_no,
    branchId: row.branch_id,
    cashierId: row.cashier_id,
    accountId: row.account_id,
    customerName: row.customer_name || '',
    accountName: row.account_name || '',
    kind: row.kind,
    parentInvoiceId: row.parent_invoice_id,
    status: row.status,
    subtotal: Number(row.subtotal || 0),
    discount: Number(row.discount || 0),
    total: Number(row.total || 0),
    paidAmount: Number(row.paid_amount || 0),
    dueAmount: Number(row.due_amount || 0),
    paymentMethod: row.payment_method,
    notes: row.notes || '',
    syncStatus: row.sync_status,
    edariBillSeq: row.edari_bill_seq || '',
    edariBillNum: row.edari_bill_num || '',
    edariSyncStatus: row.edari_sync_status || 'none',
    edariSyncError: row.edari_sync_error || '',
    invoiceDate: row.invoice_date,
    createdAt: row.created_at,
    lines: lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      barcode: l.barcode,
      name: l.name,
      qty: Number(l.qty || 0),
      unitPrice: Number(l.unit_price || 0),
      originalPrice: l.original_price != null ? Number(l.original_price) : Number(l.unit_price || 0),
      priceEdited: !!l.price_edited,
      lineDiscount: Number(l.line_discount || 0),
      lineTotal: Number(l.line_total || 0),
      giftQty: Number(l.gift_qty || 0)
    }))
  };
}

function loadInvoice(id) {
  const row = db.prepare(`
    SELECT i.*, a.name AS account_name FROM invoices i
    LEFT JOIN accounts a ON a.id = i.account_id WHERE i.id = ?
  `).get(id);
  if (!row) return null;
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(id);
  return mapInvoice(row, lines);
}

function createInvoice(data, user) {
  const branchId = data.branchId || user.branchId;
  if (!branchId) throw new Error('الفرع غير محدد');

  const lines = (data.lines || []).filter((l) => l.name && (Number(l.qty) > 0 || Number(l.giftQty) > 0));
  if (!lines.length) throw new Error('أضف منتجاً واحداً على الأقل');

  const kind = ['return', 'issue'].includes(data.kind) ? data.kind : 'sale';
  const sign = kind === 'return' ? -1 : 1;

  let subtotal = 0;
  const normalized = lines.map((l) => {
    const qty = Math.max(0, Number(l.qty || 0));
    const giftQty = Math.max(0, Math.round(Number(l.giftQty || 0)));
    const unitPrice = kind === 'issue' ? 0 : Number(l.unitPrice || 0);
    const lineDiscount = kind === 'issue' ? 0 : Number(l.lineDiscount || 0);
    const lineTotal = kind === 'issue' ? 0 : Math.round(qty * unitPrice - lineDiscount);
    subtotal += lineTotal;
    return { ...l, qty, giftQty, unitPrice, lineDiscount, lineTotal };
  });

  const discount = kind === 'issue' ? 0 : Number(data.discount || 0);
  const total = kind === 'issue' ? 0 : Math.max(0, subtotal - discount);
  let paymentMethod = kind === 'issue' ? 'issue' : (data.paymentMethod || 'cash');
  let paidAmount = kind === 'issue' ? 0 : Number(data.paidAmount ?? (paymentMethod === 'cash' ? total : 0));
  let dueAmount = kind === 'issue' ? 0 : Math.max(0, total - paidAmount);

  if (kind === 'issue') {
    if (!String(data.notes || '').trim()) throw new Error('سبب الإخراج مطلوب في الملاحظات');
    data.accountId = null;
  }

  if ((paymentMethod === 'credit' || paymentMethod === 'partial') && data.accountId) {
    paidAmount = Number(data.paidAmount || 0);
    dueAmount = Math.max(0, total - paidAmount);
  }

  if (paymentMethod === 'partial') {
    if (!data.accountId) throw new Error('اختر حساباً للبيع الجزئي');
    if (paidAmount <= 0 || paidAmount >= total) {
      throw new Error('المبلغ المدفوع جزئياً يجب أن يكون أكبر من صفر وأقل من الإجمالي');
    }
  }

  if (paymentMethod === 'credit' && !data.accountId) {
    throw new Error('اختر حساباً للبيع الآجل');
  }

  if (kind === 'return') {
    paidAmount = 0;
    dueAmount = 0;
    paymentMethod = data.accountId ? 'credit' : 'cash';
  }

  const settings = getBranchSettings(branchId);

  if (kind === 'sale' || kind === 'issue') {
    for (const l of normalized) {
      if (!l.barcode) continue;
      const product = getByBarcode(l.barcode);
      if (!product) throw new Error(`المنتج غير موجود: ${l.name}`);
      const stock = Number(product.stockQty || 0);
      if (settings.blockZeroStock && stock <= 0) {
        throw new Error(`${l.name}: غير متوفر في المخزون`);
      }
      if (settings.blockOverStock && stock > 0) {
        const pieces = l.qty + (l.giftQty || 0);
        if (pieces > stock) {
          throw new Error(`${l.name}: المخزون المتاح ${stock} قطعة فقط`);
        }
      }
    }
  }

  if (data.accountId && dueAmount > 0 && kind === 'sale') {
    const acc = getAccount(data.accountId);
    const limit = Number(acc?.creditLimit || 0);
    const balance = Number(acc?.balance || 0);
    if (limit > 0 && balance + dueAmount > limit) {
      throw new Error(`تجاوز حد الائتمان — الدين الحالي ${balance} والحد ${limit}`);
    }
  }

  const localId = data.localId || null;
  if (localId) {
    const dup = db.prepare('SELECT id FROM invoices WHERE local_id = ?').get(localId);
    if (dup) return loadInvoice(dup.id);
  }

  const invoiceNo = data.invoiceNo || (
    kind === 'return' ? nextReturnNo() : kind === 'issue' ? nextIssueNo() : nextInvoiceNo(branchId)
  );
  const account = data.accountId ? getAccount(data.accountId) : null;
  const customerName = data.customerName || account?.name || '';

  const tx = db.transaction(() => {
    const row = db.prepare(`
      INSERT INTO invoices
        (local_id, invoice_no, branch_id, cashier_id, account_id, customer_name, kind,
         parent_invoice_id, status, subtotal, discount, total, paid_amount, due_amount,
         payment_method, notes, sync_status, invoice_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).get(
      localId, invoiceNo, branchId, user.id, data.accountId || null, customerName, kind,
      data.parentInvoiceId || null, subtotal, discount, total, paidAmount, dueAmount,
      paymentMethod, data.notes || '', data.syncStatus || 'synced',
      data.invoiceDate || new Date().toISOString().slice(0, 10)
    );
    const invoiceId = Number(row.id);
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines
        (invoice_id, product_id, barcode, name, qty, unit_price, line_discount, line_total, original_price, price_edited, gift_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of normalized) {
      const origPrice = Number(l.originalPrice ?? l.unitPrice);
      const edited = l.priceEdited ? 1 : (origPrice !== l.unitPrice ? 1 : 0);
      insertLine.run(
        invoiceId, l.productId || null, l.barcode || '', l.name,
        l.qty, l.unitPrice, l.lineDiscount, l.lineTotal, origPrice, edited, l.giftQty || 0
      );
      if (l.barcode && (kind === 'sale' || kind === 'issue')) {
        adjustStock(l.barcode, -(l.qty + (l.giftQty || 0)));
      } else if (l.barcode && kind === 'return') {
        adjustStock(l.barcode, l.qty + (l.giftQty || 0));
      }
    }

    if (kind === 'return' && data.accountId && total > 0) {
      updateBalance(data.accountId, -total);
      addJournalEntry({
        accountId: data.accountId,
        branchId,
        kind: 'return',
        amount: -total,
        refType: 'invoice',
        refId: invoiceId,
        description: `مرتجع ${invoiceNo} — خصم من الدين`,
        createdBy: user.id
      });
    } else if (kind === 'sale' && data.accountId && dueAmount > 0) {
      updateBalance(data.accountId, dueAmount);
      addJournalEntry({
        accountId: data.accountId,
        branchId,
        kind: 'sale',
        amount: dueAmount,
        refType: 'invoice',
        refId: invoiceId,
        description: `فاتورة ${invoiceNo}`,
        createdBy: user.id
      });
    }

    db.prepare('UPDATE branches SET last_seen_at = datetime(\'now\') WHERE id = ?').run(branchId);
    return invoiceId;
  });

  const invoiceId = tx();
  const invoice = loadInvoice(invoiceId);
  if (process.env.EDARI_SYNC_EVENTS !== '0' && invoice.kind !== 'issue') {
    const acc = invoice.accountId ? getAccount(invoice.accountId) : null;
    const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(invoice.branchId);
    queueInvoiceEdariSync({
      ...invoice,
      edariSeq: acc?.edariSeq || '',
      branchName: branch?.name || ''
    });
  }
  return invoice;
}

function createReturn(parentId, data, user) {
  const parent = loadInvoice(Number(parentId));
  if (!parent) throw new Error('الفاتورة الأصلية غير موجودة');
  if (parent.kind === 'return') throw new Error('لا يمكن إرجاع فاتورة مرتجع');
  if (parent.branchId !== user.branchId && user.role === 'branch') {
    throw new Error('لا تملك صلاحية هذه الفاتورة');
  }

  const requested = (data.lines || []).filter((l) => Number(l.qty) > 0);
  if (!requested.length) throw new Error('حدد بنود المرتجع');

  const parentByBarcode = new Map(parent.lines.map((l) => [l.barcode, l]));
  const returnLines = [];

  for (const req of requested) {
    const orig = parentByBarcode.get(req.barcode);
    if (!orig) throw new Error(`المنتج غير موجود في الفاتورة الأصلية`);
    const already = returnedQtyForLine(parent.id, req.barcode);
    const maxQty = orig.qty + Number(orig.giftQty || 0) - already;
    const qty = Number(req.qty);
    if (qty > maxQty) {
      throw new Error(`الكمية المرتجعة لـ ${orig.name} تتجاوز المتاح (${maxQty})`);
    }
    const paidReturn = Math.min(qty, orig.qty);
    returnLines.push({
      productId: orig.productId,
      barcode: orig.barcode,
      name: orig.name,
      qty: paidReturn,
      giftQty: Math.max(0, qty - paidReturn),
      unitPrice: orig.unitPrice,
      lineTotal: Math.round(paidReturn * orig.unitPrice)
    });
  }

  return createInvoice({
    kind: 'return',
    invoiceNo: nextReturnNo(),
    parentInvoiceId: parent.id,
    accountId: data.accountId != null ? data.accountId : parent.accountId,
    customerName: data.customerName || parent.customerName,
    paymentMethod: (data.accountId != null ? data.accountId : parent.accountId) ? 'credit' : 'cash',
    paidAmount: 0,
    lines: returnLines,
    notes: data.notes || `مرتجع عن ${parent.invoiceNo}`,
    discount: Number(data.discount || 0)
  }, user);
}

function listInvoices({ branchId, dateFrom, dateTo, q, kind, limit = 50, offset = 0 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (branchId) { where.push('i.branch_id = ?'); params.push(branchId); }
  if (dateFrom) { where.push('i.invoice_date >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('i.invoice_date <= ?'); params.push(dateTo); }
  if (kind) { where.push('i.kind = ?'); params.push(kind); }
  if (q) {
    where.push('(i.invoice_no LIKE ? OR i.customer_name LIKE ? OR EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND (l.barcode LIKE ? OR l.name LIKE ?)))');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const sql = `
    SELECT i.*, a.name AS account_name FROM invoices i
    LEFT JOIN accounts a ON a.id = i.account_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.created_at DESC LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM invoices i WHERE ${where.join(' AND ')}
  `).get(...params.slice(0, -2)).c;
  return {
    invoices: rows.map((r) => mapInvoice(r)),
    total
  };
}

function dailySummary({ branchId, date } = {}) {
  const d = date || new Date().toISOString().slice(0, 10);
  const where = ['invoice_date = ?'];
  const params = [d];
  if (branchId) { where.push('branch_id = ?'); params.push(branchId); }
  const sales = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount,
      COALESCE(SUM(paid_amount), 0) AS paid, COALESCE(SUM(due_amount), 0) AS due
    FROM invoices WHERE ${where.join(' AND ')} AND kind = 'sale'
  `).get(...params);
  const returns = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
    FROM invoices WHERE ${where.join(' AND ')} AND kind = 'return'
  `).get(...params);
  return {
    date: d,
    salesCount: sales.count,
    salesAmount: Number(sales.amount),
    paidAmount: Number(sales.paid),
    dueAmount: Number(sales.due),
    returnsCount: returns.count,
    returnsAmount: Number(returns.amount),
    netSales: Number(sales.amount) - Number(returns.amount)
  };
}

function createPayment({ accountId, amount, method, notes, branchId, createdBy, paymentDate }) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('الحساب غير موجود');
  const payAmount = Number(amount);
  if (!payAmount || payAmount <= 0) throw new Error('المبلغ غير صالح');
  const debt = Number(acc.balance || 0);
  if (payAmount > debt) throw new Error(`المبلغ أكبر من الدين الحالي (${debt})`);

  const tx = db.transaction(() => {
    const paymentNo = nextPaymentNo();
    const r = db.prepare(`
      INSERT INTO payments (payment_no, account_id, branch_id, amount, method, notes, created_by, payment_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paymentNo, accountId, branchId || null, payAmount,
      method || 'cash', notes || '', createdBy || null,
      paymentDate || new Date().toISOString().slice(0, 10)
    );
    updateBalance(accountId, -payAmount);
    const updated = getAccount(accountId);
    addJournalEntry({
      accountId,
      branchId,
      kind: 'payment',
      amount: -payAmount,
      refType: 'payment',
      refId: r.lastInsertRowid,
      description: `تسديد ${paymentNo} — ${notes || ''}`.trim(),
      createdBy,
      entryDate: paymentDate
    });
    return {
      id: r.lastInsertRowid,
      paymentNo,
      accountId,
      amount: payAmount,
      method: method || 'cash',
      notes: notes || '',
      paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
      balanceAfter: updated.balance
    };
  });
  const payment = tx();
  if (process.env.EDARI_SYNC_EVENTS !== '0') {
    queuePaymentEdariSync(payment, acc);
  }
  return payment;
}

function listPayments({ accountId, branchId, dateFrom, dateTo, limit = 50 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (accountId) { where.push('p.account_id = ?'); params.push(accountId); }
  if (branchId) { where.push('p.branch_id = ?'); params.push(branchId); }
  if (dateFrom) { where.push('p.payment_date >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('p.payment_date <= ?'); params.push(dateTo); }
  const rows = db.prepare(`
    SELECT p.*, a.name AS account_name, a.code AS account_code
    FROM payments p JOIN accounts a ON a.id = p.account_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC LIMIT ?
  `).all(...params, limit);
  return rows.map((r) => ({
    id: r.id,
    paymentNo: r.payment_no,
    accountId: r.account_id,
    accountName: r.account_name,
    accountCode: r.account_code,
    amount: Number(r.amount),
    method: r.method,
    notes: r.notes,
    paymentDate: r.payment_date,
    createdAt: r.created_at,
    edariJournalSeq: r.edari_journal_seq || '',
    edariSyncStatus: r.edari_sync_status || 'none',
    edariSyncError: r.edari_sync_error || ''
  }));
}

function listJournal({ accountId, limit = 100 } = {}) {
  const where = accountId ? 'WHERE account_id = ?' : '';
  const params = accountId ? [accountId] : [];
  const rows = db.prepare(`
    SELECT * FROM journal_entries ${where} ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit);
  return rows.map((r) => ({
    id: r.id,
    entryNo: r.entry_no,
    accountId: r.account_id,
    kind: r.kind,
    amount: Number(r.amount),
    balanceAfter: r.balance_after != null ? Number(r.balance_after) : null,
    description: r.description,
    entryDate: r.entry_date,
    createdAt: r.created_at
  }));
}

function createAdjustment({ accountId, amount, description, createdBy, branchId }) {
  const delta = Number(amount);
  if (!delta) throw new Error('المبلغ مطلوب');
  const tx = db.transaction(() => {
    updateBalance(accountId, delta);
    addJournalEntry({
      accountId,
      branchId,
      kind: 'adjustment',
      amount: delta,
      refType: 'adjustment',
      description: description || 'قيد تسوية',
      createdBy
    });
    return getAccount(accountId);
  });
  return tx();
}

function salesReport({ branchId, dateFrom, dateTo } = {}) {
  const from = dateFrom || new Date().toISOString().slice(0, 10);
  const to = dateTo || from;
  const where = ['invoice_date >= ?', 'invoice_date <= ?'];
  const params = [from, to];
  if (branchId) { where.push('branch_id = ?'); params.push(branchId); }

  const sales = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount,
      COALESCE(SUM(paid_amount), 0) AS paid, COALESCE(SUM(due_amount), 0) AS due
    FROM invoices WHERE ${where.join(' AND ')} AND kind = 'sale'
  `).get(...params);
  const returns = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
    FROM invoices WHERE ${where.join(' AND ')} AND kind = 'return'
  `).get(...params);

  const byPayment = db.prepare(`
    SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
    FROM invoices WHERE ${where.join(' AND ')} AND kind = 'sale'
    GROUP BY payment_method
  `).all(...params);

  const topProducts = db.prepare(`
    SELECT l.barcode, l.name, SUM(l.qty) AS qty, SUM(l.line_total) AS amount
    FROM invoice_lines l
    JOIN invoices i ON i.id = l.invoice_id
    WHERE i.invoice_date >= ? AND i.invoice_date <= ?
    ${branchId ? 'AND i.branch_id = ?' : ''}
    AND i.kind = 'sale'
    GROUP BY l.barcode, l.name
    ORDER BY amount DESC LIMIT 10
  `).all(...(branchId ? [from, to, branchId] : [from, to]));

  const payments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM payments WHERE payment_date >= ? AND payment_date <= ?
    ${branchId ? 'AND branch_id = ?' : ''}
  `).get(...(branchId ? [from, to, branchId] : [from, to]));

  return {
    dateFrom: from,
    dateTo: to,
    salesCount: sales.count,
    salesAmount: Number(sales.amount),
    paidAmount: Number(sales.paid),
    dueAmount: Number(sales.due),
    returnsCount: returns.count,
    returnsAmount: Number(returns.amount),
    netSales: Number(sales.amount) - Number(returns.amount),
    byPayment: byPayment.map((r) => ({
      method: r.method,
      count: r.count,
      amount: Number(r.amount)
    })),
    topProducts: topProducts.map((r) => ({
      barcode: r.barcode,
      name: r.name,
      qty: Number(r.qty),
      amount: Number(r.amount)
    })),
    collectionsTotal: Number(payments.total),
    collectionsCount: payments.count
  };
}

module.exports = {
  loadInvoice,
  createInvoice,
  createReturn,
  listInvoices,
  dailySummary,
  createPayment,
  listPayments,
  listJournal,
  createAdjustment,
  addJournalEntry,
  salesReport
};
