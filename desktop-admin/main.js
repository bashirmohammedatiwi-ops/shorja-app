const { app, BrowserWindow } = require('electron');
const { getServerUrl } = require('./server-config');

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
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(startUrl);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
