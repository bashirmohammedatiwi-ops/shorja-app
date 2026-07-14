const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getEdariConnection } = require('./edari-connection');
const { runExecuteViaNxscript, isTrialExpiredError, runMaintenanceViaNxscript } = require('./edari-nxscript');
const { canWriteEdariMaster } = require('./edari-safety');

const execFileAsync = promisify(execFile);

function resolveExecutePs() {
  const sibling = path.join(__dirname, 'edari-execute.ps1');
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '..', 'scripts', 'edari-execute.ps1');
}

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
  return isWindows() && canWriteEdariMaster();
}

async function runQuery(sql, connOverrides = {}) {
  if (!odbcBridge) {
    return { ok: false, error: 'Edari reader غير متوفر — عيّن EDARI_READER_ROOT' };
  }
  return odbcBridge.runQuery({ ...getEdariConnection(connOverrides), sql });
}

async function runExecuteOdbc(sql, connOverrides = {}) {
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
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveExecutePs(), payload],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }
    );
    return JSON.parse(out.stdout.trim());
  } catch (err) {
    const parsed = tryParse(err.stdout);
    if (parsed) return parsed;
    return { ok: false, error: err.message || 'فشل تنفيذ Edari' };
  }
}

async function runMaintenanceExecute(sql) {
  if (process.env.EDARI_MAINTENANCE !== '1') {
    return { ok: false, error: 'وضع الصيانة معطّل — عيّن EDARI_MAINTENANCE=1' };
  }
  const upper = String(sql || '').trim().toUpperCase();
  if (!upper.startsWith('DELETE')) {
    return { ok: false, error: 'صيانة Edari: DELETE فقط' };
  }
  if (!isWindows()) {
    return { ok: false, error: 'صيانة Edari على Windows فقط' };
  }
  return runMaintenanceViaNxscript(sql);
}

async function runExecute(sql, connOverrides = {}) {
  if (!canWriteEdari()) {
    return { ok: false, error: 'كتابة Edari متاحة على Windows فقط', needsDriver: true };
  }

  if (process.env.EDARI_WRITE_VIA_NXSCRIPT !== '0') {
    const nx = await runExecuteViaNxscript(sql, connOverrides);
    if (nx.ok) return nx;
    if (!isTrialExpiredError(nx.error) && !nx.needsNxServer && !nx.needsNxScript) {
      return nx;
    }
  }

  const odbc = await runExecuteOdbc(sql, connOverrides);
  if (odbc.ok) return odbc;
  if (isTrialExpiredError(odbc.error) && process.env.EDARI_WRITE_VIA_NXSCRIPT !== '0') {
    const nx = await runExecuteViaNxscript(sql, connOverrides);
    if (nx.ok) return nx;
    return { ok: false, error: nx.error || odbc.error };
  }
  return odbc;
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
  runMaintenanceExecute,
  rowObjects
};
