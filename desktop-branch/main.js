const { app, BrowserWindow } = require('electron');
const { getServerUrl } = require('./server-config');

function createWindow() {
  const server = getServerUrl();
  const startUrl = `${server}/branch/`;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'ديما الحياة — نقطة البيع',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));

  win.loadURL(startUrl);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
