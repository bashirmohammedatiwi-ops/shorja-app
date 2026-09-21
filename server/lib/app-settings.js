const db = require('../db');
const { DEFAULT_EDARI, normalizeEdariAlias } = require('./edari-connection');

const KEY = 'app_settings';
const DEFAULTS = {
  usdToIqd: 0,
  edariAlias: DEFAULT_EDARI.alias,
  edariDataRoot: DEFAULT_EDARI.dataRoot
};

function getAppSettings() {
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(KEY);
  if (!row?.value) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(row.value);
    const usdToIqd = Math.max(0, Number(parsed.usdToIqd ?? DEFAULTS.usdToIqd) || 0);
    let edariAlias = normalizeEdariAlias(parsed.edariAlias, DEFAULTS.edariAlias);
    if (edariAlias === '2025') edariAlias = DEFAULTS.edariAlias;
    const edariDataRoot = String(parsed.edariDataRoot || DEFAULTS.edariDataRoot).trim()
      || DEFAULTS.edariDataRoot;
    const next = { ...DEFAULTS, ...parsed, usdToIqd, edariAlias, edariDataRoot };
    if (parsed.edariAlias === '2025') {
      try {
        db.prepare(`
          INSERT INTO sync_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(KEY, JSON.stringify(next));
      } catch { /* ignore persist */ }
    }
    return next;
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
  if (patch.edariAlias != null && String(patch.edariAlias).trim() !== '') {
    const alias = normalizeEdariAlias(patch.edariAlias, '');
    if (!alias) throw new Error('اسم قاعدة الإداري غير صالح — استخدم السنة مثل 2026');
    next.edariAlias = alias;
  }
  if (patch.edariDataRoot != null) {
    next.edariDataRoot = String(patch.edariDataRoot).trim() || DEFAULTS.edariDataRoot;
  }
  db.prepare(`
    INSERT INTO sync_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(KEY, JSON.stringify(next));
  return next;
}

module.exports = { DEFAULTS, getAppSettings, saveAppSettings };
