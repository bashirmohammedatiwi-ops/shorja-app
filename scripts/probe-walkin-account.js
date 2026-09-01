#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery(`
    SELECT Seq, Num, Name1, Master, SubCount
    FROM File11n
    WHERE Num = '121119002' OR Num IN ('121119001', '121119002', '121119003')
    ORDER BY Num
  `);
  console.log(JSON.stringify(rowObjects(r), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
