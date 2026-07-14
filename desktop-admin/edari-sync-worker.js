const fs = require('fs');
const path = require('path');
const { runEdariSyncWorker } = require('../server/lib/edari-sync-worker');

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
  const lookupPath = getEdariLibPath('edari-lookup.js');
  delete require.cache[require.resolve(accountsPath)];
  delete require.cache[require.resolve(invoicesPath)];
  delete require.cache[require.resolve(lookupPath)];
  return {
    account: require(accountsPath).createEdariCustomerAccount,
    invoice: require(invoicesPath).createEdariInvoice,
    payment: require(invoicesPath).createEdariPayment
  };
}
const SYNC_HANDLERS = {
  account: null,
  invoice: null,
  payment: null
};

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

async function runEdariSyncWorkerDesktop({ canWriteEdari }) {
  const handlers = loadHandlers();
  return runEdariSyncWorker({
    handlers,
    canWriteEdari,
    serverJsonPaths: getServerJsonPaths()
  });
}

module.exports = { runEdariSyncWorker: runEdariSyncWorkerDesktop };
