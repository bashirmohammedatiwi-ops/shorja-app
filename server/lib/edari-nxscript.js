const fs = require('fs');
const path = require('path');
const { getEdariConnection } = require('./edari-connection');

const EXECUTE_SCRIPT = 'edari-execute.nxscript';
const MAINTENANCE_SCRIPT = 'edari-maintenance.nxscript';
const TREE_REPAIR_SCRIPT = 'edari-tree-repair.nxscript';
const ACCOUNT_MAINT_SCRIPT = 'edari-account-maint.nxscript';
const MAINTENANCE_KEY = 'shorja-maintenance';

function resolveBundledScript() {
  const sibling = path.join(__dirname, EXECUTE_SCRIPT);
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '..', 'scripts', EXECUTE_SCRIPT);
}

function getNexusAdminUrl() {
  return (process.env.NEXUS_ADMIN_URL || 'http://127.0.0.1:10088').replace(/\/$/, '');
}

function getEdariNxRoot() {
  if (process.env.EDARI_NX_ROOT && fs.existsSync(process.env.EDARI_NX_ROOT)) {
    return process.env.EDARI_NX_ROOT;
  }
  const dataRoot = process.env.EDARI_DATA_ROOT || 'D:\\Future of Technology\\EdariNX\\Data';
  const nxRoot = path.dirname(dataRoot);
  const candidates = [
    path.join(nxRoot, 'nx4.7505', 'Adminroot'),
    path.join(nxRoot, 'nxServer', 'Adminroot'),
    path.join(nxRoot, 'Adminroot')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.nxscript'))) return dir;
  }
  return null;
}

function resolveBundledMaintenanceScript() {
  const sibling = path.join(__dirname, MAINTENANCE_SCRIPT);
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '..', 'scripts', MAINTENANCE_SCRIPT);
}

function resolveBundledTreeRepairScript() {
  const sibling = path.join(__dirname, TREE_REPAIR_SCRIPT);
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '..', 'scripts', TREE_REPAIR_SCRIPT);
}

function resolveBundledAccountMaintScript() {
  const sibling = path.join(__dirname, ACCOUNT_MAINT_SCRIPT);
  if (fs.existsSync(sibling)) return sibling;
  return path.join(__dirname, '..', 'scripts', ACCOUNT_MAINT_SCRIPT);
}

