#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const cols = await runQuery(`
    SELECT FIELD_NAME FROM #fields
    WHERE TABLE_NAME = 'File13n'
      AND (FIELD_NAME LIKE '%Pr%' OR FIELD_NAME LIKE '%Price%' OR FIELD_NAME LIKE '%Sell%')
    ORDER BY FIELD_NAME
  `);
  console.log('price fields:', rowObjects(cols).map((r) => r.FIELD_NAME).join(', '));

  const samples = await runQuery(`
    SELECT TOP 8 Seq, Num, Name1, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5
    FROM File13n WHERE SubCount = 0 AND SellPr2 > 0 AND SellPr4 > 0
    ORDER BY Seq
  `);
  console.log('\nwith SellPr2:', JSON.stringify(rowObjects(samples), null, 2));

  const noPr2 = await runQuery(`
    SELECT TOP 8 Seq, Num, Name1, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5
    FROM File13n WHERE SubCount = 0 AND SellPr2 = 0 AND SellPr4 > 0 AND SellPr1 > 0
    ORDER BY Seq
  `);
  console.log('\nwithout SellPr2:', JSON.stringify(rowObjects(noPr2), null, 2));

  for (const seq of [8, 89292, 85131]) {
    const r = await runQuery(`SELECT TOP 1 Seq, Num, SellPr1, SellPr2, SellPr3, SellPr4, SellPr5, PrUnit FROM File13n WHERE Seq = ${seq}`);
    console.log(`\nseq ${seq}:`, rowObjects(r)[0]);
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
