const path = require('path');
const { getEdariConnection } = require('./edari-connection');

function resolveEdariReaderRoot() {
  if (process.env.EDARI_READER_ROOT) return process.env.EDARI_READER_ROOT;
  return path.join(__dirname, '..', '..', '..', 'db', 'edari-reader');
}

let odbcBridge;
let odbcBridgeRoot;

function getOdbcBridge() {
  const root = resolveEdariReaderRoot();
  if (odbcBridge && odbcBridgeRoot === root) return odbcBridge;
  odbcBridgeRoot = root;
  odbcBridge = null;
  try {
    odbcBridge = require(path.join(root, 'lib', 'odbc-bridge'));
  } catch {
    odbcBridge = null;
  }
  return odbcBridge;
}

function requireOdbcBridge() {
  const bridge = getOdbcBridge();
  if (!bridge) {
    throw new Error(
      'Edari ODBC غير متوفر — تأكد من تشغيل EdariNX وتثبيت edari-reader، ثم أعد تشغيل تطبيق الإدارة على Windows'
    );
  }
  return bridge;
}

function resetOdbcBridgeCache() {
  odbcBridge = null;
  odbcBridgeRoot = null;
}

const MATERIAL_SELECT = `
  Seq, Num, Name1, Name2, Barcode, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5,
  DefUnit, Unt1, Bonus, Remarks, InTot, OutTot
`.replace(/\s+/g, ' ').trim();

/** Edari stores legacy wholesale in SellPr1 × 1000 (values above ~100k). */
function normalizeWholesalePrice(sellPr1) {
  const raw = Number(sellPr1 || 0);
  if (raw <= 0) return 0;
  if (raw > 100000) return Math.round(raw / 1000);
  return raw;
}

function wholesalePrice(sellPr1, _sellPr2, _sellPr3, sellPr5) {
  const w = normalizeWholesalePrice(sellPr1);
  if (w > 0) return w;
  const alt = Number(sellPr5 || 0);
  if (alt > 0) return alt;
  return 0;
}

/** نصف الجملة = SellPr2 فقط (عمود نصف الجملة في الإداري). */
function halfWholesalePrice(_sellPr1, sellPr2) {
  return Number(sellPr2 || 0);
}

function retailPrice(sellPr1, sellPr2, sellPr3, sellPr4, sellPr5) {
  const pr3 = Number(sellPr3 || 0);
  if (pr3 > 0) return pr3;
  const pr2 = Number(sellPr2 || 0);
  const pr4 = Number(sellPr4 || 0);
  if (pr4 > 0 && pr2 > 0 && pr4 > pr2) return pr4;
  const wholesale = wholesalePrice(sellPr1, sellPr2, sellPr3, sellPr5);
  return wholesale > 0 ? Math.round(wholesale * 1.5) : 0;
}

function stockQty(inTot, outTot) {
  return Number(inTot || 0) - Number(outTot || 0);
}

/** يفضّل رقم المادة (Num) عندما يكون باركود EAN طويلاً. */
function pickProductBarcode(num, barcode) {
  const n = String(num ?? '').trim();
  const b = String(barcode ?? '').trim();
  if (n.length >= 8 && /^\d+$/.test(n)) return n;
  if (b && b !== '0') return b;
  return n || b;
}

function mapEdariToShorjaProduct(material) {
  if (!material) return null;
  const halfWholesale = Number(material.halfWholesalePrice ?? material.sellPr2 ?? material.price ?? 0);
  const num = String(material.num ?? material.Num ?? '').trim();
  const edariBarcode = String(material.barcode ?? material.Barcode ?? '').trim();
  const scanCode = pickProductBarcode(num, edariBarcode);
  return {
    barcode: scanCode,
    sku: num || scanCode,
    name: String(material.name || material.name1 || material.Name1 || '').trim(),
    unit: String(material.unit || 'قطعة').trim() || 'قطعة',
    costPrice: 0,
    price: 0,
    priced: false,
    priceCurrency: 'iqd',
    edariHintPrice: halfWholesale,
    stockQty: Number(material.stockQty ?? material.qty ?? 0),
    category: '',
    edariSeq: String(material.seq || material.Seq || '')
  };
}

