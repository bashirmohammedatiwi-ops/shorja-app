const db = require('../db');

const KEY = 'app_settings';
const DEFAULTS = {
  usdToIqd: 0
};

function getAppSettings() {
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(KEY);
  if (!row?.value) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(row.value);
    const usdToIqd = Math.max(0, Number(parsed.usdToIqd ?? DEFAULTS.usdToIqd) || 0);
    return { ...DEFAULTS, ...parsed, usdToIqd };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveAppSettings(patch = {}) {
  const current = getAppSettings();
  const next = { ...current };
  if (patch.usdToIqd != null && patch.usdToIqd !== '') {
    const rate = Number(patch.usdToIqd);
    if (!Number.isFinite(rate) || rate < 0) throw new Error('سعر الصرف غير صالح');
    next.usdToIqd = rate;
  }
  db.prepare(`
    INSERT INTO sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(KEY, JSON.stringify(next));
  return next;
}

module.exports = { DEFAULTS, getAppSettings, saveAppSettings };
