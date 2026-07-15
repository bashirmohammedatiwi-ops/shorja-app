#!/usr/bin/env node
/**
 * تشخيص استقرار شجرة الحسابات File11n في Edari الأصلي.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

async function q(label, sql) {
  const r = await runQuery(sql);
  console.log(`\n=== ${label} ===`);
  if (!r.ok) {
    console.log('ERR:', String(r.error).slice(0, 600));
    return [];
  }
  const rows = rowObjects(r);
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}

(async () => {
  await q('FileSrNr (counters)', 'SELECT * FROM FileSrNr ORDER BY Tbl');
  await q('maxSeq File11n', 'SELECT MAX(Seq) AS maxSeq, COUNT(*) AS total FROM File11n');
  await q('duplicate Seq File11n', 'SELECT Seq, COUNT(*) AS c FROM File11n GROUP BY Seq HAVING COUNT(*) > 1');
  await q('duplicate Num File11n', 'SELECT Num, COUNT(*) AS c FROM File11n GROUP BY Num HAVING COUNT(*) > 1');

  const parent12111 = await q('parent 12111', `SELECT Seq, Num, Name1, Master, SubCount, Sub FROM File11n WHERE Num = '12111'`);
  const pSeq = parent12111[0] ? Number(parent12111[0].Seq ?? parent12111[0].seq) : 0;
  if (pSeq) {
    const kids = await q(`children of 12111 (Master=${pSeq})`, `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Master = ${pSeq} ORDER BY Seq`);
    const actual = kids.length;
    const reported = Number(parent12111[0].SubCount ?? parent12111[0].subcount ?? 0);
    console.log(`\n=== SubCount check 12111 ===`);
    console.log({ reportedSubCount: reported, actualChildren: actual, mismatch: reported !== actual });
  }

  await q('SubCount mismatches (top 30)', `
    SELECT TOP 30 p.Seq, p.Num, p.Name1, p.SubCount,
      (SELECT COUNT(*) FROM File11n c WHERE c.Master = p.Seq) AS actualKids
    FROM File11n p
    WHERE p.SubCount != (SELECT COUNT(*) FROM File11n c WHERE c.Master = p.Seq)
    ORDER BY p.Seq
  `);

  await q('recent File11n (last 15 by Seq)', 'SELECT TOP 15 Seq, Num, Name1, Master, SubCount FROM File11n ORDER BY Seq DESC');
  await q('orphan Master refs', `
    SELECT TOP 20 c.Seq, c.Num, c.Name1, c.Master
    FROM File11n c
    WHERE c.Master != 0 AND c.Master NOT IN (SELECT Seq FROM File11n p)
    ORDER BY c.Seq
  `);

  await q('shorja accounts under 12111', `
    SELECT Seq, Num, Name1, Master, SubCount, Address, Remarks
    FROM File11n
    WHERE Master = ${pSeq || 2193}
    ORDER BY Seq
  `);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
