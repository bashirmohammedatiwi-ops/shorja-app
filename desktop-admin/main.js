const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getServerUrl } = require('./server-config');

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
  Object.assign(process.env, {
    EDARI_READER_ROOT: getEdariReaderRoot(),
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
