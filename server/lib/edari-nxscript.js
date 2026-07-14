const fs = require('fs');
const path = require('path');
const { getEdariConnection } = require('./edari-connection');

const EXECUTE_SCRIPT = 'edari-execute.nxscript';

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

module.exports = {
  ensureExecuteScriptDeployed,
  runExecuteViaNxscript,
  isTrialExpiredError
};