function mapMaterialRow(row) {
  if (!row) return null;
  const sellPr1 = Number(row.SellPr1 ?? 0);
  const sellPr2 = Number(row.SellPr2 ?? 0);
  const sellPr3 = Number(row.SellPr3 ?? 0);
  const sellPr4 = Number(row.SellPr4 ?? 0);
  const sellPr5 = Number(row.SellPr5 ?? 0);
  const inTot = Number(row.InTot ?? 0);
  const outTot = Number(row.OutTot ?? 0);
  const qty = stockQty(inTot, outTot);
  const unitRaw = String(row.Unt1 ?? row.DefUnit ?? '').trim();
  const unit = unitRaw && unitRaw !== '0' ? unitRaw : '';
  const wholesale = wholesalePrice(sellPr1, sellPr2, sellPr3, sellPr5);
  const halfWholesale = halfWholesalePrice(sellPr1, sellPr2);
  const retail = retailPrice(sellPr1, sellPr2, sellPr3, sellPr4, sellPr5);
  const scanBarcode = pickProductBarcode(row.Num ?? row.num, row.Barcode ?? row.barcode);
  return {
    seq: String(row.Seq ?? ''),
    num: String(row.Num ?? ''),
    barcode: scanBarcode,
    name: String(row.Name1 ?? ''),
    name1: String(row.Name1 ?? ''),
    name2: String(row.Name2 ?? ''),
    unit,
    sellPr1,
    sellPr2,
    sellPr3,
    sellPr4,
    sellPr5,
    priceRetail: retail,
    wholesalePrice: wholesale,
    halfWholesalePrice: halfWholesale,
    price: halfWholesale,
    bonus: Number(row.Bonus ?? 0),
    inTot,
    outTot,
    stockQty: qty,
    qty,
    remarks: String(row.Remarks ?? '')
  };
}

