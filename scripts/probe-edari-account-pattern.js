#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

async function q(label, sql) {
  const r = await runQuery(sql);
  console.log(`\n=== ${label} ===`);
  if (!r.ok) {
    console.log('ERR:', String(r.error).slice(0, 600));
    return [];
  }
  console.log(JSON.stringify(rowObjects(r), null, 2));
  return rowObjects(r);
}

(async () => {
  const fields = 'Seq, Num, Name1, Master, SubCount, Cod, Dest, Dept, Prefix, Sufix, SelType, PayTypeIdx, BalSee, CloseAcc';
  await q('parent 12109', `SELECT ${fields} FROM File11n WHERE Num = '12109'`);
  await q('child 121091', `SELECT ${fields} FROM File11n WHERE Num = '121091'`);
  await q('child 1210104', `SELECT ${fields} FROM File11n WHERE Num = '1210104'`);
  await q('child 121098', `SELECT ${fields} FROM File11n WHERE Num = '121098'`);
  await q('sibling parent 12110', `SELECT ${fields} FROM File11n WHERE Num = '12110'`);
  await q('child under 12110 sample', `SELECT ${fields} FROM File11n WHERE Master = 2093 ORDER BY Num`);
})().catch((e) => { console.error(e); process.exit(1); });
