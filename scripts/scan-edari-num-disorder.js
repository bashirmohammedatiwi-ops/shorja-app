#!/usr/bin/env node
/**
 * يفحص كل آباء File11n بحثاً عن أرقام أبناء تكسر ترتيب الإداري (MAX نصي خاطئ).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

function stringMax(nums) {
  return nums.slice().sort((a, b) => String(a).localeCompare(String(b))).pop();
}

function suggestNext(parentNum, maxChildNum) {
  const p = String(parentNum);
  const m = String(maxChildNum);
  if (!m.startsWith(p)) return `${p}1`;
  const suffix = m.slice(p.length);
  if (/^\d+$/.test(suffix)) {
    const n = BigInt(suffix) + 1n;
    return `${p}${n}`;
  }
  return `${m}1`;
}

(async () => {
  const r = await runQuery('SELECT Seq, Num, Name1, Master, SubCount FROM File11n ORDER BY Seq');
  if (!r.ok) throw new Error(r.error);
  const rows = rowObjects(r);

  const byMaster = new Map();
  for (const row of rows) {
    const master = Number(row.Master ?? row.master ?? 0);
    if (!master) continue;
    if (!byMaster.has(master)) byMaster.set(master, []);
    byMaster.get(master).push(row);
  }

  const problems = [];
  for (const row of rows) {
    const seq = Number(row.Seq ?? row.seq);
    const kids = byMaster.get(seq) || [];
    if (!kids.length) continue;

    const parentNum = String(row.Num ?? row.nums);
    const childNums = kids.map((k) => String(k.Num ?? k.num));
    const maxStr = stringMax(childNums);
    const sorted = childNums.slice().sort((a, b) => a.localeCompare(b));
    const outOfOrder = sorted.join(',') !== childNums.slice().sort((a, b) => Number(a) - Number(b)).map(String).join(',');

    // هل يوجد طفل رقمه نصياً أصغر من أطفال لاحقين؟
    let disorder = false;
    for (let i = 0; i < childNums.length - 1; i++) {
      for (let j = i + 1; j < childNums.length; j++) {
        const a = childNums[i];
        const b = childNums[j];
        if (a > b && Number(a) < Number(b)) disorder = true;
        if (a < b && Number(a) > Number(b)) disorder = true;
      }
    }

    const nextBad = suggestNext(parentNum, maxStr);
    const hasLowAfterHigh = childNums.some((n) => n < maxStr && n.startsWith(parentNum) && n.length > parentNum.length);

    if (disorder || hasLowAfterHigh) {
      problems.push({
        parentSeq: seq,
        parentNum,
        parentName: String(row.Name1 ?? row.name1 ?? '').trim().slice(0, 35),
        childCount: kids.length,
        maxStr,
        nextWouldBe: nextBad,
        children: childNums.slice().sort().join(', ')
      });
    }
  }

  console.log(`آباء بمشاكل ترتيب أرقام: ${problems.length}`);
  for (const p of problems.slice(0, 40)) {
    console.log(`\n${p.parentNum} (Seq ${p.parentSeq}) ${p.parentName}`);
    console.log(`  أبناء: ${p.childCount} | MAX نصي: ${p.maxStr} | التالي المقترح: ${p.nextWouldBe}`);
    console.log(`  ${p.children}`);
  }
  if (problems.length > 40) console.log(`\n... و ${problems.length - 40} أخرى`);

  // فحص 12106 تحديداً
  const p12106 = rows.find((x) => String(x.Num ?? x.num) === '12106');
  if (p12106) {
    const seq = Number(p12106.Seq ?? p12106.seq);
    const kids = (byMaster.get(seq) || []).map((k) => ({
      seq: k.Seq,
      num: k.Num,
      name: String(k.Name1 ?? k.name1 ?? '').slice(0, 30)
    }));
    console.log('\n=== 12106 detail ===');
    console.log(JSON.stringify({ parent: p12106, kids: kids.slice(0, 20), total: kids.length }, null, 2));
    console.log('MAX:', stringMax(kids.map((k) => k.num)));
  }
})().catch((e) => { console.error(e); process.exit(1); });
