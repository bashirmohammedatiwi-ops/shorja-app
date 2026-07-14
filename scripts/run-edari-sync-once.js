#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { runEdariSyncWorker, logSync } = require('../server/lib/edari-sync-worker');
const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');

process.env.EDARI_WRITE_ENABLED = process.env.EDARI_WRITE_ENABLED || '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = process.env.EDARI_WRITE_VIA_NXSCRIPT || '1';

const serverJsonPaths = [
  path.join(__dirname, '..', 'desktop-admin', 'server.json')
];

(async () => {
  ensureExecuteScriptDeployed();
  const { createEdariCustomerAccount } = require('../server/lib/edari-accounts');
  const { createEdariInvoice, createEdariPayment } = require('../server/lib/edari-invoices');
  const { canWriteEdari } = require('../server/lib/edari-bridge');
  const result = await runEdariSyncWorker({
    handlers: {
      account: createEdariCustomerAccount,
      invoice: createEdariInvoice,
      payment: createEdariPayment
    },
    canWriteEdari,
    serverJsonPaths
  });
  if (result.skipped) {
    logSync('تخطي المزامنة', result.reason);
    process.exit(result.reason === 'not_windows' ? 0 : 1);
  }
  if (result.processed > 0) {
    logSync('انتهت المزامنة', { processed: result.processed });
  }
  const failed = (result.results || []).filter((r) => r.ok === false);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  logSync('فشل معالج المزامنة', err.message);
  process.exit(1);
});
