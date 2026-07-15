#!/usr/bin/env node
/**
 * يعيد بناء حقل Sub (قائمة أبناء الشجرة الثنائية) في File11n.
 * الكتابة المباشرة عبر SQL بدون تحديث Sub تسبب Access Violation في الإداري الأصلي.
 *
 *   node scripts/repair-edari-sub-blob.js           # معاينة
 *   node scripts/repair-edari-sub-blob.js --execute # تنفيذ
 *   node scripts/repair-edari-sub-blob.js --priority # حسابات الشورجة فقط
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const {
  ensureTreeRepairScriptDeployed,
  runTreeRepairViaNxscript
} = require('../server/lib/edari-nxscript');
const { runQuery, runExecute, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');
const PRIORITY_ONLY = process.argv.includes('--priority');
const CLEAR_LEAVES = process.argv.includes('--clear-leaves');

const PRIORITY_NUMS = new Set(['12111', '12110', '12109', '6001', '6654987499']);
const KNOWN_STALE_LEAVES = new Set([449, 1560]);

function buildSubHex(childSeqs) {
  if (!childSeqs.length) return '';
  const parts = childSeqs.map((seq) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(seq), 0);
    return b;
  });
  return Buffer.concat(parts).toString('hex');
}

async function loadTreeIndex() {
  const r = await runQuery('SELECT Seq, Num, Name1, Master, SubCount FROM File11n ORDER BY Seq');
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r);
}

function planRepairs(rows) {
  const childrenByMaster = new Map();
  for (const row of rows) {
    const master = Number(row.Master ?? row.master ?? 0);
    if (!master) continue;
    if (!childrenByMaster.has(master)) childrenByMaster.set(master, []);
    childrenByMaster.get(master).push(Number(row.Seq ?? row.seq));
  }

  const repairs = [];
  for (const row of rows) {
    const seq = Number(row.Seq ?? row.seq);
    const num = String(row.Num ?? row.num);
    const kids = (childrenByMaster.get(seq) || []).sort((a, b) => a - b);
    const actualCount = kids.length;
    const reportedCount = Number(row.SubCount ?? row.subcount ?? 0);

    if (PRIORITY_ONLY && !PRIORITY_NUMS.has(num) && actualCount === 0 && reportedCount === 0) {
      continue;
    }

    if (actualCount > 0) {
      repairs.push({
        seq,
        num,
        name: String(row.Name1 ?? row.name1 ?? '').trim().slice(0, 40),
        kids,
        subCount: actualCount,
        subHex: buildSubHex(kids),
        kind: 'rebuild'
      });
      continue;
    }

    if (reportedCount > 0) {
      repairs.push({
        seq,
        num,
        name: String(row.Name1 ?? row.name1 ?? '').trim().slice(0, 40),
        kids,
        subCount: 0,
        subHex: '',
        kind: 'mismatch'
      });
      continue;
    }

    const shouldClearLeaf = CLEAR_LEAVES
      || KNOWN_STALE_LEAVES.has(seq)
      || (PRIORITY_ONLY && PRIORITY_NUMS.has(num));
    if (shouldClearLeaf) {
      repairs.push({
        seq,
        num,
        name: String(row.Name1 ?? row.name1 ?? '').trim().slice(0, 40),
        kids: [],
        subCount: 0,
        subHex: '',
        kind: 'clear'
      });
    }
  }

  if (PRIORITY_ONLY) {
    return repairs.filter((rep) => PRIORITY_NUMS.has(rep.num) || KNOWN_STALE_LEAVES.has(rep.seq));
  }
  return repairs;
}

async function applyRepair(rep) {
  if (rep.subCount > 0) {
    return runTreeRepairViaNxscript({
      seq: rep.seq,
      subCount: rep.subCount,
      subHex: rep.subHex
    });
  }
  return runExecute(`UPDATE File11n SET SubCount = 0, Sub = NULL WHERE Seq = ${rep.seq}`);
}

(async () => {
  ensureTreeRepairScriptDeployed();
  const rows = await loadTreeIndex();
  const repairs = planRepairs(rows);

  const rebuilds = repairs.filter((r) => r.kind === 'rebuild');
  const clears = repairs.filter((r) => r.kind === 'clear');
  const mismatches = repairs.filter((r) => r.kind === 'mismatch');

  console.log(`حسابات File11n: ${rows.length}`);
  console.log(`إعادة بناء Sub (أب لديه أبناء): ${rebuilds.length}`);
  console.log(`تصفير Sub للأوراق: ${clears.length}`);
  console.log(`تصحيح SubCount خاطئ: ${mismatches.length}`);

  for (const rep of repairs.slice(0, 30)) {
    console.log(`  [${rep.kind}] Seq ${rep.seq} (${rep.num}) ${rep.name}`);
    if (rep.kids.length) console.log(`    أبناء: [${rep.kids.join(', ')}] → ${rep.subHex}`);
    else console.log('    Sub → NULL');
  }
  if (repairs.length > 30) console.log(`  ... و ${repairs.length - 30} أخرى`);

  if (!repairs.length) {
    console.log('\nلا توجد إصلاحات مطلوبة.');
    return;
  }

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  console.log('\nتطبيق الإصلاحات...');
  let ok = 0;
  let fail = 0;
  for (const rep of repairs) {
    const res = await applyRepair(rep);
    if (!res.ok) {
      fail += 1;
      console.error(`✗ Seq ${rep.seq} (${rep.num}):`, res.error);
      continue;
    }
    ok += 1;
    if (rep.kind === 'rebuild' || rep.kind === 'mismatch') {
      console.log(`✓ Seq ${rep.seq} (${rep.num}) SubCount=${rep.subCount}`);
    }
  }

  console.log(`\nانتهى: نجح ${ok} | فشل ${fail}`);
  console.log('أعد تشغيل EdariNX ثم افتح الإداري الأصلي واختبر شجرة الحسابات.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
