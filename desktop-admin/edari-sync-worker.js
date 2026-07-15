const fs = require('fs');
const path = require('path');
const { registerEdariModulePaths } = require('./edari-module-paths');

registerEdariModulePaths(require('electron').app);

function getCoreSyncWorkerPath() {
  const { app } = require('electron');
  const packaged = path.join(process.resourcesPath, 'edari', 'edari-sync-worker.js');
  if (app?.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'server', 'lib', 'edari-sync-worker.js');
}

const { runEdariSyncWorker } = require(getCoreSyncWorkerPath());

function getServerJsonPaths() {
  const { app } = require('electron');
  const paths = [path.join(__dirname, 'server.json')];
  if (app?.isPackaged) {
    paths.unshift(path.join(path.dirname(app.getPath('exe')), 'server.json'));
  }
  return paths;
}

function getEdariLibPath(name) {
  const { app } = require('electron');
  const packaged = path.join(process.resourcesPath, 'edari', name);
  if (app?.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'server', 'lib', name);
}

function loadPackagedHandlers() {
  const accountsPath = getEdariLibPath('edari-accounts.js');
  const invoicesPath = getEdariLibPath('edari-invoices.js');
  return {
    account: require(accountsPath).createEdariCustomerAccount,
    invoice: require(invoicesPath).createEdariInvoice,
    payment: require(invoicesPath).createEdariPayment
  };
}

const SYNC_HANDLERS = { account: null, invoice: null, payment: null };

function loadHandlers() {
  if (!SYNC_HANDLERS.account) {
    if (require('electron').app?.isPackaged) {
      Object.assign(SYNC_HANDLERS, loadPackagedHandlers());
    } else {
      const accounts = require('../server/lib/edari-accounts');
      const invoices = require('../server/lib/edari-invoices');
      SYNC_HANDLERS.account = accounts.createEdariCustomerAccount;
      SYNC_HANDLERS.invoice = invoices.createEdariInvoice;
      SYNC_HANDLERS.payment = invoices.createEdariPayment;
    }
  }
  return SYNC_HANDLERS;
}

function loadSafetyAndPostWrite() {
  const safetyPath = getEdariLibPath('edari-safety.js');
  const postPath = getEdariLibPath('edari-post-write.js');
  return {
    ...require(safetyPath),
    prepareEdariWriteSession: require(postPath).prepareEdariWriteSession,
    finalizeEdariWriteSession: require(postPath).finalizeEdariWriteSession,
    tablesForSessionKinds: require(postPath).tablesForSessionKinds
  };
}

async function runEdariSyncWorkerDesktop(options = {}) {
  const safety = loadSafetyAndPostWrite();
  const bridgePath = getEdariLibPath('edari-bridge.js');
  const { canWriteEdari } = require(bridgePath);
  const handlers = loadHandlers();

  return runEdariSyncWorker({
    handlers,
    canWriteEdari,
    beginManualEdariSyncSession: safety.beginManualEdariSyncSession,
    endManualEdariSyncSession: safety.endManualEdariSyncSession,
    prepareEdariWriteSession: safety.prepareEdariWriteSession,
    finalizeEdariWriteSession: safety.finalizeEdariWriteSession,
    tablesForSessionKinds: safety.tablesForSessionKinds,
    serverJsonPaths: getServerJsonPaths(),
    kinds: options.kinds || null,
    itemIds: options.itemIds || null,
    limit: options.limit || 100
  });
}

module.exports = { runEdariSyncWorker: runEdariSyncWorkerDesktop };
