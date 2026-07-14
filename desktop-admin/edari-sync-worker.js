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

async function runEdariSyncWorkerDesktop({ createEdariCustomerAccount, canWriteEdari }) {
  return runEdariSyncWorker({
    createEdariCustomerAccount,
    canWriteEdari,
    serverJsonPaths: getServerJsonPaths()
  });
}

module.exports = { runEdariSyncWorker: runEdariSyncWorkerDesktop };
