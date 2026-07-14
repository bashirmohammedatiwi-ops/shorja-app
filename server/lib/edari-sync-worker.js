const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER = 'http://187.124.23.65:5007';

function resolveServerJsonPaths(extraPaths = []) {
  const paths = [...extraPaths];
  if (process.env.SHORJA_SERVER_JSON) paths.push(process.env.SHORJA_SERVER_JSON);
  paths.push(path.join(process.cwd(), 'server.json'));
  paths.push(path.join(__dirname, '..', '..', 'desktop-admin', 'server.json'));
  if (process.execPath) {
    paths.push(path.join(path.dirname(process.execPath), 'server.json'));
  }
  return [...new Set(paths)];
}

function readServerJson(extraPaths = []) {
  for (const filePath of resolveServerJsonPaths(extraPaths)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      /* try next */
    }
  }
  return {};
}

function getServerUrl(extraPaths = []) {
  const cfg = readServerJson(extraPaths);
  if (cfg.server) return String(cfg.server).replace(/\/$/, '');
  if (process.env.SHORJA_SERVER) {
    return process.env.SHORJA_SERVER.replace(/\/$/, '');
  }
  return DEFAULT_SERVER;
}

function getSyncKey(extraPaths = []) {
  const cfg = readServerJson(extraPaths);
  if (cfg.syncKey) return cfg.syncKey;
  if (process.env.SYNC_KEY) return process.env.SYNC_KEY;
  return '';
}

function getAuthHeaders(extraPaths = []) {
  const syncKey = getSyncKey(extraPaths);
  return {
    'Content-Type': 'application/json',
    ...(syncKey ? { 'x-sync-key': syncKey } : {})
  };
}

function logSync(message, detail) {
  const line = `[${new Date().toISOString()}] ${message}${detail ? ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`;
  console.log(line);
  try {
    const dir = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'Shorja');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'edari-sync.log'), `${line}\n`, 'utf8');
  } catch {
    /* ignore log failures */
  }
}

async function fetchPending(serverUrl, extraPaths, limit = 50) {
  const res = await fetch(`${serverUrl}/api/sync/edari/queue?limit=${limit}`, {
    headers: getAuthHeaders(extraPaths),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `فشل جلب الطابور (${res.status})`);
  }
  return data.items || [];
}

async function completeItem(serverUrl, extraPaths, itemId, body) {
  const res = await fetch(`${serverUrl}/api/sync/edari/queue/${itemId}/complete`, {
    method: 'POST',
    headers: getAuthHeaders(extraPaths),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `فشل إبلاغ السيرفر (${res.status})`);
  }
  return data;
}

async function runEdariSyncWorker({
  handlers,
  createEdariCustomerAccount,
  canWriteEdari,
  serverJsonPaths = [],
  serverUrl = null
} = {}) {
  const map = handlers || {
    account: createEdariCustomerAccount,
    invoice: null,
    payment: null
  };
  if (typeof canWriteEdari === 'function' && !canWriteEdari()) {
    return { skipped: true, reason: 'not_windows' };
  }

  const baseUrl = (serverUrl || getServerUrl(serverJsonPaths)).replace(/\/$/, '');
  const syncKey = getSyncKey(serverJsonPaths);
  if (!syncKey) {
    return { skipped: true, reason: 'missing_sync_key' };
  }

  const items = await fetchPending(baseUrl, serverJsonPaths, 50);
  const workItems = items.filter((i) => i.status !== 'done');
  if (!workItems.length) {
    return { processed: 0, results: [], serverUrl: baseUrl };
  }

  logSync(`معالجة ${workItems.length} عنصر/عناصر`, { serverUrl: baseUrl });
  const results = [];

  for (const item of workItems) {
    const handler = map[item.kind];
    if (!handler) {
      results.push({ id: item.id, ok: false, error: `لا معالج لـ ${item.kind}` });
      continue;
    }
    try {
      const payload = JSON.parse(item.payload || '{}');
      const created = await handler(payload);
      await completeItem(baseUrl, serverJsonPaths, item.id, created);
      results.push({ id: item.id, kind: item.kind, ...created, reported: true });
      if (created.ok) {
        logSync(`تمت مزامنة #${item.id} (${item.kind})`, created.edariNum || created.edariBillNum || created.edariSeq || '');
      } else {
        logSync(`فشلت مزامنة #${item.id} (${item.kind})`, created.error);
      }
    } catch (err) {
      try {
        await completeItem(baseUrl, serverJsonPaths, item.id, { ok: false, error: err.message });
      } catch (reportErr) {
        logSync(`تعذر إبلاغ السيرفر عن فشل #${item.id}`, reportErr.message);
      }
      results.push({ id: item.id, kind: item.kind, ok: false, error: err.message });
      logSync(`خطأ في #${item.id} (${item.kind})`, err.message);
    }
  }

  return { processed: results.length, results, serverUrl: baseUrl };
}

module.exports = {
  DEFAULT_SERVER,
  readServerJson,
  getServerUrl,
  getSyncKey,
  runEdariSyncWorker,
  logSync
};
