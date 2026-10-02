const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SERVER = 'http://187.124.23.65:5007';

function readConfigFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.server && typeof data.server === 'string') {
      return data.server.replace(/\/$/, '');
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getServerUrl() {
  if (process.env.SHORJA_SERVER) {
    return process.env.SHORJA_SERVER.replace(/\/$/, '');
  }

  const candidates = [
    path.join(process.cwd(), 'server.json'),
    path.join(path.dirname(process.execPath), 'server.json')
  ];

  if (app.isPackaged) {
    candidates.unshift(path.join(path.dirname(app.getPath('exe')), 'server.json'));
  }

  for (const filePath of candidates) {
    const server = readConfigFile(filePath);
    if (server) return server;
  }

  return DEFAULT_SERVER;
}

module.exports = { getServerUrl, DEFAULT_SERVER };