async function lookupEdariMaterial(code) {
  const odbc = requireOdbcBridge();

  const raw = String(code ?? '').trim();
  if (!raw) return null;

  const escaped = raw.replace(/'/g, "''");
  const conditions = [`Num = '${escaped}'`, `Barcode = '${escaped}'`];
  if (/^\d+$/.test(raw) && raw.length <= 10) {
    conditions.push(`Seq = ${raw}`);
  }

  const sql = `
    SELECT ${MATERIAL_SELECT}
    FROM File13n
    WHERE SubCount = 0 AND (${conditions.join(' OR ')})
  `;

  const result = await odbc.runQuery({ ...getEdariConnection(), sql });
  if (!result.ok) throw new Error(result.error || 'فشل الاتصال بـ Edari');
  if (!result.rows?.length) return null;
  return mapMaterialRow(result.rows[0]);
}

async function listEdariMaterials({ afterSeq = 0, limit = 500 } = {}) {
  const odbc = requireOdbcBridge();
  const batch = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const cursor = Math.max(Number(afterSeq) || 0, 0);
  const sql = `
    SELECT TOP ${batch} ${MATERIAL_SELECT}
    FROM File13n
    WHERE SubCount = 0 AND Seq > ${cursor}
    ORDER BY Seq
  `;
  const result = await odbc.runQuery({ ...getEdariConnection(), sql });
  if (!result.ok) throw new Error(result.error || 'فشل جلب المواد من Edari');
  const rows = (result.rows || []).map(mapMaterialRow).filter(Boolean);
  const lastSeq = rows.length ? Number(rows[rows.length - 1].seq || 0) : cursor;
  return { rows, lastSeq, hasMore: rows.length >= batch };
}

async function countEdariMaterials() {
  const odbc = requireOdbcBridge();
  const result = await odbc.runQuery({
    ...getEdariConnection(),
    sql: 'SELECT COUNT(*) AS c FROM File13n WHERE SubCount = 0'
  });
  if (!result.ok) throw new Error(result.error || 'فشل عد المواد');
  return Number(result.rows?.[0]?.c ?? result.rows?.[0]?.C ?? 0);
}

function shorjaStoreName() {
  return String(process.env.EDARI_SHORJA_STORE_NAME || 'محل الشورجه').trim();
}

function normalizeArName(s) {
  return String(s || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\u0640/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function scoreWarehouseName(name, target) {
  const n = normalizeArName(name);
  const t = normalizeArName(target);
  if (!n || n.includes('شورجل')) return 0;
  if (t && n === t) return 100;
  if (t && n.includes(t)) return 90;
  if (n.includes('محلالشورجه') || n.includes('مستودعالشورجه') || n.includes('مخزنالشورجه')) return 80;
  if (n.includes('الشورجه') && (n.includes('محل') || n.includes('مستودع') || n.includes('مخزن'))) return 70;
  return 0;
}

function pickBestNamedRow(rows, target) {
  let best = null;
  let bestScore = 0;
  for (const row of rows || []) {
    const name = String(row.Name1 ?? row.name1 ?? '');
    const score = scoreWarehouseName(name, target);
    if (score > bestScore) {
      bestScore = score;
      best = {
        seq: Number(row.Seq ?? row.seq ?? 0),
        num: String(row.Num ?? row.num ?? '').trim(),
        name
      };
    }
  }
  return bestScore >= 70 ? best : null;
}

function isFatalEdariError(err) {
  const m = String(err?.message || err || '');
  return /غير متوفر|odbc driver|trial expired|timed out|timeout|connection refused|فشل الاتصال بـ Edari|Edari ODBC غير متوفر/i.test(m);
}

async function runEdariSql(sql) {
  const odbc = requireOdbcBridge();
  const result = await odbc.runQuery({ ...getEdariConnection(), sql });
  if (!result.ok) throw new Error(result.error || 'فشل الاتصال بـ Edari');
  const rows = result.rows || [];
  if (!rows.length) return [];
  if (!Array.isArray(rows[0])) return rows;
  const cols = result.columns || [];
  return rows.map((row) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

async function tryEdariSql(sql) {
  try {
    return await runEdariSql(sql);
  } catch (err) {
    if (isFatalEdariError(err)) throw err;
    return null;
  }
}

function detectMatStoreColumns(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const lower = Object.fromEntries(keys.map((k) => [String(k).toLowerCase(), k]));
  return {
    mat: lower.mat || lower.material || lower.matseq || lower.item || 'Mat',
    store: lower.store || lower.stor || lower.storeseq || lower.whouse || lower.warehouse || lower.place || 'Store'
  };
}

function extractPascalArabicNames(raw) {
  const s = String(raw || '');
  const names = [];
  for (let i = 0; i < s.length; i++) {
    const len = s.charCodeAt(i);
    if (len < 2 || len > 48 || i + len >= s.length) continue;
    const piece = s.slice(i + 1, i + 1 + len);
    if (/[\u0000-\u0008]/.test(piece)) continue;
    if (!/[\u0600-\u06FF]/.test(piece)) continue;
    if (!/^[\u0600-\u06FF0-9A-Za-z ._\-]+$/.test(piece)) continue;
    names.push(piece.trim());
    i += len;
  }
  const loose = s.match(/[\u0600-\u06FF][\u0600-\u06FF0-9A-Za-z ]{1,40}/g) || [];
  for (const piece of loose) {
    const name = piece.trim();
    if (name.length >= 2) names.push(name);
  }
  return [...new Set(names.filter(Boolean))];
}

async function readFile16nSdefs() {
  try {
    const { runQuery, rowObjects } = require('./edari-bridge');
    const r = await runQuery('SELECT SDefs FROM File16n');
    if (r?.ok) {
      const rows = rowObjects(r);
      const raw = rows[0]?.SDefs ?? rows[0]?.sdefs ?? '';
      if (raw) return String(raw);
    }
    return String(r?.error || '');
  } catch (e) {
    return String(e?.message || e || '');
  }
}

async function listEdariNamedStores() {
  const raw = await readFile16nSdefs();
  return extractPascalArabicNames(raw).map((name, i) => ({
    seq: i + 1,
    num: String(i + 1),
    name,
    table: 'File16n.SDefs'
  }));
}

async function findStoreRecord(target) {
  const stores = await listEdariNamedStores();
  const hit = pickBestNamedRow(stores.map((s) => ({ Seq: s.seq, Num: s.num, Name1: s.name })), target);
  if (!hit) return null;
  const matched = stores.find((s) => s.name === hit.name) || stores[hit.seq - 1];
  return matched ? { ...matched } : { ...hit, table: 'File16n.SDefs' };
}

async function findMaterialFolder(target) {
  const folders = [];
  let after = 0;
  for (let i = 0; i < 40; i++) {
    const rows = await tryEdariSql(
      `SELECT TOP 200 Seq, Num, Name1, Father, SubCount FROM File13n WHERE SubCount > 0 AND Seq > ${after} ORDER BY Seq`
    );
    if (!rows?.length) break;
    folders.push(...rows);
    after = Number(rows[rows.length - 1].Seq ?? rows[rows.length - 1].seq ?? after);
    if (rows.length < 200) break;
  }
  return pickBestNamedRow(folders, target);
}

async function collectDescendantFolderSeqs(rootSeq) {
  const root = Number(rootSeq) || 0;
  if (!root) return [];
  const all = [root];
  const seen = new Set(all);
  let queue = [root];
  while (queue.length) {
    const batch = queue.splice(0, 40);
    const rows = await tryEdariSql(
      `SELECT Seq FROM File13n WHERE SubCount > 0 AND Father IN (${batch.join(',')})`
    );
    if (!rows) break;
    for (const row of rows) {
      const seq = Number(row.Seq ?? row.seq ?? 0);
      if (!seq || seen.has(seq)) continue;
      seen.add(seq);
      all.push(seq);
      queue.push(seq);
    }
    if (all.length > 2000) break;
  }
  return all;
}

function sqlScalar(value) {
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function detectStoreAccess(store) {
  const sample = await tryEdariSql('SELECT TOP 1 * FROM FileMtD');
  if (sample?.[0]) {
    const cols = detectMatStoreColumns(sample[0]);
    const conds = [`${cols.store} = ${Number(store.seq)}`];
    if (store.num) {
      conds.push(`${cols.store} = ${sqlScalar(store.num)}`);
      if (/^\d+$/.test(store.num) && Number(store.num) !== Number(store.seq)) {
        conds.push(`${cols.store} = ${Number(store.num)}`);
      }
    }
    if (store.name) conds.push(`${cols.store} = ${sqlScalar(store.name)}`);
    const storeCond = conds.join(' OR ');
    const probe = await tryEdariSql(
      `SELECT TOP 1 ${cols.mat} AS Mat FROM FileMtD WHERE ${storeCond}`
    );
    if (probe?.length) {
      return { mode: 'filemtd', matCol: cols.mat, storeCond };
    }
  }

  for (const column of ['Store']) {
    const candidates = [Number(store.seq)];
    if (store.num) candidates.push(store.num);
    if (/^\d+$/.test(store.num) && Number(store.num) !== Number(store.seq)) {
      candidates.push(Number(store.num));
    }
    if (store.name) candidates.push(store.name);
    for (const value of candidates) {
      const rows = await tryEdariSql(
        `SELECT TOP 1 Seq FROM File13n WHERE SubCount = 0 AND ${column} = ${sqlScalar(value)}`
      );
      if (rows?.length) {
        return { mode: 'file13', column, storeValueSql: sqlScalar(value) };
      }
    }
  }
  return null;
}

function serializeWarehouse(warehouse) {
  if (!warehouse) return null;
  return {
    name: warehouse.name,
    target: warehouse.target,
    source: warehouse.source,
    store: warehouse.store || null,
    folder: warehouse.folder || null
  };
}

async function resolveShorjaWarehouse() {
  const target = shorjaStoreName();
  const namedStores = await listEdariNamedStores();
  const store = await findStoreRecord(target);
  const folder = await findMaterialFolder(target);
  if (!store && !folder) {
    const listed = namedStores.map((s) => s.name).filter(Boolean);
    const extra = listed.length ? ` المخازن الحالية في الإداري: ${listed.join('، ')}.` : '';
    throw new Error(
      `لم يُعثر على مستودع «${target}» في الإداري.${extra} سمِّ المخزن أو مجموعة المواد بهذا الاسم ثم أعد الجلب.`
    );
  }

  const storeAccess = store ? await detectStoreAccess(store) : null;
  const folderSeqs = folder ? await collectDescendantFolderSeqs(folder.seq) : null;
  const source = storeAccess ? 'store' : 'folder';
  if (source === 'folder' && !folder) {
    throw new Error(
      `وُجد المخزن «${store.name}» لكن لا توجد مواد مرتبطة به في حركة المخازن. انقل المواد إلى هذا المستودع أو ضعها في مجموعة مواد بنفس الاسم.`
    );
  }

  const chosen = source === 'store' ? store : folder;
  return {
    name: chosen.name || target,
    target,
    source,
    store: store ? { ...store, access: storeAccess } : null,
    folder: folder ? { ...folder, folderSeqs } : null
  };
}

function warehouseWhereSql(warehouse, afterSeq = 0) {
  const cursor = Math.max(Number(afterSeq) || 0, 0);
  if (warehouse?.source === 'store' && warehouse.store?.access) {
    const access = warehouse.store.access;
    if (access.mode === 'file13') {
      return `SubCount = 0 AND Seq > ${cursor} AND ${access.column} = ${access.storeValueSql}`;
    }
    if (access.mode === 'filemtd') {
      return `SubCount = 0 AND Seq > ${cursor} AND Seq IN (SELECT DISTINCT ${access.matCol} FROM FileMtD WHERE ${access.storeCond})`;
    }
  }
  const seqs = (warehouse?.folder?.folderSeqs || []).map(Number).filter((n) => n > 0);
  if (!seqs.length && warehouse?.folder?.seq) seqs.push(Number(warehouse.folder.seq));
  if (!seqs.length) {
    throw new Error('لا توجد مجموعة مواد لمستودع محل الشورجه');
  }
  return `SubCount = 0 AND Seq > ${cursor} AND Father IN (${seqs.join(',')})`;
}

async function listEdariWarehouseMaterials({ afterSeq = 0, limit = 500, warehouse = null } = {}) {
  const wh = warehouse || await resolveShorjaWarehouse();
  const batch = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const sql = `
    SELECT TOP ${batch} ${MATERIAL_SELECT}
    FROM File13n
    WHERE ${warehouseWhereSql(wh, afterSeq)}
    ORDER BY Seq
  `;
  const rows = (await runEdariSql(sql)).map(mapMaterialRow).filter(Boolean);
  const lastSeq = rows.length ? Number(rows[rows.length - 1].seq || 0) : Math.max(Number(afterSeq) || 0, 0);
  return {
    rows,
    lastSeq,
    hasMore: rows.length >= batch,
    warehouse: serializeWarehouse(wh)
  };
}

async function countEdariWarehouseMaterials(warehouse = null) {
  const wh = warehouse || await resolveShorjaWarehouse();
  const rows = await runEdariSql(
    `SELECT COUNT(*) AS c FROM File13n WHERE ${warehouseWhereSql(wh, 0)}`
  );
  return Number(rows[0]?.c ?? rows[0]?.C ?? 0);
}

module.exports = {
  lookupEdariMaterial,
  listEdariMaterials,
  countEdariMaterials,
  resolveShorjaWarehouse,
  listEdariWarehouseMaterials,
  countEdariWarehouseMaterials,
  listEdariNamedStores,
  serializeWarehouse,
  shorjaStoreName,
  mapMaterialRow,
  normalizeWholesalePrice,
  wholesalePrice,
  halfWholesalePrice,
  retailPrice,
  stockQty,
  pickProductBarcode,
  mapEdariToShorjaProduct,
  MATERIAL_SELECT,
  resetOdbcBridgeCache
};
