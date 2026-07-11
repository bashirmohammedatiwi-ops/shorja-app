const { app, BrowserWindow } = require('electron');
const path = require('path');

const SERVER = process.env.SHORJA_SERVER || 'http://localhost:5007';
const START_URL = `${SERVER.replace(/\/$/, '')}/admin/`;

function createWindow() {
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
  win.loadURL(START_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
