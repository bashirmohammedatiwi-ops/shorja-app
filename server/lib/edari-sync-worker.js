const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER = 'http://187.124.23.65:5007';

function resolveServerJsonPaths(extraPaths = []) {
  const paths = [...extraPaths];
  if (process.env.SHORJA_SERVER_JSON) paths.push(process.env.SHORJA_SERVER_JSON);
  paths.push(path.join(process.cwd(), 'server.json'));
  paths.push(path.join(__dirname, '..', 'desktop-admin', 'server.json'));
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

async function fetchPending(serverUrl, extraPaths, limit = 100, kinds = null) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (Array.isArray(kinds) && kinds.length) params.set('kinds', kinds.join(','));
  const res = await fetch(`${serverUrl}/api/sync/edari/queue?${params.toString()}`, {
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

function normalizeKinds(kinds) {
  if (!Array.isArray(kinds) || !kinds.length) return null;
  return kinds.map((k) => String(k).trim()).filter(Boolean);
}

function parsePayload(item) {
  if (typeof item.payload === 'string') {
    try { return JSON.parse(item.payload || '{}'); } catch { return {}; }
  }
  return item.payload || {};
}

async function runEdariSyncWorker({
  handlers,
  createEdariCustomerAccount,
  canWriteEdari,
  beginManualEdariSyncSession,
  endManualEdariSyncSession,
  finalizeEdariWriteSession,
  prepareEdariWriteSession,
  tablesForSessionKinds,
  serverJsonPaths = [],
  serverUrl = null,
  kinds = null,
  itemIds = null,
  limit = 50
} = {}) {
  const map = handlers || {
    account: createEdariCustomerAccount,
    invoice: null,
    payment: null
  };
  if (process.platform !== 'win32') {
    return { skipped: true, reason: 'not_windows' };
  }
  if (!beginManualEdariSyncSession && typeof canWriteEdari === 'function' && !canWriteEdari()) {
    return { skipped: true, reason: 'edari_writes_disabled' };
  }

  const kindFilter = normalizeKinds(kinds);
  const baseUrl = (serverUrl || getServerUrl(serverJsonPaths)).replace(/\/$/, '');
  const syncKey = getSyncKey(serverJsonPaths);
  if (!syncKey) {
    return { skipped: true, reason: 'missing_sync_key' };
  }

  const items = await fetchPending(baseUrl, serverJsonPaths, limit, kindFilter);
  const idSet = Array.isArray(itemIds) && itemIds.length
    ? new Set(itemIds.map(Number))
    : null;
  const workItems = items.filter((i) => {
    if (i.status === 'done') return false;
    if (idSet && !idSet.has(Number(i.id))) return false;
    return true;
  }).sort((a, b) => {
    const order = { account: 0, invoice: 1, payment: 2 };
    return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || Number(a.id) - Number(b.id);
  });

  if (!workItems.length) {
    return { processed: 0, okCount: 0, failCount: 0, results: [], serverUrl: baseUrl };
  }

  const sessionKinds = kindFilter || [...new Set(workItems.map((i) => i.kind))];
  const sessionOpts = {
    accounts: sessionKinds.includes('account'),
    invoices: sessionKinds.includes('invoice'),
    payments: sessionKinds.includes('payment')
  };

  if (beginManualEdariSyncSession) beginManualEdariSyncSession(sessionOpts);

  const sessionTables = tablesForSessionKinds
    ? tablesForSessionKinds(sessionOpts)
    : (() => {
      const tables = [];
      if (sessionOpts.accounts) tables.push('File11n');
      if (sessionOpts.invoices) tables.push('File15n', 'file14n', 'File12n', 'File13n');
      if (sessionOpts.payments) tables.push('File12n');
      return [...new Set(tables)];
    })();

  logSync(`معالجة يدوية ${workItems.length} عنصر/عناصر`, { serverUrl: baseUrl, kinds: sessionKinds });
  const results = [];

  try {
    const prep = prepareEdariWriteSession || finalizeEdariWriteSession;
    if (prep && sessionTables.length) {
      await prep({
        tables: sessionTables,
        rebuildShorjaParent: sessionOpts.accounts
      });
      logSync('تهيئة آمنة قبل الترحيل (AUTOINC + Sub)', { tables: sessionTables });
    }

    for (const item of workItems) {
      const handler = map[item.kind];
      if (!handler) {
        results.push({ id: item.id, ok: false, error: `لا معالج لـ ${item.kind}` });
        continue;
      }
      try {
        const created = await handler(parsePayload(item));
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

    if (finalizeEdariWriteSession && sessionTables.length) {
      await finalizeEdariWriteSession({
        tables: sessionTables,
        rebuildShorjaParent: sessionOpts.accounts
      });
      logSync('إنهاء آمن بعد الترحيل (AUTOINC + Sub)');
    }
  } finally {
    if (endManualEdariSyncSession) endManualEdariSyncSession();
  }

  const okCount = results.filter((r) => r.ok).length;
  return { processed: results.length, okCount, failCount: results.length - okCount, results, serverUrl: baseUrl };
}

module.exports = {
  DEFAULT_SERVER,
  readServerJson,
  getServerUrl,
  getSyncKey,
  runEdariSyncWorker,
  logSync
};
