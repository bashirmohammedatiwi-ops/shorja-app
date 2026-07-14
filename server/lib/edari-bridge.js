const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getEdariConnection } = require('./edari-connection');

const execFileAsync = promisify(execFile);
const EXECUTE_PS = path.join(__dirname, '..', 'scripts', 'edari-execute.ps1');

const edariRoot = process.env.EDARI_READER_ROOT
  || path.join(__dirname, '..', '..', '..', 'db', 'edari-reader');

let odbcBridge;
try {
  odbcBridge = require(path.join(edariRoot, 'lib', 'odbc-bridge'));
} catch {
  odbcBridge = null;
}

function isWindows() {
  return process.platform === 'win32';
}

function canQueryEdari() {
  return !!odbcBridge;
}

function canWriteEdari() {
  return isWindows() && process.env.EDARI_WRITE_ENABLED !== '0';
}

async function runQuery(sql, connOverrides = {}) {
  if (!odbcBridge) {
    return { ok: false, error: 'Edari reader غير متوفر — عيّن EDARI_READER_ROOT' };
  }
  return odbcBridge.runQuery({ ...getEdariConnection(connOverrides), sql });
}

async function runExecute(sql, connOverrides = {}) {
  if (!canWriteEdari()) {
    return { ok: false, error: 'كتابة Edari متاحة على Windows مع ODBC فقط', needsDriver: true };
  }
  const conn = getEdariConnection(connOverrides);
  const payload = JSON.stringify({
    action: 'execute',
    mode: conn.mode,
    server: conn.server,
    port: conn.port,
    alias: conn.alias,
    databasePath: conn.databasePath,
    sql
  });
  try {
    const out = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EXECUTE_PS, payload],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }
    );
    const result = JSON.parse(out.stdout.trim());
    return result;
  } catch (err) {
    const parsed = tryParse(err.stdout);
    if (parsed) return parsed;
    return { ok: false, error: err.message || 'فشل تنفيذ Edari' };
  }
}

function tryParse(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function rowObjects(result) {
  if (!result?.ok || !result.rows) return [];
  if (Array.isArray(result.rows[0])) {
    const cols = result.columns || [];
    return result.rows.map((row) => {
      const o = {};
      cols.forEach((c, i) => { o[c] = row[i]; });
      return o;
    });
  }
  return result.rows;
}

module.exports = {
  canQueryEdari,
  canWriteEdari,
  runQuery,
  runExecute,
  rowObjects
};
