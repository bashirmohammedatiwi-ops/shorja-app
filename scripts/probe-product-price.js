#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');
const { mapMaterialRow } = require('../server/lib/edari-lookup');
const { mapEdariToShorjaProduct } = require('../server/lib/edari-materials');

const BARCODE = process.argv[2] || '8057190176680';

(async () => {
  const r = await runQuery(`
    SELECT Seq, Num, Name1, Barcode, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5
    FROM File13n
    WHERE Barcode = '${BARCODE}' OR Num = '${BARCODE}'
  `);
  const row = rowObjects(r)[0];
  if (!row) {
    console.log('not found');
    return;
  }
  console.log('Edari raw:', JSON.stringify(row, null, 2));
  const m = mapMaterialRow(row);
  console.log('mapped material:', JSON.stringify({
    wholesale: m.wholesalePrice,
    halfWholesale: m.halfWholesalePrice,
    retail: m.priceRetail,
    sellPr1: m.sellPr1,
    sellPr2: m.sellPr2,
    sellPr3: m.sellPr3,
    sellPr4: m.sellPr4,
    sellPr5: m.sellPr5
  }, null, 2));
  console.log('Shorja product:', JSON.stringify(mapEdariToShorjaProduct(m), null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
