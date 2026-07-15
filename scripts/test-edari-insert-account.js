#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
const { runQuery, runExecute, rowObjects } = require('../server/lib/edari-bridge');
const { ensureExecuteScriptDeployed, runTreeRepairViaNxscript } = require('../server/lib/edari-nxscript');

(async () => {
  ensureExecuteScriptDeployed();

  const mism = await runQuery(`
    SELECT p.Seq, p.Num, p.SubCount,
      (SELECT COUNT(*) FROM File11n c WHERE c.Master = p.Seq) AS actual
    FROM File11n p
    WHERE p.SubCount != (SELECT COUNT(*) FROM File11n c WHERE c.Master = p.Seq)
  `);
  console.log('SubCount mismatches:', rowObjects(mism).length);

  const maxSeq = rowObjects(await runQuery('SELECT MAX(Seq) AS m FROM File11n'))[0]?.m;
  const testSeq = Number(maxSeq) + 1;
  const testNum = '9999999991';

  console.log(`\nTest INSERT Seq=${testSeq} Num=${testNum}...`);
  const ins = await runExecute(`INSERT INTO File11n (Seq, Num, Name1, Master, SubCount, Bal, Tot1, Tot2, Dept, Cod, Dest)
    VALUES (${testSeq}, '${testNum}', 'SHORJA_TEST_DELETE', 2193, 0, 0, 0, 0, 0, 1, 4)`);
  console.log('INSERT:', ins);

  if (ins.ok) {
    const chk = rowObjects(await runQuery(`SELECT Seq, Num, Name1 FROM File11n WHERE Seq = ${testSeq}`));
    console.log('verify:', chk);
    // لا يمكن حذف File11n عبر maintenance — نترك للمستخدم حذفه من الإداري إن ظهر
    console.log('\n⚠ سجّل اختبار — احذفه من الإداري إن ظهر (Seq', testSeq + ')');
  }

  const f17 = await runQuery('SELECT * FROM File17n');
  console.log('\nFile17n:', rowObjects(f17));
})().catch((e) => { console.error(e); process.exit(1); });