function ensureMaintenanceScriptDeployed() {
  const adminRoot = getEdariNxRoot();
  if (!adminRoot) return false;
  const target = path.join(adminRoot, MAINTENANCE_SCRIPT);
  const bundledPath = resolveBundledMaintenanceScript();
  if (!fs.existsSync(bundledPath)) return false;
  try {
    const bundled = fs.readFileSync(bundledPath, 'utf8');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bundled) {
      fs.writeFileSync(target, bundled, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function ensureTreeRepairScriptDeployed() {
  const adminRoot = getEdariNxRoot();
  if (!adminRoot) return false;
  const target = path.join(adminRoot, TREE_REPAIR_SCRIPT);
  const bundledPath = resolveBundledTreeRepairScript();
  if (!fs.existsSync(bundledPath)) return false;
  try {
    const bundled = fs.readFileSync(bundledPath, 'utf8');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bundled) {
      fs.writeFileSync(target, bundled, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function ensureAccountMaintScriptDeployed() {
  const adminRoot = getEdariNxRoot();
  if (!adminRoot) return false;
  const target = path.join(adminRoot, ACCOUNT_MAINT_SCRIPT);
  const bundledPath = resolveBundledAccountMaintScript();
  if (!fs.existsSync(bundledPath)) return false;
  try {
    const bundled = fs.readFileSync(bundledPath, 'utf8');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bundled) {
      fs.writeFileSync(target, bundled, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

async function runAccountMaintViaNxscript(params, connOverrides = {}) {
  const conn = getEdariConnection(connOverrides);
  const alias = String(conn.alias || '').trim();
  const table = String(params.table || '').trim();
  if (!alias || !table) return { ok: false, error: 'alias and table required' };

  if (!ensureAccountMaintScriptDeployed()) {
    return { ok: false, error: 'تعذر نشر edari-account-maint.nxscript', needsNxScript: true };
  }

  try {
    await pingNxAdmin();
  } catch (err) {
    return { ok: false, error: `nxServer غير متاح: ${err.message}`, needsNxServer: true };
  }

  const q = new URLSearchParams({ alias, key: MAINTENANCE_KEY, table });
  if (params.seq != null) q.set('seq', String(params.seq));
  if (params.autoinc != null) q.set('autoinc', String(params.autoinc));

  const url = `${getNexusAdminUrl()}/${ACCOUNT_MAINT_SCRIPT}?${q.toString()}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    return { ok: false, error: `فشل الاتصال بـ nxServer: ${err.message}` };
  }

  const bodyBuf = Buffer.from(await response.arrayBuffer());
  const parsed = extractJsonBody(bodyBuf);
  if (!parsed) {
    const bodyText = bodyBuf.toString('utf8');
    const preMatch = bodyText.match(/<pre>([\s\S]*?)<\/pre>/i);
    const errText = preMatch ? preMatch[1].replace(/<BR>/gi, '\n').trim() : bodyText.trim();
    return { ok: false, error: errText || 'account maint script invalid JSON' };
  }
  return parsed;
}

function ensureExecuteScriptDeployed() {
  const adminRoot = getEdariNxRoot();
  if (!adminRoot) return false;
  const target = path.join(adminRoot, EXECUTE_SCRIPT);
  const bundledPath = resolveBundledScript();
  if (!fs.existsSync(bundledPath)) return false;
  try {
    const bundled = fs.readFileSync(bundledPath, 'utf8');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bundled) {
      fs.writeFileSync(target, bundled, 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

function extractJsonBody(textOrBuffer) {
  let raw = '';
  if (Buffer.isBuffer(textOrBuffer)) {
    let buf = textOrBuffer;
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      buf = buf.subarray(3);
    }
    raw = buf.toString('utf8').trim();
  } else {
    raw = String(textOrBuffer || '').trim();
  }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  const start = raw.indexOf('{"ok"');
  if (start >= 0) {
    const end = raw.lastIndexOf('}');
    if (end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
    }
  }
  return null;
}

function isTrialExpiredError(message) {
  return /trial period has expired/i.test(String(message || ''));
}

async function pingNxAdmin() {
  const response = await fetch(getNexusAdminUrl(), { signal: AbortSignal.timeout(4000) });
  return response.ok;
}

function sqlToHex(sqlText) {
  return Buffer.from(String(sqlText || ''), 'latin1').toString('hex');
}

async function runExecuteViaNxscript(sql, connOverrides = {}) {
  const conn = getEdariConnection(connOverrides);
  const alias = String(conn.alias || '').trim();
  const sqlText = String(sql || '').trim();
  if (!sqlText) return { ok: false, error: 'SQL is required' };
  if (!alias) return { ok: false, error: 'Database alias is required' };

  if (!ensureExecuteScriptDeployed()) {
    return { ok: false, error: 'تعذر نشر edari-execute.nxscript إلى nxServer Adminroot', needsNxScript: true };
  }

  try {
    await pingNxAdmin();
  } catch (err) {
    return { ok: false, error: `nxServer غير متاح (${getNexusAdminUrl()}): ${err.message}`, needsNxServer: true };
  }

  const url = `${getNexusAdminUrl()}/${EXECUTE_SCRIPT}?alias=${encodeURIComponent(alias)}&sqlhex=${sqlToHex(sqlText)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    return { ok: false, error: `فشل الاتصال بـ nxServer: ${err.message}` };
  }

  const bodyBuf = Buffer.from(await response.arrayBuffer());
  const parsed = extractJsonBody(bodyBuf);
  if (!parsed) {
    const bodyText = bodyBuf.toString('utf8');
    const preMatch = bodyText.match(/<pre>([\s\S]*?)<\/pre>/i);
    const errText = preMatch ? preMatch[1].replace(/<BR>/gi, '\n').trim() : bodyText.trim();
    return { ok: false, error: errText || 'nxServer execute script returned invalid JSON' };
  }
  return parsed;
}

async function runTreeRepairViaNxscript({ seq, subCount, subHex = '' }, connOverrides = {}) {
  const conn = getEdariConnection(connOverrides);
  const alias = String(conn.alias || '').trim();
  const seqNum = Number(seq);
  const count = Number(subCount);
  if (!Number.isFinite(seqNum) || seqNum <= 0) return { ok: false, error: 'seq is required' };
  if (!Number.isFinite(count) || count < 0) return { ok: false, error: 'subCount is required' };
  if (!alias) return { ok: false, error: 'Database alias is required' };

  if (!ensureTreeRepairScriptDeployed()) {
    return { ok: false, error: 'تعذر نشر edari-tree-repair.nxscript', needsNxScript: true };
  }

  try {
    await pingNxAdmin();
  } catch (err) {
    return { ok: false, error: `nxServer غير متاح: ${err.message}`, needsNxServer: true };
  }

  const params = new URLSearchParams({
    alias,
    key: MAINTENANCE_KEY,
    seq: String(seqNum),
    subcount: String(count)
  });
  if (count > 0) params.set('subhex', String(subHex || '').replace(/\s/g, ''));

  const url = `${getNexusAdminUrl()}/${TREE_REPAIR_SCRIPT}?${params.toString()}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    return { ok: false, error: `فشل الاتصال بـ nxServer: ${err.message}` };
  }

  const bodyBuf = Buffer.from(await response.arrayBuffer());
  const parsed = extractJsonBody(bodyBuf);
  if (!parsed) {
    const bodyText = bodyBuf.toString('utf8');
    const preMatch = bodyText.match(/<pre>([\s\S]*?)<\/pre>/i);
    const errText = preMatch ? preMatch[1].replace(/<BR>/gi, '\n').trim() : bodyText.trim();
    return { ok: false, error: errText || 'tree repair script invalid JSON' };
  }
  return parsed;
}

async function runMaintenanceViaNxscript(sql, connOverrides = {}) {
  const conn = getEdariConnection(connOverrides);
  const alias = String(conn.alias || '').trim();
  const sqlText = String(sql || '').trim();
  if (!sqlText) return { ok: false, error: 'SQL is required' };
  if (!alias) return { ok: false, error: 'Database alias is required' };

  if (!ensureMaintenanceScriptDeployed()) {
    return { ok: false, error: 'تعذر نشر edari-maintenance.nxscript', needsNxScript: true };
  }

  try {
    await pingNxAdmin();
  } catch (err) {
    return { ok: false, error: `nxServer غير متاح: ${err.message}`, needsNxServer: true };
  }

  const url = `${getNexusAdminUrl()}/${MAINTENANCE_SCRIPT}?alias=${encodeURIComponent(alias)}&key=${encodeURIComponent(MAINTENANCE_KEY)}&sqlhex=${sqlToHex(sqlText)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    return { ok: false, error: `فشل الاتصال بـ nxServer: ${err.message}` };
  }

  const bodyBuf = Buffer.from(await response.arrayBuffer());
  const parsed = extractJsonBody(bodyBuf);
  if (!parsed) {
    const bodyText = bodyBuf.toString('utf8');
    const preMatch = bodyText.match(/<pre>([\s\S]*?)<\/pre>/i);
    const errText = preMatch ? preMatch[1].replace(/<BR>/gi, '\n').trim() : bodyText.trim();
    return { ok: false, error: errText || 'maintenance script invalid JSON' };
  }
  return parsed;
}

module.exports = {
  ensureExecuteScriptDeployed,
  ensureMaintenanceScriptDeployed,
  ensureTreeRepairScriptDeployed,
  ensureAccountMaintScriptDeployed,
  runExecuteViaNxscript,
  runMaintenanceViaNxscript,
  runTreeRepairViaNxscript,
  runAccountMaintViaNxscript,
  isTrialExpiredError
};
