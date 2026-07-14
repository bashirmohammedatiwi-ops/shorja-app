const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getServerUrl } = require('./server-config');

const SYNC_INTERVAL_MS = Math.max(5000, Number(process.env.EDARI_SYNC_INTERVAL_MS || 10000));

function getEdariReaderRoot() {
  if (process.env.EDARI_READER_ROOT) return process.env.EDARI_READER_ROOT;
  return path.join(process.env.USERPROFILE || '', 'Documents', 'db', 'edari-reader');
}

function getEdariLibPath(name) {
  const packaged = path.join(process.resourcesPath, 'edari', name);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'server', 'lib', name);
}

function canWriteEdariMaster() {
  const safetyPath = getEdariLibPath('edari-safety.js');
  delete require.cache[require.resolve(safetyPath)];
  return require(safetyPath).canWriteEdariMaster();
}

const { logSync } = require(getEdariLibPath('edari-sync-worker.js'));

function applyEdariEnv() {
  const connPath = getEdariLibPath('edari-connection.js');
  delete require.cache[require.resolve(connPath)];
  const { connectionToEnv } = require(connPath);
  const nxPath = getEdariLibPath('edari-nxscript.js');
  delete require.cache[require.resolve(nxPath)];
  const { ensureExecuteScriptDeployed } = require(nxPath);
  ensureExecuteScriptDeployed();
  Object.assign(process.env, {
    EDARI_READER_ROOT: getEdariReaderRoot(),
    EDARI_WRITE_ENABLED: process.env.EDARI_WRITE_ENABLED || '0',
    EDARI_WRITE_ACCOUNTS: process.env.EDARI_WRITE_ACCOUNTS || '0',
    EDARI_WRITE_INVOICES: process.env.EDARI_WRITE_INVOICES || '0',
    EDARI_WRITE_STOCK: process.env.EDARI_WRITE_STOCK || '0',
    EDARI_WRITE_VIA_NXSCRIPT: process.env.EDARI_WRITE_VIA_NXSCRIPT || '1',
    ...connectionToEnv()
  });
}

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
async function processEdariQueueLocal() {
  if (syncBusy) return { skipped: true, reason: 'busy' };
  if (!canWriteEdariMaster()) {
    return { skipped: true, reason: 'edari_writes_disabled' };
  }
  syncBusy = true;
  try {
    applyEdariEnv();
    const bridgePath = getEdariLibPath('edari-bridge.js');
    delete require.cache[require.resolve(bridgePath)];
    const { canWriteEdari } = require(bridgePath);
    const { runEdariSyncWorker } = require('./edari-sync-worker');
    const result = await runEdariSyncWorker({ canWriteEdari });
    if (result.processed > 0) logSync('تطبيق الإدارة — تمت المعالجة', result);
    return result;
  } catch (err) {
    logSync('تطبيق الإدارة — خطأ', err.message);
    return { ok: false, error: err.message };
  } finally {
    syncBusy = false;
  }
}

ipcMain.handle('process-edari-sync', processEdariQueueLocal);

let edariSyncTimer = null;
function startEdariSyncLoop() {
  if (edariSyncTimer) return;
  if (!canWriteEdariMaster()) {
    logSync('مزامنة الكتابة إلى Edari معطّلة — القراءة فقط (حماية الإداري الأصلي)');
    return;
  }
  const tick = () => { processEdariQueueLocal().catch((err) => logSync('tick error', err.message)); };
  edariSyncTimer = setInterval(tick, SYNC_INTERVAL_MS);
  setTimeout(tick, 800);
  logSync(`بدء مزامنة الإداري كل ${SYNC_INTERVAL_MS / 1000} ثانية`);
}

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

  win.on('focus', () => {
    if (canWriteEdariMaster()) processEdariQueueLocal().catch(() => {});
  });
  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();
  startEdariSyncLoop();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
