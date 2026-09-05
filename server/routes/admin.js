const express = require('express');
const { authRequired } = require('../lib/auth');
const { listProducts, upsertProduct, upsertCatalogProduct, bulkUpsert, stats, getByBarcode, getProduct, deactivateProduct } = require('../lib/products');
const { resolveEdariMaterial, cacheEdariMaterial, mapEdariToShorjaProduct } = require('../lib/edari-materials');
const { importEdariProductsBatch, importAllEdariProducts } = require('../lib/edari-product-import');
const { countEdariMaterials } = require('../lib/edari-lookup');
const { listInvoices, loadInvoice, dailySummary, createPayment, listPayments, listJournal, createAdjustment, salesReport } = require('../lib/invoices');
const { listAccounts, createAccount, updateAccount, getAccount, accountStats, resolveInvoiceDebtInfo } = require('../lib/accounts');
const { getEdariParentInfo } = require('../lib/edari-accounts');
const { listPendingSync, listPendingSyncEnriched, processEdariQueue, syncAccountToEdari, syncQueueStats, resetSyncItemsForRetry } = require('../lib/edari-sync');
const { listDelegateInvoices, listWarehousePrepInvoices, delegateInvoiceStats, warehousePrepStats, queueInvoiceForEdari, DELEGATE_BRANCH_CODE } = require('../lib/delegate-processed');
const { isManualSyncOnlyMode } = require('../lib/edari-safety');
const { canWriteEdari } = require('../lib/edari-bridge');
const { resetBusinessData, snapshotCounts } = require('../lib/reset-business-data');
const { publishPricePackage, listPackages, getLatestVersion } = require('../lib/prices');
const { parseProductsCsv, invoicePrintHtml } = require('../lib/export');
const { deleteInvoiceById, deletePaymentById, deleteAccountById, deleteJournalEntryById } = require('../lib/deletions');
const { getDataRevision } = require('../lib/data-revision');
const { getPosMonitor } = require('../lib/pos-monitor');
const { getAppSettings, saveAppSettings } = require('../lib/app-settings');
const db = require('../db');

const router = express.Router();
router.use(authRequired(['admin']));

