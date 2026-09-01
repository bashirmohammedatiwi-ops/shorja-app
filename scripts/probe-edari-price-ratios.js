#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery(`
    SELECT TOP 20 Seq, SellPr1, SellPr2, SellPr4, SellPr5,
      CAST(SellPr4 AS FLOAT) / NULLIF(CAST(SellPr1 AS FLOAT) / 1000.0, 0) AS ratio_pr4_to_w
    FROM File13n
    WHERE SubCount = 0 AND SellPr2 = 0 AND SellPr1 > 100000 AND SellPr4 > 0
    ORDER BY Seq
  `);
  console.log('legacy ratios:', JSON.stringify(rowObjects(r), null, 2));

  const r2 = await runQuery(`
    SELECT TOP 20 Seq, SellPr1, SellPr2, SellPr4,
      CAST(SellPr2 AS FLOAT) / NULLIF(CAST(SellPr1 AS FLOAT), 0) AS ratio_pr2_to_pr1
    FROM File13n
    WHERE SubCount = 0 AND SellPr2 > 0 AND SellPr1 > 0
    ORDER BY Seq
  `);
  console.log('pr2 ratios:', JSON.stringify(rowObjects(r2), null, 2));

  const cnt = await runQuery(`
    SELECT
      SUM(CASE WHEN SellPr2 > 0 THEN 1 ELSE 0 END) AS has_pr2,
      SUM(CASE WHEN SellPr2 = 0 AND SellPr1 > 100000 THEN 1 ELSE 0 END) AS legacy_scaled,
      SUM(CASE WHEN SellPr2 = 0 AND SellPr1 <= 100000 AND SellPr1 > 0 THEN 1 ELSE 0 END) AS direct_pr1,
      COUNT(*) AS total
    FROM File13n WHERE SubCount = 0
  `);
  console.log('counts:', rowObjects(cnt)[0]);
})().catch((e) => { console.error(e); process.exit(1); });
