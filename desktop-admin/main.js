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

async function loadRemoteEdariSettings() {
  try {
    const res = await fetch(`${getServerUrl()}/api/health`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return {
      alias: String(data.edari?.alias || '').trim(),
      dataRoot: String(data.edari?.dataRoot || '').trim()
    };
  } catch {
    return {};
  }
}

function clearEdariRequireCache() {
  const names = [
    'edari-connection.js',
    'edari-nxscript.js',
    'edari-bridge.js',
    'edari-lookup.js',
    'edari-accounts.js',
    'edari-invoices.js',
    'edari-post-write.js',
    'edari-safety.js',
    'edari-sync-worker.js'
  ];
  for (const name of names) {
    const filePath = getEdariLibPath(name);
    try { delete require.cache[require.resolve(filePath)]; } catch { /* not loaded */ }
  }
}

async function applyEdariEnv() {
  const remote = await loadRemoteEdariSettings();
  clearEdariRequireCache();
  const connPath = getEdariLibPath('edari-connection.js');
  const { connectionToEnv, resolveLiveEdariConnection, CURRENT_EDARI_YEAR } = require(connPath);
  const nxPath = getEdariLibPath('edari-nxscript.js');
  const { ensureExecuteScriptDeployed, ensureAccountMaintScriptDeployed, ensureTreeRepairScriptDeployed } = require(nxPath);
  ensureExecuteScriptDeployed();
  ensureAccountMaintScriptDeployed();
  ensureTreeRepairScriptDeployed();
  const connOverrides = {
    alias: remote.alias && remote.alias !== '2025' ? remote.alias : (CURRENT_EDARI_YEAR || '2026')
  };
  if (remote.dataRoot) connOverrides.dataRoot = remote.dataRoot;
  const live = await resolveLiveEdariConnection(connOverrides);
  Object.assign(process.env, {
    EDARI_READER_ROOT: getEdariReaderRoot(),
    EDARI_WRITE_ENABLED: process.env.EDARI_WRITE_ENABLED || '0',
    EDARI_WRITE_ACCOUNTS: process.env.EDARI_WRITE_ACCOUNTS || '0',
    EDARI_WRITE_INVOICES: process.env.EDARI_WRITE_INVOICES || '0',
    EDARI_WRITE_STOCK: process.env.EDARI_WRITE_STOCK || '0',
    EDARI_WRITE_VIA_NXSCRIPT: process.env.EDARI_WRITE_VIA_NXSCRIPT || '1',
    EDARI_MANUAL_SYNC_ONLY: process.env.EDARI_MANUAL_SYNC_ONLY || '1',
    EDARI_WALKIN_CUSTOMER_NUM: process.env.EDARI_WALKIN_CUSTOMER_NUM || '121119002',
    EDARI_WALKIN_CUSTOMER_SEQ: process.env.EDARI_WALKIN_CUSTOMER_SEQ || '',
    EDARI_SALES_ACCOUNT_SEQ: process.env.EDARI_SALES_ACCOUNT_SEQ || '41',
    EDARI_RETURNS_ACCOUNT_SEQ: process.env.EDARI_RETURNS_ACCOUNT_SEQ || '42',
    EDARI_CASH_ACCOUNT_SEQ: process.env.EDARI_CASH_ACCOUNT_SEQ || '316',
    EDARI_DISCOUNT_ACCOUNT_SEQ: process.env.EDARI_DISCOUNT_ACCOUNT_SEQ || '132',
    EDARI_INVOICE_BOOK: process.env.EDARI_INVOICE_BOOK || '1',
    EDARI_INVOICE_PERSON: process.env.EDARI_INVOICE_PERSON || '255',
    EDARI_PRICE_GROUP: process.env.EDARI_PRICE_GROUP || '4',
    EDARI_SHORJA_PARENT_NUM: process.env.EDARI_SHORJA_PARENT_NUM || '12111',
    EDARI_SHORJA_CHILD_SUFFIX_FLOOR: process.env.EDARI_SHORJA_CHILD_SUFFIX_FLOOR || '9001',
    EDARI_SHORJA_BILL_NUM_START: process.env.EDARI_SHORJA_BILL_NUM_START || '9000000',
    EDARI_SHORJA_STORE_NAME: process.env.EDARI_SHORJA_STORE_NAME || 'محل الشورجه',
    EDARI_SHORJA_STORE_INDEX: process.env.EDARI_SHORJA_STORE_INDEX || '4',
    ...connectionToEnv(live)
  });
  return live;
}

const { logSync } = require(getEdariLibPath('edari-sync-worker.js'));

ipcMain.handle('lookup-edari-material', async (_e, code) => {
  try {
    await applyEdariEnv();
    const lookupPath = getEdariLibPath('edari-lookup.js');
    delete require.cache[require.resolve(lookupPath)];
    const { lookupEdariMaterial, resetOdbcBridgeCache } = require(lookupPath);
    resetOdbcBridgeCache?.();
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
    const live = await applyEdariEnv();
    const worker = require('./edari-sync-worker');
    worker.resetEdariHandlers?.();
    const result = await worker.runEdariSyncWorker(options);
    if (result.processed > 0) logSync('تطبيق الإدارة — مزامنة يدوية', result);
    return { ...result, edari: live };
  } catch (err) {
    logSync('تطبيق الإدارة — خطأ', err.message);
    return { ok: false, error: err.message };
  } finally {
    syncBusy = false;
  }
}

ipcMain.handle('process-edari-sync', (_e, options) => processEdariQueueLocal(options || {}));

ipcMain.handle('get-edari-connection', async () => {
  try {
    const edari = await applyEdariEnv();
    return { ok: true, edari };
  } catch (err) {
    return { ok: false, error: err.message || 'فشل قراءة اتصال الإداري' };
  }
});

ipcMain.handle('edari-product-import-status', async () => {
  try {
    await applyEdariEnv();
    const workerPath = path.join(__dirname, 'edari-product-import-worker.js');
    delete require.cache[require.resolve(workerPath)];
    const { getEdariProductImportStatus } = require(workerPath);
    return await getEdariProductImportStatus();
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بـ Edari' };
  }
});

ipcMain.handle('edari-product-import-batch', async (_e, options) => {
  try {
    await applyEdariEnv();
    const workerPath = path.join(__dirname, 'edari-product-import-worker.js');
    delete require.cache[require.resolve(workerPath)];
    const { fetchEdariProductImportBatch } = require(workerPath);
    return await fetchEdariProductImportBatch(options || {});
  } catch (err) {
    return { ok: false, error: err.message || 'فشل جلب الدفعة من Edari' };
  }
});

ipcMain.handle('edari-warehouse-import-status', async () => {
  try {
    await applyEdariEnv();
    const workerPath = path.join(__dirname, 'edari-product-import-worker.js');
    delete require.cache[require.resolve(workerPath)];
    const { getEdariWarehouseImportStatus } = require(workerPath);
    return await getEdariWarehouseImportStatus();
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بـ Edari' };
  }
});

ipcMain.handle('edari-warehouse-import-batch', async (_e, options) => {
  try {
    await applyEdariEnv();
    const workerPath = path.join(__dirname, 'edari-product-import-worker.js');
    delete require.cache[require.resolve(workerPath)];
    const { fetchEdariWarehouseImportBatch } = require(workerPath);
    return await fetchEdariWarehouseImportBatch(options || {});
  } catch (err) {
    return { ok: false, error: err.message || 'فشل جلب مستودع الشورجة' };
  }
});

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
