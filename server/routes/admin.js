const express = require('express');
const { authRequired } = require('../lib/auth');
const { listProducts, upsertProduct, bulkUpsert, stats, getByBarcode, getProduct, deactivateProduct } = require('../lib/products');
const { resolveEdariMaterial, cacheEdariMaterial, mapEdariToShorjaProduct } = require('../lib/edari-materials');
const { listInvoices, loadInvoice, dailySummary, createPayment, listPayments, listJournal, createAdjustment } = require('../lib/invoices');
const { listAccounts, createAccount, getAccount, accountStats, resolveInvoiceDebtInfo } = require('../lib/accounts');
const { getEdariParentInfo } = require('../lib/edari-accounts');
const { listPendingSync, listPendingSyncEnriched, processEdariQueue, syncAccountToEdari, syncQueueStats } = require('../lib/edari-sync');
const { isManualSyncOnlyMode } = require('../lib/edari-safety');
const { canWriteEdari } = require('../lib/edari-bridge');
const { publishPricePackage, listPackages, getLatestVersion } = require('../lib/prices');
const { parseProductsCsv, invoicePrintHtml } = require('../lib/export');
const db = require('../db');

const router = express.Router();
router.use(authRequired(['admin']));

router.get('/dashboard', (req, res) => {
  const today = dailySummary({});
  const products = stats();
  const accounts = accountStats();
  const branches = db.prepare('SELECT id, code, name, last_seen_at, price_version FROM branches').all();
  const pendingSync = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE sync_status = 'pending'`).get().c;
  const edariSync = syncQueueStats();
  res.json({
    ok: true,
    today,
    products,
    accounts,
    branches,
    pendingSync,
    edariSync,
    priceVersion: getLatestVersion()
  });
});

router.get('/products', (req, res) => {
  res.json({ ok: true, ...listProducts({
    q: req.query.q,
    category: req.query.category,
    limit: Number(req.query.limit) || 100,
    activeOnly: req.query.all !== '1'
  }) });
});

router.post('/products', (req, res) => {
  try {
    const product = upsertProduct(req.body || {});
    res.json({ ok: true, product });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/products/barcode/:code', (req, res) => {
  const product = getByBarcode(req.params.code);
  if (!product) return res.status(404).json({ ok: false, error: 'المنتج غير موجود' });
  res.json({ ok: true, product });
});

router.get('/products/edari-lookup', async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: 'الباركود مطلوب' });
  try {
    const material = await resolveEdariMaterial(code);
    if (!material) {
      return res.status(404).json({ ok: false, error: 'المادة غير موجودة في الإداري (Edari)' });
    }
    const product = mapEdariToShorjaProduct(material);
    res.json({ ok: true, material, product });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'فشل جلب المادة من الإداري' });
  }
});

router.post('/products/edari-cache', (req, res) => {
  try {
    const material = cacheEdariMaterial(req.body?.material || req.body);
    if (!material) {
      return res.status(400).json({ ok: false, error: 'بيانات المادة غير كافية' });
    }
    res.json({ ok: true, material, product: mapEdariToShorjaProduct(material) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/products/from-edari', async (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.barcode || body.code || '').trim();
    if (!code) return res.status(400).json({ ok: false, error: 'الباركود مطلوب' });
    const material = body.material
      ? cacheEdariMaterial(body.material)
      : await resolveEdariMaterial(code);
    if (!material) {
      return res.status(404).json({ ok: false, error: 'المادة غير موجودة في الإداري (Edari)' });
    }
    const payload = mapEdariToShorjaProduct(material);
    const product = upsertProduct({
      ...payload,
      category: body.category || payload.category || '',
      unit: body.unit || payload.unit || 'قطعة',
      costPrice: body.costPrice != null ? Number(body.costPrice) : payload.costPrice,
      price: body.price != null ? Number(body.price) : payload.price,
      stockQty: body.stockQty != null ? Number(body.stockQty) : payload.stockQty
    });
    res.json({ ok: true, material, product });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/products/:id', (req, res) => {
  try {
    const product = deactivateProduct(Number(req.params.id));
    res.json({ ok: true, product });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

function mapProductForPackage(p) {
  return {
    barcode: p.barcode,
    name: p.name,
    unit: p.unit,
    price: p.price,
    costPrice: p.costPrice,
    stockQty: p.stockQty,
    category: p.category,
    hasOffer: p.hasOffer,
    offerName: p.offerName,
    originalPrice: p.originalPrice
  };
}

router.post('/prices/publish', (req, res) => {
  try {
    let items = [];
    const missing = [];

    if (Array.isArray(req.body?.items) && req.body.items.length) {
      items = req.body.items.map(mapProductForPackage);
    } else if (Array.isArray(req.body?.barcodes) && req.body.barcodes.length) {
      for (const code of req.body.barcodes) {
        const p = getByBarcode(String(code).trim());
        if (!p) missing.push(String(code).trim());
        else items.push(mapProductForPackage(p));
      }
      if (!items.length) {
        return res.status(400).json({ ok: false, error: 'لا توجد منتجات مطابقة للباركود المحدد' });
      }
    } else {
      return res.status(400).json({ ok: false, error: 'حدد منتجات بالباركود للرفع' });
    }

    const result = publishPricePackage({
      items,
      branchId: req.body?.branchId || null,
      note: req.body?.note || ''
    });
    res.json({ ok: true, ...result, missing });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/products/bulk', (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const count = bulkUpsert(items);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/products/import', (req, res) => {
  try {
    let items = [];
    if (Array.isArray(req.body?.items)) items = req.body.items;
    else if (req.body?.csv) items = parseProductsCsv(req.body.csv);
    if (!items.length) return res.status(400).json({ ok: false, error: 'لا توجد منتجات للاستيراد' });
    const count = bulkUpsert(items);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/prices/packages', (_req, res) => {
  res.json({ ok: true, packages: listPackages() });
});

router.get('/invoices', (req, res) => {
  res.json({
    ok: true,
    ...listInvoices({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      dateFrom: req.query.from,
      dateTo: req.query.to,
      q: req.query.q,
      limit: Number(req.query.limit) || 100
    })
  });
});

router.get('/invoices/:id', (req, res) => {
  const invoice = loadInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).json({ ok: false, error: 'غير موجود' });
  res.json({ ok: true, invoice });
});

router.get('/invoices/:id/print', (req, res) => {
  const invoice = loadInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).send('غير موجود');
  const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(invoice.branchId);
  const thermal = req.query.thermal === '1';
  const debtInfo = resolveInvoiceDebtInfo(invoice);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(invoicePrintHtml(invoice, branch?.name || '', { thermal, debtInfo }));
});

router.get('/accounts', (req, res) => {
  res.json({ ok: true, ...listAccounts({
    q: req.query.q,
    hasDebt: req.query.debt === '1'
  }) });
});

router.post('/accounts', async (req, res) => {
  try {
    const account = await createAccount(req.body || {});
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/edari/parent', async (_req, res) => {
  const info = await getEdariParentInfo();
  res.json({ ok: info.ok, parent: info.parent, error: info.error, canWrite: canWriteEdari() });
});

router.get('/edari/sync-queue', (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const kinds = req.query.kinds
    ? String(req.query.kinds).split(',').map((k) => k.trim()).filter(Boolean)
    : null;
  res.json({
    ok: true,
    stats: syncQueueStats(),
    items: listPendingSyncEnriched(limit, { kinds }),
    manualSyncOnly: isManualSyncOnlyMode(),
    canWrite: canWriteEdari()
  });
});

router.post('/edari/sync-queue/process', async (req, res) => {
  try {
    const limit = Math.min(100, Number(req.body?.limit) || 20);
    const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds : null;
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : null;
    const out = await processEdariQueue(limit, { kinds, itemIds });
    res.json({ ok: true, ...out, canWrite: canWriteEdari() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/accounts/:id/sync-edari', async (req, res) => {
  try {
    const account = getAccount(Number(req.params.id));
    if (!account) return res.status(404).json({ ok: false, error: 'غير موجود' });
    const result = await syncAccountToEdari(account, req.body || {});
    res.json({ ok: true, account: getAccount(account.id), result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/accounts/:id', (req, res) => {
  const account = getAccount(Number(req.params.id));
  if (!account) return res.status(404).json({ ok: false, error: 'غير موجود' });
  const journal = listJournal({ accountId: account.id });
  const payments = listPayments({ accountId: account.id });
  res.json({ ok: true, account, journal, payments });
});

router.post('/payments', (req, res) => {
  try {
    const payment = createPayment({
      ...req.body,
      createdBy: req.user.id,
      branchId: req.body.branchId || null
    });
    res.json({ ok: true, payment });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/payments', (req, res) => {
  res.json({ ok: true, payments: listPayments({
    accountId: req.query.accountId ? Number(req.query.accountId) : null,
    branchId: req.query.branchId ? Number(req.query.branchId) : null,
    dateFrom: req.query.from,
    dateTo: req.query.to
  }) });
});

router.post('/journal/adjustment', (req, res) => {
  try {
    const account = createAdjustment({
      accountId: req.body.accountId,
      amount: req.body.amount,
      description: req.body.description,
      createdBy: req.user.id,
      branchId: req.body.branchId
    });
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/journal', (req, res) => {
  res.json({
    ok: true,
    entries: listJournal({
      accountId: req.query.accountId ? Number(req.query.accountId) : null,
      limit: Number(req.query.limit) || 200
    })
  });
});

router.get('/branches', (_req, res) => {
  const branches = db.prepare('SELECT * FROM branches ORDER BY id').all().map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    isActive: !!b.is_active,
    lastSeenAt: b.last_seen_at,
    priceVersion: b.price_version
  }));
  res.json({ ok: true, branches });
});

module.exports = router;
