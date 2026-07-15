#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const queries = [
    ['dup nums', 'SELECT Num, COUNT(*) AS c FROM File11n GROUP BY Num HAVING COUNT(*) > 1'],
    ['dup seqs', 'SELECT Seq, COUNT(*) AS c FROM File11n GROUP BY Seq HAVING COUNT(*) > 1'],
    ['nums 121091*', "SELECT Seq, Num, Name1 FROM File11n WHERE Num LIKE '121091%' ORDER BY Num"],
    ['next suggested num', "SELECT MAX(Num) AS maxNum FROM File11n WHERE Master = 2166"],
    ['info tables', 'SELECT TOP 10 * FROM #tables'],
    ['info columns FileSrNr', "SELECT * FROM #fields WHERE tablename = 'FileSrNr'"],
    ['info columns filesrnr lower', "SELECT * FROM #fields WHERE LOWER(tablename) = 'filesrnr'"]
  ];
  for (const [label, sql] of queries) {
    const r = await runQuery(sql);
    console.log(`\n=== ${label} ===`);
    if (!r.ok) console.log(String(r.error).slice(0, 400));
    else console.log(JSON.stringify(rowObjects(r), null, 2));
  }
})().catch((e) => { console.error(e); process.exit(1); });
