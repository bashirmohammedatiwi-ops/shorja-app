const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getServerUrl } = require('./server-config');
const { logSync } = require('../server/lib/edari-sync-worker');

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
    EDARI_WRITE_ENABLED: '1',
    EDARI_WRITE_VIA_NXSCRIPT: '1',
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

  win.on('focus', () => { processEdariQueueLocal().catch(() => {}); });
  win.loadURL(startUrl);
}

app.whenReady().then(() => {
  createWindow();
  startEdariSyncLoop();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
