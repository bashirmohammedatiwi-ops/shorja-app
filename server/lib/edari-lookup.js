const path = require('path');
const { getEdariConnection } = require('./edari-connection');

const edariRoot = process.env.EDARI_READER_ROOT
  || path.join(__dirname, '..', '..', '..', 'db', 'edari-reader');

let odbcBridge;
try {
  odbcBridge = require(path.join(edariRoot, 'lib', 'odbc-bridge'));
} catch {
  odbcBridge = null;
}

const MATERIAL_SELECT = `
  Seq, Num, Name1, Name2, Barcode, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5,
  DefUnit, Unt1, Bonus, Remarks, InTot, OutTot
`.replace(/\s+/g, ' ').trim();

function wholesalePrice(sellPr1, _sellPr2, _sellPr3, sellPr5) {
  const w = Number(sellPr1);
  if (w > 0) return w;
  const alt = Number(sellPr5);
  if (alt > 0) return alt;
  return 0;
}

function stockQty(inTot, outTot) {
  return Number(inTot || 0) - Number(outTot || 0);
}

function mapMaterialRow(row) {
  if (!row) return null;
  const sellPr1 = Number(row.SellPr1 ?? 0);
  const sellPr2 = Number(row.SellPr2 ?? 0);
  const sellPr3 = Number(row.SellPr3 ?? 0);
  const sellPr5 = Number(row.SellPr5 ?? 0);
  const inTot = Number(row.InTot ?? 0);
  const outTot = Number(row.OutTot ?? 0);
  const qty = stockQty(inTot, outTot);
  const unitRaw = String(row.Unt1 ?? row.DefUnit ?? '').trim();
  const unit = unitRaw && unitRaw !== '0' ? unitRaw : '';
  const wholesale = wholesalePrice(sellPr1, sellPr2, sellPr3, sellPr5);
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
    sellPr5,
    priceRetail: sellPr1,
    wholesalePrice: wholesale,
    price: wholesale,
    bonus: Number(row.Bonus ?? 0),
    inTot,
    outTot,
    stockQty: qty,
    qty,
    remarks: String(row.Remarks ?? '')
  };
}

async function lookupEdariMaterial(code) {
  if (!odbcBridge) {
    throw new Error('Edari ODBC غير متوفر على هذا السيرفر — استخدم تطبيق الإدارة على Windows');
  }

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

  const result = await odbcBridge.runQuery({ ...getEdariConnection(), sql });
  if (!result.ok) throw new Error(result.error || 'فشل الاتصال بـ Edari');
  if (!result.rows?.length) return null;
  return mapMaterialRow(result.rows[0]);
}

module.exports = {
  lookupEdariMaterial,
  mapMaterialRow,
  wholesalePrice,
  stockQty
};
