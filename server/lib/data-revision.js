const db = require('../db');

const REVISION_KEY = 'data_revision';

function getDataRevision() {
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(REVISION_KEY);
  return Number(row?.value || 0);
}

function bumpDataRevision() {
  const next = getDataRevision() + 1;
  db.prepare(`
    INSERT INTO sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(REVISION_KEY, String(next));
  return next;
}

module.exports = { getDataRevision, bumpDataRevision };
