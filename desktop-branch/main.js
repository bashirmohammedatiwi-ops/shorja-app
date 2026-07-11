const { app, BrowserWindow } = require('electron');
const path = require('path');

const SERVER = process.env.SHORJA_SERVER || 'http://localhost:5007';
const START_URL = `${SERVER.replace(/\/$/, '')}/branch/`;

function createWindow() {
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
  win.loadURL(START_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
