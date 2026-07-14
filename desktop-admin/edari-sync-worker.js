const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getServerUrl } = require('./server-config');

function readServerJson() {
  const candidates = [
    path.join(process.cwd(), 'server.json'),
    path.join(path.dirname(process.execPath), 'server.json')
  ];
  if (app?.isPackaged) {
    candidates.unshift(path.join(path.dirname(app.getPath('exe')), 'server.json'));
  }
  for (const filePath of candidates) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      /* try next */
    }
  }
  return {};
}

function getSyncKey() {
  if (process.env.SYNC_KEY) return process.env.SYNC_KEY;
  return readServerJson().syncKey || '';
}

function getAuthHeaders() {
  const syncKey = getSyncKey();
  return {
    'Content-Type': 'application/json',
    ...(syncKey ? { 'x-sync-key': syncKey } : {})
  };
}

async function fetchPending(serverUrl, limit = 20) {
  const res = await fetch(`${serverUrl}/api/sync/edari/queue?limit=${limit}`, {
    headers: getAuthHeaders()
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'فشل جلب طابور المزامنة');
  return data.items || [];
}

async function completeItem(serverUrl, itemId, body) {
  const res = await fetch(`${serverUrl}/api/sync/edari/queue/${itemId}/complete`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body)
  });
  return res.json();
}

async function runEdariSyncWorker({ createEdariCustomerAccount, canWriteEdari }) {
  if (!canWriteEdari()) return { skipped: true, reason: 'no_odbc' };
  const serverUrl = getServerUrl().replace(/\/$/, '');
  const items = await fetchPending(serverUrl, 30);
  const accountItems = items.filter((i) => i.kind === 'account' && i.status !== 'done');
  const results = [];
  for (const item of accountItems) {
    try {
      const payload = JSON.parse(item.payload || '{}');
      const created = await createEdariCustomerAccount(payload);
      const out = await completeItem(serverUrl, item.id, created);
      results.push({ id: item.id, ...created, reported: out.ok });
    } catch (err) {
      await completeItem(serverUrl, item.id, { ok: false, error: err.message });
      results.push({ id: item.id, ok: false, error: err.message });
    }
  }
  return { processed: results.length, results };
}

module.exports = { runEdariSyncWorker };
