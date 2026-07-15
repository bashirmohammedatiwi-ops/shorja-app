#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery(`SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Num = '12106' OR Num = '1210660287'`);
  console.log('12106:', JSON.stringify(rowObjects(r), null, 2));

  const p = rowObjects(await runQuery(`SELECT Seq FROM File11n WHERE Num = '12106'`))[0];
  if (p) {
    const kids = await runQuery(`SELECT Seq, Num, Name1 FROM File11n WHERE Master = ${Number(p.Seq)} ORDER BY Num`);
    const rows = rowObjects(kids);
    console.log('children count:', rows.length);
    console.log('first 5:', rows.slice(0, 5));
    console.log('last 5:', rows.slice(-5));
    const nums = rows.map((x) => String(x.Num));
    const max = nums.slice().sort((a, b) => a.localeCompare(b)).pop();
    console.log('MAX string:', max);
  }

  const fields = await runQuery(`SELECT * FROM #fields WHERE TABLE_NAME = 'FileSrNr'`);
  console.log('\nFileSrNr fields:', JSON.stringify(rowObjects(fields), null, 2));

  const sr = await runQuery('SELECT COUNT(*) AS c FROM FileSrNr');
  console.log('FileSrNr count:', rowObjects(sr));

  const tables = await runQuery(`SELECT TABLE_NAME, RECORD_COUNT, IS_INSERTABLE_INTO, OPEN_CURSORS FROM #tables WHERE TABLE_NAME IN ('File11n','FileSrNr','File17n')`);
  console.log('\ntables:', JSON.stringify(rowObjects(tables), null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
