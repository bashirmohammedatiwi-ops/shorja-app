const path = require('path');

const DEFAULT_EDARI = {
  mode: 'tcp',
  alias: '2025',
  server: '127.0.0.1',
  port: 16000,
  dataRoot: 'D:\\Future of Technology\\EdariNX\\Data',
  databasePath: 'D:\\Future of Technology\\EdariNX\\Data\\2025'
};

function getEdariConnection(overrides = {}) {
  const conn = {
    mode: process.env.EDARI_MODE || DEFAULT_EDARI.mode,
    alias: process.env.EDARI_ALIAS || DEFAULT_EDARI.alias,
    server: process.env.EDARI_SERVER || DEFAULT_EDARI.server,
    port: Number(process.env.EDARI_PORT || DEFAULT_EDARI.port),
    dataRoot: process.env.EDARI_DATA_ROOT || DEFAULT_EDARI.dataRoot,
    databasePath: process.env.EDARI_DATABASE_PATH || ''
  };
  Object.assign(conn, overrides);
  if (!conn.databasePath && conn.dataRoot && conn.alias) {
    conn.databasePath = path.join(conn.dataRoot, conn.alias);
  }
  conn.port = Number(conn.port) || DEFAULT_EDARI.port;
  conn.mode = conn.mode === 'internal' ? 'internal' : 'tcp';
  return conn;
}

function connectionToEnv(conn = {}) {
  const c = getEdariConnection(conn);
  return {
    EDARI_MODE: c.mode,
    EDARI_ALIAS: c.alias,
    EDARI_SERVER: c.server,
    EDARI_PORT: String(c.port),
    EDARI_DATA_ROOT: c.dataRoot,
    EDARI_DATABASE_PATH: c.databasePath
  };
}

module.exports = { DEFAULT_EDARI, getEdariConnection, connectionToEnv };
