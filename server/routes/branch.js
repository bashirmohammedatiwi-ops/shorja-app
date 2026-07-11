const express = require('express');
const { authRequired } = require('../lib/auth');
const { listProducts, getByBarcode, categories, listLowStock, stockSummary } = require('../lib/products');
const { createInvoice, listInvoices, loadInvoice, dailySummary, createPayment, listPayments, createReturn, salesReport } = require('../lib/invoices');
const { listAccounts, getAccount, createAccount } = require('../lib/accounts');
const { checkPriceUpdate, applyPricePackage } = require('../lib/prices');
const { invoicePrintHtml } = require('../lib/export');
const { getBranchSettings, saveBranchSettings } = require('../lib/settings');
const db = require('../db');

const router = express.Router();
router.use(authRequired(['branch', 'admin']));

router.get('/products', (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const syncAll = req.query.sync === '1' || req.query.all === '1';
  const limit = syncAll
    ? Math.min(Number(req.query.limit) || 500, 5000)
    : Math.min(Number(req.query.limit) || 80, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const settings = getBranchSettings(req.user.branchId);
  const stockFilter = String(req.query.stock || 'all').trim();
  const sort = String(req.query.sort || 'name').trim();
  const lowThreshold = Number(req.query.threshold) || settings.lowStockThreshold || 5;
  const result = listProducts({
    q,
    category,
    limit,
    offset,
    stockFilter: ['all', 'in', 'low', 'out'].includes(stockFilter) ? stockFilter : 'all',
    lowThreshold,
    sort
  });
  const payload = { ok: true, ...result };
  if (req.query.summary === '1') {
    payload.summary = stockSummary(lowThreshold);
  }
  res.json(payload);
});

router.get('/products/barcode/:code', (req, res) => {
  const product = getByBarcode(req.params.code);
  if (!product) return res.status(404).json({ ok: false, error: 'المنتج غير موجود' });
  res.json({ ok: true, product });
});

router.get('/products/low-stock', (req, res) => {
  const settings = getBranchSettings(req.user.branchId);
  const threshold = Number(req.query.threshold) || settings.lowStockThreshold || 5;
  res.json({ ok: true, products: listLowStock(threshold), threshold });
});

router.get('/categories', (_req, res) => {
  res.json({ ok: true, categories: categories() });
});

router.get('/accounts', (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json({ ok: true, ...listAccounts({ q, hasDebt: req.query.debt === '1' }) });
});

router.post('/accounts', (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.name || '').trim()) {
      return res.status(400).json({ ok: false, error: 'اسم الحساب مطلوب' });
    }
    const account = createAccount({
      name: String(body.name).trim(),
      phone: body.phone || '',
      address: body.address || '',
      creditLimit: Number(body.creditLimit || 0),
      notes: body.notes || ''
    });
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/accounts/:id', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
  res.json({ ok: true, account });
});

router.get('/accounts/:id/ledger', (req, res) => {
  const { listJournal } = require('../lib/invoices');
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).json({ ok: false, error: 'الحساب غير موجود' });
  res.json({
    ok: true,
    account,
    journal: listJournal({ accountId: account.id, limit: 80 }),
    payments: listPayments({ accountId: account.id, limit: 30 })
  });
});

router.post('/invoices', (req, res) => {
  try {
    const invoice = createInvoice(req.body || {}, req.user);
    res.json({ ok: true, invoice });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/invoices', (req, res) => {
  const branchId = req.user.branchId || Number(req.query.branchId) || null;
  res.json({
    ok: true,
    ...listInvoices({
      branchId,
      dateFrom: req.query.from,
      dateTo: req.query.to,
      q: req.query.q,
      kind: req.query.kind,
      limit: Number(req.query.limit) || 50
    })
  });
});

router.get('/invoices/:id', (req, res) => {
  const invoice = loadInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).json({ ok: false, error: 'الفاتورة غير موجودة' });
  if (req.user.role === 'branch' && invoice.branchId !== req.user.branchId) {
    return res.status(403).json({ ok: false, error: 'لا تملك صلاحية هذه الفاتورة' });
  }
  res.json({ ok: true, invoice });
});

router.get('/invoices/:id/print', (req, res) => {
  const invoice = loadInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).send('غير موجود');
  if (req.user.role === 'branch' && invoice.branchId !== req.user.branchId) {
    return res.status(403).send('غير مصرح');
  }
  const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(invoice.branchId);
  const settings = getBranchSettings(invoice.branchId);
  const thermal = req.query.thermal === '1' || settings.thermalPrint;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(invoicePrintHtml(invoice, branch?.name || '', { thermal, footer: settings.receiptFooter }));
});

router.post('/invoices/:id/return', (req, res) => {
  try {
    const invoice = createReturn(Number(req.params.id), req.body || {}, req.user);
    res.json({ ok: true, invoice });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/prices/apply', (req, res) => {
  try {
    const version = Number(req.body?.version);
    if (!version) return res.status(400).json({ ok: false, error: 'رقم الإصدار مطلوب' });
    const result = applyPricePackage(req.user.branchId, version);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/summary/today', (req, res) => {
  const branchId = req.user.branchId || Number(req.query.branchId) || null;
  res.json({ ok: true, summary: dailySummary({ branchId }) });
});

router.get('/reports/sales', (req, res) => {
  const branchId = req.user.branchId || Number(req.query.branchId) || null;
  res.json({
    ok: true,
    report: salesReport({
      branchId,
      dateFrom: req.query.from,
      dateTo: req.query.to
    })
  });
});

router.get('/settings', (req, res) => {
  res.json({ ok: true, settings: getBranchSettings(req.user.branchId) });
});

router.put('/settings', (req, res) => {
  try {
    const settings = saveBranchSettings(req.user.branchId, req.body || {});
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/price-update', (req, res) => {
  const branchId = req.user.branchId;
  const current = Number(req.query.version || 0);
  res.json({ ok: true, ...checkPriceUpdate(branchId, current) });
});

router.post('/payments', (req, res) => {
  try {
    const payment = createPayment({
      ...req.body,
      createdBy: req.user.id,
      branchId: req.user.branchId
    });
    res.json({ ok: true, payment });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/payments', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    ok: true,
    payments: listPayments({
      branchId: req.user.branchId,
      dateFrom: req.query.from || today,
      dateTo: req.query.to || today,
      limit: Number(req.query.limit) || 50
    })
  });
});

router.post('/heartbeat', (req, res) => {
  if (req.user.branchId) {
    db.prepare('UPDATE branches SET last_seen_at = datetime(\'now\') WHERE id = ?')
      .run(req.user.branchId);
  }
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
