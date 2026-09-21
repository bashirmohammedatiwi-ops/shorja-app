const fs = require('fs');
const path = require('path');

const DEFAULT_EDARI = {
  mode: 'tcp',
  alias: '2026',
  server: '127.0.0.1',
  port: 16000,
  dataRoot: 'D:\\Future of Technology\\EdariNX\\Data',
  databasePath: 'D:\\Future of Technology\\EdariNX\\Data\\2026'
};

const CURRENT_EDARI_YEAR = '2026';

function normalizeEdariAlias(value, fallback = DEFAULT_EDARI.alias) {
  const raw = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(raw)) return fallback;
  return raw;
}

function pathEndsWithAlias(filePath, alias) {
  const normalized = String(filePath || '').replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return normalized.endsWith(`/${alias}`) || normalized.split('/').pop() === alias;
}

function getEdariConnection(overrides = {}) {
  const alias = normalizeEdariAlias(
    overrides.alias || process.env.EDARI_ALIAS || DEFAULT_EDARI.alias
  );
  const dataRoot = String(
    overrides.dataRoot || process.env.EDARI_DATA_ROOT || DEFAULT_EDARI.dataRoot
  ).trim() || DEFAULT_EDARI.dataRoot;
  const customPath = String(overrides.databasePath || '').trim();
  const envPath = String(process.env.EDARI_DATABASE_PATH || '').trim();
  let databasePath = customPath;
  if (!databasePath) {
    databasePath = envPath && pathEndsWithAlias(envPath, alias)
      ? envPath
      : path.join(dataRoot, alias);
  }
  const conn = {
    mode: overrides.mode || process.env.EDARI_MODE || DEFAULT_EDARI.mode,
    alias,
    server: overrides.server || process.env.EDARI_SERVER || DEFAULT_EDARI.server,
    port: Number(overrides.port || process.env.EDARI_PORT || DEFAULT_EDARI.port),
    dataRoot,
    databasePath
  };
  conn.port = Number(conn.port) || DEFAULT_EDARI.port;
  conn.mode = conn.mode === 'internal' ? 'internal' : 'tcp';
  return conn;
}

function connectionToEnv(conn = {}) {
  const c = getEdariConnection(conn);
  return {
    EDARI_MODE: c.mode,
    EDARI_ALIAS: c.alias,
    EDARI_SERVER: c.server,
    EDARI_PORT: String(c.port),
    EDARI_DATA_ROOT: c.dataRoot,
    EDARI_DATABASE_PATH: c.databasePath
  };
}

function parseNxAliases(html) {
  const aliases = [];
  const rowPattern =
    /<td id="DynamicRowIdentifier_(\d+)">([^<]+)<\/td>\s*<td id="DynamicRowValue_\1">([^<]+)<\/td>/gi;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    aliases.push({ name: match[2].trim(), path: match[3].trim() });
  }
  if (!aliases.length) {
    const hiddenMatch = String(html || '').match(/value="#NXADO_System=[^"]*;([^"]+)"/i);
    if (hiddenMatch) {
      for (const part of hiddenMatch[1].split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0) {
          aliases.push({
            name: part.slice(0, eq).trim(),
            path: part.slice(eq + 1).trim()
          });
        }
      }
    }
  }
  return aliases.filter((item) => item.name && !item.name.startsWith('#'));
}

async function fetchNxAliases(adminUrl = process.env.NEXUS_ADMIN_URL || 'http://127.0.0.1:10088') {
  try {
    const res = await fetch(`${String(adminUrl).replace(/\/$/, '')}/index.nxscript?index=1`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return [];
    return parseNxAliases(await res.text());
  } catch {
    return [];
  }
}

function pickLiveEdariAlias(aliases, preferred = CURRENT_EDARI_YEAR) {
  const names = new Set((aliases || []).map((a) => a.name));
  if (names.has(CURRENT_EDARI_YEAR)) return CURRENT_EDARI_YEAR;
  const years = [...names].filter((n) => /^\d{4}$/.test(n)).sort();
  const latest = years[years.length - 1];
  if (latest && Number(latest) >= Number(CURRENT_EDARI_YEAR)) return latest;
  if (names.has(preferred)) return preferred;
  return CURRENT_EDARI_YEAR;
}

function localYearFolderExists(dataRoot, year) {
  try {
    return fs.existsSync(path.join(dataRoot, year));
  } catch {
    return false;
  }
}

async function resolveLiveEdariConnection(overrides = {}) {
  const base = getEdariConnection({
    ...overrides,
    alias: overrides.alias || CURRENT_EDARI_YEAR
  });
  let alias = base.alias;
  if (alias === '2025' || !alias) alias = CURRENT_EDARI_YEAR;

  const aliases = process.platform === 'win32' ? await fetchNxAliases() : [];
  if (aliases.length) {
    alias = pickLiveEdariAlias(aliases, alias);
    const match = aliases.find((a) => a.name === alias);
    if (match?.path) {
      const folder = String(match.path).replace(/[\\/]+$/, '');
      const dataRoot = path.dirname(folder);
      return getEdariConnection({
        ...overrides,
        alias,
        dataRoot: dataRoot || base.dataRoot
      });
    }
  }

  if (localYearFolderExists(base.dataRoot, CURRENT_EDARI_YEAR)) {
    alias = CURRENT_EDARI_YEAR;
  }
  return getEdariConnection({
    ...overrides,
    alias,
    dataRoot: base.dataRoot
  });
}

module.exports = {
  DEFAULT_EDARI,
  CURRENT_EDARI_YEAR,
  normalizeEdariAlias,
  getEdariConnection,
  connectionToEnv,
  fetchNxAliases,
  resolveLiveEdariConnection
};