router.get('/dashboard', (req, res) => {
  const today = dailySummary({});
  const products = stats();
  const accounts = accountStats();
  const accountsWarehouse = accountStats({ scope: 'warehouse' });
  const accountsDelegate = accountStats({ scope: 'delegate' });
  const branches = db.prepare(`
    SELECT id, code, name, last_seen_at, price_version
    FROM branches
    WHERE code != ?
    ORDER BY id
  `).all(DELEGATE_BRANCH_CODE);
  const pendingSync = db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE sync_status = 'pending'`).get().c;
  const edariSync = syncQueueStats();
  const edariSyncWarehouse = syncQueueStats({ scope: 'warehouse' });
  const edariSyncDelegate = syncQueueStats({ scope: 'delegate' });
  const warehousePrep = warehousePrepStats();
  const delegatePrep = delegateInvoiceStats();
  const lowStock = db.prepare(`
    SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock_qty <= 5
  `).get().c;
  res.json({
    ok: true,
    today,
    products,
    accounts,
    accountsWarehouse,
    accountsDelegate,
    branches,
    pendingSync,
    edariSync,
    edariSyncWarehouse,
    edariSyncDelegate,
    warehousePrep,
    delegatePrep,
    lowStock: Number(lowStock),
    priceVersion: getLatestVersion(),
    appSettings: getAppSettings()
  });
});

router.get('/app-settings', (_req, res) => {
  res.json({ ok: true, settings: getAppSettings() });
});

router.put('/app-settings', (req, res) => {
  try {
    const settings = saveAppSettings(req.body || {});
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/reports/sales', (req, res) => {
  res.json({
    ok: true,
    report: salesReport({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      dateFrom: req.query.from,
      dateTo: req.query.to
    })
  });
});

router.get('/products', (req, res) => {
  res.json({ ok: true, ...listProducts({
    q: req.query.q,
    category: req.query.category,
    limit: Number(req.query.limit) || 100,
    activeOnly: req.query.all !== '1',
    stockFilter: ['all', 'in', 'low', 'out'].includes(String(req.query.stock || '')) ? req.query.stock : 'all',
    lowThreshold: Number(req.query.threshold) || 5
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
    const product = upsertCatalogProduct({
      ...payload,
      category: body.category || payload.category || '',
      unit: body.unit || payload.unit || 'قطعة',
      stockQty: body.stockQty != null ? Number(body.stockQty) : payload.stockQty
    });
    const hasManualPrice = Number(body.price) > 0;
    const saved = hasManualPrice
      ? upsertProduct({
        ...product,
        ...payload,
        category: body.category || product.category || '',
        unit: body.unit || product.unit || 'قطعة',
        costPrice: body.costPrice != null ? Number(body.costPrice) : product.costPrice,
        price: Number(body.price),
        priceCurrency: body.priceCurrency || product.priceCurrency,
        stockQty: body.stockQty != null ? Number(body.stockQty) : product.stockQty
      })
      : product;
    res.json({ ok: true, material, product: saved });
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
    originalPrice: p.originalPrice,
    priceCurrency: p.priceCurrency || 'iqd',
    priced: !!p.priced
  };
}

router.post('/prices/publish', (req, res) => {
  try {
    let items = [];
    const missing = [];

    if (req.body?.all === true || req.body?.all === 1 || req.body?.all === '1') {
      items = listProducts({ limit: 500000, activeOnly: true }).products.map(mapProductForPackage);
      if (!items.length) {
        return res.status(400).json({ ok: false, error: 'لا توجد منتجات للرفع' });
      }
    } else if (Array.isArray(req.body?.items) && req.body.items.length) {
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

router.get('/products/edari-import/status', async (_req, res) => {
  try {
    const totalInEdari = await countEdariMaterials();
    const local = stats();
    res.json({
      ok: true,
      totalInEdari,
      localProducts: local.total,
      priceMode: 'half_wholesale',
      requiresWindows: true
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Edari غير متاح' });
  }
});

router.post('/products/import-edari-batch', async (req, res) => {
  try {
    const afterSeq = Number(req.body?.afterSeq || 0);
    const limit = Number(req.body?.limit || 500);
    const result = await importEdariProductsBatch({ afterSeq, limit });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'فشل استيراد الدفعة' });
  }
});

router.post('/products/import-edari-all', async (req, res) => {
  try {
    const batchSize = Number(req.body?.batchSize || 500);
    const publish = req.body?.publish === true || req.body?.publish === 1 || req.body?.publish === '1';
    const maxBatches = Number(req.body?.maxBatches || 0);
    const result = await importAllEdariProducts({
      batchSize,
      maxBatches,
      publish,
      publishNote: req.body?.note || 'استيراد كامل من الإداري — بدون أسعار بيع'
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'فشل الاستيراد من الإداري' });
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
      kind: req.query.kind || '',
      paymentMethod: req.query.payment || '',
      edariStatus: req.query.edari || '',
      limit: Number(req.query.limit) || 100,
      excludePrepModes: ['delegate']
    })
  });
});

router.get('/pos-monitor', (req, res) => {
  res.json({
    ok: true,
    monitor: getPosMonitor({
      branchId: req.query.branchId ? Number(req.query.branchId) : null,
      limit: Number(req.query.limit) || 50,
      q: String(req.query.q || '').trim(),
      kind: req.query.kind || '',
      paymentMethod: req.query.payment || '',
      edariStatus: req.query.edari || '',
      todayOnly: req.query.allDates !== '1'
    }),
    revision: getDataRevision()
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

router.delete('/invoices/:id', (req, res) => {
  try {
    const result = deleteInvoiceById(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/delegate-invoices', (req, res) => {
  res.json({
    ok: true,
    stats: delegateInvoiceStats(),
    ...listDelegateInvoices({
      q: req.query.q,
      dateFrom: req.query.from,
      dateTo: req.query.to,
      limit: Number(req.query.limit) || 100
    })
  });
});

router.get('/warehouse-prep-invoices', (req, res) => {
  res.json({
    ok: true,
    stats: warehousePrepStats(),
    ...listWarehousePrepInvoices({
      q: req.query.q,
      dateFrom: req.query.from,
      dateTo: req.query.to,
      limit: Number(req.query.limit) || 100
    })
  });
});

router.post('/delegate-invoices/:id/queue-edari', (req, res) => {
  try {
    const invoice = loadInvoice(Number(req.params.id));
    if (!invoice) return res.status(404).json({ ok: false, error: 'الفاتورة غير موجودة' });
    if (invoice.prepStatus !== 'processing') {
      return res.status(400).json({ ok: false, error: 'الفاتورة ليست في حالة تجهيز مكتمل' });
    }
    if (invoice.edariSyncStatus === 'synced' && invoice.edariBillSeq) {
      return res.json({ ok: true, invoice, message: 'الفاتورة مرحّلة مسبقاً' });
    }
    queueInvoiceForEdari(invoice.id);
    res.json({ ok: true, invoice: loadInvoice(invoice.id) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/accounts', (req, res) => {
  const scope = String(req.query.scope || '').trim();
  const edariStatus = String(req.query.edariStatus || '').trim();
  res.json({ ok: true, ...listAccounts({
    q: req.query.q,
    hasDebt: req.query.debt === '1',
    scope: scope === 'warehouse' || scope === 'delegate' ? scope : '',
    edariStatus: ['pending', 'synced', 'error'].includes(edariStatus) ? edariStatus : ''
  }) });
});

router.post('/accounts', async (req, res) => {
  try {
    const body = req.body || {};
    const account = await createAccount({
      ...body,
      accountScope: body.accountScope === 'delegate' ? 'delegate' : 'warehouse'
    });
    res.json({ ok: true, account });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  try {
    const account = await updateAccount(Number(req.params.id), req.body || {});
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
  const scope = String(req.query.scope || '').trim();
  const scoped = scope === 'warehouse' || scope === 'delegate' ? scope : 'warehouse';
  const kinds = req.query.kinds
    ? String(req.query.kinds).split(',').map((k) => k.trim()).filter(Boolean)
    : null;
  res.json({
    ok: true,
    scope: scoped,
    stats: syncQueueStats({ scope: scoped }),
    items: listPendingSyncEnriched(limit, { kinds, scope: scoped }),
    manualSyncOnly: isManualSyncOnlyMode(),
    canWrite: canWriteEdari()
  });
});

router.post('/edari/sync-queue/retry', (req, res) => {
  const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : null;
  const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds : null;
  const scope = String(req.body?.scope || req.query?.scope || '').trim();
  const scoped = scope === 'warehouse' || scope === 'delegate' ? scope : 'warehouse';
  const reset = resetSyncItemsForRetry({ itemIds, kinds });
  res.json({ ok: true, reset, stats: syncQueueStats({ scope: scoped }) });
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

router.delete('/accounts/:id', (req, res) => {
  try {
    const result = deleteAccountById(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
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
  const scope = String(req.query.scope || '').trim();
  res.json({ ok: true, payments: listPayments({
    accountId: req.query.accountId ? Number(req.query.accountId) : null,
    branchId: req.query.branchId ? Number(req.query.branchId) : null,
    dateFrom: req.query.from,
    dateTo: req.query.to,
    accountScope: scope === 'warehouse' || scope === 'delegate' ? scope : '',
    limit: Math.min(Number(req.query.limit) || 300, 1000)
  }) });
});

router.delete('/payments/:id', (req, res) => {
  try {
    const result = deletePaymentById(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
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
  const scope = String(req.query.scope || '').trim();
  res.json({
    ok: true,
    entries: listJournal({
      accountId: req.query.accountId ? Number(req.query.accountId) : null,
      accountScope: scope === 'warehouse' || scope === 'delegate' ? scope : '',
      dateFrom: req.query.from || '',
      dateTo: req.query.to || '',
      limit: Math.min(Number(req.query.limit) || 400, 1000)
    })
  });
});

router.delete('/journal/:id', (req, res) => {
  try {
    const result = deleteJournalEntryById(Number(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/data-revision', (_req, res) => {
  res.json({ ok: true, revision: getDataRevision() });
});

router.get('/branches', (req, res) => {
  const scope = String(req.query.scope || 'pos').trim();
  let sql = 'SELECT * FROM branches';
  const params = [];
  if (scope === 'pos') {
    sql += ' WHERE code != ?';
    params.push(DELEGATE_BRANCH_CODE);
  } else if (scope === 'delegate') {
    sql += ' WHERE code = ?';
    params.push(DELEGATE_BRANCH_CODE);
  }
  sql += ' ORDER BY id';
  const branches = db.prepare(sql).all(...params).map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    isActive: !!b.is_active,
    lastSeenAt: b.last_seen_at,
    priceVersion: b.price_version
  }));
  res.json({ ok: true, branches });
});

router.get('/system/reset/preview', (_req, res) => {
  res.json({ ok: true, counts: snapshotCounts() });
});

router.post('/system/reset', (req, res) => {
  try {
    const confirm = String(req.body?.confirm || '').trim();
    if (confirm !== 'RESET') {
      return res.status(400).json({
        ok: false,
        error: 'أرسل confirm: "RESET" لتأكيد مسح بيانات العمل'
      });
    }
    const includeProducts = req.body?.includeProducts !== false;
    const result = resetBusinessData({ includeProducts });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
