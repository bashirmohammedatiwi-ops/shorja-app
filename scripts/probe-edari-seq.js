#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const seqField = await runQuery(`SELECT FIELD_NAME, FIELD_TYPE_SQL, FIELD_TYPE_NEXUS FROM #fields WHERE TABLE_NAME='File11n' AND FIELD_NAME='Seq'`);
  console.log('Seq field:', rowObjects(seqField));

  const tbl = await runQuery(`SELECT TABLE_NAME, RECORD_COUNT, AUTOINC_STARTING_VALUE, AUTOINC_INCREMENT_VALUE FROM #tables WHERE TABLE_NAME='File11n'`);
  console.log('table:', rowObjects(tbl));

  const test = await runQuery(`SELECT Seq, Num, Name1, Master FROM File11n WHERE Seq >= 2195 ORDER BY Seq`);
  console.log('recent seqs:', rowObjects(test));

  const dup2198 = await runQuery(`SELECT COUNT(*) AS c FROM File11n WHERE Seq = 2198`);
  console.log('seq 2198 count:', rowObjects(dup2198));
})().catch((e) => { console.error(e); process.exit(1); });
