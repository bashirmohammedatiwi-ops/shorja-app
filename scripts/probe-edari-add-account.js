#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

async function q(label, sql) {
  const r = await runQuery(sql);
  console.log(`\n=== ${label} ===`);
  if (!r.ok) {
    console.log('ERR:', String(r.error).slice(0, 500));
    return [];
  }
  const rows = rowObjects(r);
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}

(async () => {
  await q('FileSrNr count', 'SELECT COUNT(*) AS c FROM FileSrNr');
  await q('FileSrNr all', 'SELECT * FROM FileSrNr');
  await q('tables like FileSr%', "SELECT TOP 20 * FROM File10n");

  const child = await q('sample child 121098 fields', `SELECT TOP 1 * FROM File11n WHERE Num = '121098'`);
  const parent = await q('parent 12109 fields', `SELECT TOP 1 * FROM File11n WHERE Num = '12109'`);

  if (child[0]) {
    console.log('\n=== child columns ===');
    console.log(Object.keys(child[0]).join(', '));
  }

  await q('next num candidates', `SELECT Seq, Num FROM File11n WHERE Master = 2166 AND Num >= '1210100' ORDER BY Num DESC`);
  await q('max child num under 12109', `SELECT MAX(Num) AS maxNum FROM File11n WHERE Master = 2166`);
})().catch((e) => { console.error(e); process.exit(1); });
