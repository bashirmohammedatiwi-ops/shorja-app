const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getServerUrl } = require('./server-config');
const { registerEdariModulePaths } = require('./edari-module-paths');

registerEdariModulePaths(app);

function getEdariReaderRoot() {
  if (process.env.EDARI_READER_ROOT) return process.env.EDARI_READER_ROOT;
  return path.join(process.env.USERPROFILE || '', 'Documents', 'db', 'edari-reader');
}

function getEdariLibPath(name) {
  const packaged = path.join(process.resourcesPath, 'edari', name);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'server', 'lib', name);
}

function applyEdariEnv() {
  const connPath = getEdariLibPath('edari-connection.js');
  delete require.cache[require.resolve(connPath)];
  const { connectionToEnv } = require(connPath);
  const nxPath = getEdariLibPath('edari-nxscript.js');
  delete require.cache[require.resolve(nxPath)];
  const { ensureExecuteScriptDeployed, ensureAccountMaintScriptDeployed, ensureTreeRepairScriptDeployed } = require(nxPath);
  ensureExecuteScriptDeployed();
  ensureAccountMaintScriptDeployed();
  ensureTreeRepairScriptDeployed();
  Object.assign(process.env, {
    EDARI_READER_ROOT: getEdariReaderRoot(),
    EDARI_WRITE_ENABLED: process.env.EDARI_WRITE_ENABLED || '0',
    EDARI_WRITE_ACCOUNTS: process.env.EDARI_WRITE_ACCOUNTS || '0',
    EDARI_WRITE_INVOICES: process.env.EDARI_WRITE_INVOICES || '0',
    EDARI_WRITE_STOCK: process.env.EDARI_WRITE_STOCK || '0',
    EDARI_WRITE_VIA_NXSCRIPT: process.env.EDARI_WRITE_VIA_NXSCRIPT || '1',
    EDARI_MANUAL_SYNC_ONLY: process.env.EDARI_MANUAL_SYNC_ONLY || '1',
    ...connectionToEnv()
  });
}

const { logSync } = require(getEdariLibPath('edari-sync-worker.js'));

ipcMain.handle('lookup-edari-material', async (_e, code) => {
  try {
    applyEdariEnv();
    const lookupPath = getEdariLibPath('edari-lookup.js');
    delete require.cache[require.resolve(lookupPath)];
    const { lookupEdariMaterial } = require(lookupPath);
    const material = await lookupEdariMaterial(code);
    if (!material) return { ok: false, error: 'المادة غير موجودة في Edari' };
    return { ok: true, material };
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بـ Edari' };
  }
});

let syncBusy = false;
async function processEdariQueueLocal(options = {}) {
  if (syncBusy) return { skipped: true, reason: 'busy' };
  syncBusy = true;
  try {
    applyEdariEnv();
    const { runEdariSyncWorker } = require('./edari-sync-worker');
    const result = await runEdariSyncWorker(options);
    if (result.processed > 0) logSync('تطبيق الإدارة — مزامنة يدوية', result);
    return result;
  } catch (err) {
    logSync('تطبيق الإدارة — خطأ', err.message);
    return { ok: false, error: err.message };
  } finally {
    syncBusy = false;
  }
}

ipcMain.handle('process-edari-sync', (_e, options) => processEdariQueueLocal(options || {}));

function createWindow() {
  const server = getServerUrl();
  const startUrl = `${server}/admin/`;

  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    title: 'ديما الحياة — الإدارة',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  logSync('مزامنة الإداري: يدوية فقط — استخدم شاشة «مزامنة الإداري»');
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
