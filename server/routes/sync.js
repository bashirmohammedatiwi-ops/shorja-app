const express = require('express');
const { authSyncKey } = require('../lib/auth');
const { createInvoice } = require('../lib/invoices');
const { checkPriceUpdate } = require('../lib/prices');
const { listPendingSync, completeAccountSyncFromRemote } = require('../lib/edari-sync');
const db = require('../db');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'shorja-hub', time: new Date().toISOString() });
});

router.post('/invoices/batch', authSyncKey, (req, res) => {
  try {
    const invoices = Array.isArray(req.body?.invoices) ? req.body.invoices : [];
    const results = [];
    for (const inv of invoices) {
      const user = {
        id: inv.cashierId || 0,
        branchId: inv.branchId
      };
      const saved = createInvoice({ ...inv, syncStatus: 'synced' }, user);
      results.push({ localId: inv.localId, id: saved.id, invoiceNo: saved.invoiceNo, ok: true });
    }
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/price-update/:branchId', authSyncKey, (req, res) => {
  const branchId = Number(req.params.branchId);
  const current = Number(req.query.version || 0);
  res.json({ ok: true, ...checkPriceUpdate(branchId, current) });
});

router.post('/heartbeat/:branchId', authSyncKey, (req, res) => {
  const branchId = Number(req.params.branchId);
  db.prepare('UPDATE branches SET last_seen_at = datetime(\'now\') WHERE id = ?').run(branchId);
  res.json({ ok: true });
});

router.get('/edari/queue', authSyncKey, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json({ ok: true, items: listPendingSync(limit) });
});

router.post('/edari/queue/:id/complete', authSyncKey, (req, res) => {
  try {
    const result = completeAccountSyncFromRemote(Number(req.params.id), req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
