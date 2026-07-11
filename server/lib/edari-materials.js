const db = require('../db');
const { wholesalePrice, stockQty } = require('./edari-lookup');

function mapEdariMaterial(row) {
  if (!row) return null;
  const sellPr1 = Number(row.sell_pr1 ?? row.SellPr1 ?? row.sellPr1 ?? 0);
  const sellPr2 = Number(row.sell_pr2 ?? row.SellPr2 ?? 0);
  const sellPr3 = Number(row.sell_pr3 ?? row.SellPr3 ?? 0);
  const sellPr5 = Number(row.sell_pr5 ?? row.SellPr5 ?? 0);
  const inTot = Number(row.in_tot ?? row.InTot ?? row.inTot ?? 0);
  const outTot = Number(row.out_tot ?? row.OutTot ?? row.outTot ?? 0);
  const qty = stockQty(inTot, outTot);
  const wholesale = wholesalePrice(sellPr1, sellPr2, sellPr3, sellPr5);
  return {
    seq: String(row.seq || row.Seq || ''),
    num: String(row.num || row.Num || ''),
    barcode: String(row.barcode || row.Barcode || row.num || row.Num || '').trim(),
    name: String(row.name1 || row.Name1 || row.name || ''),
    name1: String(row.name1 || row.Name1 || row.name || ''),
    name2: String(row.name2 || row.Name2 || ''),
    unit: String(row.unit || row.DefUnit || row.Unt1 || '').trim(),
    sellPr1,
    sellPr2,
    sellPr3,
    sellPr5,
    priceRetail: sellPr1,
    wholesalePrice: wholesale,
    price: wholesale,
    bonus: Number(row.bonus ?? row.Bonus ?? 0),
    inTot,
    outTot,
    stockQty: qty,
    qty,
    remarks: String(row.remarks || row.Remarks || ''),
    syncedAt: row.synced_at || ''
  };
}

function mapEdariToShorjaProduct(material) {
  if (!material) return null;
  const wholesale = Number(material.wholesalePrice ?? material.price ?? material.sellPr1 ?? 0);
  const retail = Number(material.priceRetail ?? material.sellPr1 ?? wholesale);
  return {
    barcode: String(material.barcode || material.num || '').trim(),
    sku: String(material.num || '').trim(),
    name: String(material.name || material.name1 || '').trim(),
    unit: String(material.unit || 'قطعة').trim() || 'قطعة',
    costPrice: wholesale,
    price: retail,
    stockQty: Number(material.stockQty ?? material.qty ?? 0),
    category: '',
    edariSeq: String(material.seq || '')
  };
}

function normalizeCode(code) {
  return String(code ?? '').trim();
}

function findEdariMaterialByCode(code) {
  const raw = normalizeCode(code);
  if (!raw) return null;
  const row = db.prepare(`
    SELECT * FROM edari_materials
    WHERE seq = ? OR num = ? OR barcode = ?
    ORDER BY
      CASE
        WHEN barcode = ? THEN 0
        WHEN num = ? THEN 1
        WHEN seq = ? THEN 2
        ELSE 3
      END
    LIMIT 1
  `).get(raw, raw, raw, raw, raw, raw);
  return row ? mapEdariMaterial(row) : null;
}

function cacheEdariMaterial(material) {
  if (!material?.seq && !material?.num) return null;
  const parsed = {
    seq: String(material.seq || material.Seq || ''),
    num: String(material.num || material.Num || ''),
    barcode: String(material.barcode || material.Barcode || material.num || material.Num || '').trim(),
    name1: String(material.name || material.name1 || material.Name1 || ''),
    name2: String(material.name2 || material.Name2 || ''),
    unit: String(material.unit || material.Unt1 || material.DefUnit || ''),
    sellPr1: Number(material.sellPr1 ?? material.SellPr1 ?? material.priceRetail ?? 0),
    sellPr2: Number(material.sellPr2 ?? material.SellPr2 ?? 0),
    sellPr3: Number(material.sellPr3 ?? material.SellPr3 ?? 0),
    sellPr5: Number(material.sellPr5 ?? material.SellPr5 ?? 0),
    bonus: Number(material.bonus ?? material.Bonus ?? 0),
    inTot: Number(material.inTot ?? material.InTot ?? 0),
    outTot: Number(material.outTot ?? material.OutTot ?? 0),
    remarks: String(material.remarks || material.Remarks || '')
  };
  if (!parsed.seq) parsed.seq = parsed.num;
  if (!parsed.seq || !parsed.name1) return null;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO edari_materials
      (seq, num, barcode, name1, name2, unit, sell_pr1, sell_pr2, sell_pr3, sell_pr5, bonus, in_tot, out_tot, remarks, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(seq) DO UPDATE SET
      num = excluded.num,
      barcode = excluded.barcode,
      name1 = excluded.name1,
      name2 = excluded.name2,
      unit = excluded.unit,
      sell_pr1 = excluded.sell_pr1,
      sell_pr2 = excluded.sell_pr2,
      sell_pr3 = excluded.sell_pr3,
      sell_pr5 = excluded.sell_pr5,
      bonus = excluded.bonus,
      in_tot = excluded.in_tot,
      out_tot = excluded.out_tot,
      remarks = excluded.remarks,
      synced_at = excluded.synced_at
  `).run(
    parsed.seq,
    parsed.num,
    parsed.barcode || parsed.num,
    parsed.name1,
    parsed.name2,
    parsed.unit,
    parsed.sellPr1,
    parsed.sellPr2,
    parsed.sellPr3,
    parsed.sellPr5,
    parsed.bonus,
    parsed.inTot,
    parsed.outTot,
    parsed.remarks,
    now
  );
  return findEdariMaterialByCode(parsed.barcode || parsed.num || parsed.seq);
}

async function resolveEdariMaterial(code) {
  const raw = normalizeCode(code);
  if (!raw) return null;

  try {
    const { lookupEdariMaterial } = require('./edari-lookup');
    const live = await lookupEdariMaterial(raw);
    if (live) return cacheEdariMaterial(live);
  } catch {
    /* ODBC unavailable — use cache */
  }

  return findEdariMaterialByCode(raw);
}

module.exports = {
  mapEdariMaterial,
  mapEdariToShorjaProduct,
  findEdariMaterialByCode,
  cacheEdariMaterial,
  resolveEdariMaterial
};
