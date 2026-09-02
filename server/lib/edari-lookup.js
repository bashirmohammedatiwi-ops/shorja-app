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

/** نصف الجملة: SellPr2، أو SellPr4 للمواد القديمة التي لا تحتوي SellPr2. */
function halfWholesalePrice(sellPr1, sellPr2, _sellPr3, sellPr4, sellPr5) {
  const pr2 = Number(sellPr2 || 0);
  if (pr2 > 0) return pr2;
  const pr4 = Number(sellPr4 || 0);
  if (pr4 > 0) return pr4;
  const pr5 = Number(sellPr5 || 0);
  const wholesale = wholesalePrice(sellPr1, sellPr2, _sellPr3, sellPr5);
  if (pr5 > 0 && pr5 !== wholesale) return pr5;
  return wholesale;
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
  const halfWholesale = halfWholesalePrice(sellPr1, sellPr2, sellPr3, sellPr4, sellPr5);
  const retail = retailPrice(sellPr1, sellPr2, sellPr3, sellPr4, sellPr5);
  return {
    seq: String(row.Seq ?? ''),
    num: String(row.Num ?? ''),
    barcode: String(row.Barcode || row.Num || '').trim(),
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
  const conditions = [`Num = '${escaped}'`];
  if (/^\d+$/.test(raw) && raw.length <= 10) {
    conditions.push(`Seq = ${raw}`);
  }
  if (!/^\d+$/.test(raw)) {
    conditions.push(`Barcode = '${escaped}'`);
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

module.exports = {
  lookupEdariMaterial,
  listEdariMaterials,
  countEdariMaterials,
  mapMaterialRow,
  normalizeWholesalePrice,
  wholesalePrice,
  halfWholesalePrice,
  retailPrice,
  stockQty,
  MATERIAL_SELECT,
  resetOdbcBridgeCache
};
