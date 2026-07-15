#!/usr/bin/env node
/**
 * يصحّح SubCount في شجرة الحسابات File11n عندما لا يطابق عدد الأبناء الفعلي.
 * السبب الشائع: كتابة SQL مباشرة (شورجة) زادت SubCount دون إنقاصه عند الحذف.
 *
 *   node scripts/repair-edari-subcount.js           # معاينة
 *   node scripts/repair-edari-subcount.js --execute # تنفيذ
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_MAINTENANCE = '1';
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');
const { runQuery, runExecute, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');

async function loadAllAccounts() {
  const r = await runQuery('SELECT Seq, Num, Name1, Master, SubCount FROM File11n ORDER BY Seq');
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r);
}

function findMismatches(rows) {
  const kidsByMaster = new Map();
  for (const row of rows) {
    const master = String(row.Master ?? row.master ?? '0');
    kidsByMaster.set(master, (kidsByMaster.get(master) || 0) + 1);
  }
  const fixes = [];
  for (const row of rows) {
    const seq = Number(row.Seq ?? row.seq);
    const reported = Number(row.SubCount ?? row.subcount ?? 0);
    const actual = kidsByMaster.get(String(seq)) || 0;
    if (reported !== actual) {
      fixes.push({
        seq,
        num: String(row.Num ?? row.num),
        name: String(row.Name1 ?? row.name1 ?? '').trim(),
        from: reported,
        to: actual
      });
    }
  }
  return fixes;
}

(async () => {
  ensureExecuteScriptDeployed();
  const rows = await loadAllAccounts();
  const fixes = findMismatches(rows);

  console.log(`حسابات File11n: ${rows.length}`);
  console.log(`تصحيحات SubCount مطلوبة: ${fixes.length}`);
  if (!fixes.length) {
    console.log('لا توجد فروقات — الشجرة متسقة.');
    return;
  }

  for (const f of fixes) {
    console.log(`  Seq ${f.seq} (${f.num}) ${f.name}: SubCount ${f.from} → ${f.to}`);
  }

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    console.log('بعد التنفيذ: أعد تشغيل EdariNX ثم جرّب إضافة فرع في الشجرة.');
    return;
  }

  console.log('\nتطبيق التصحيحات...');
  for (const f of fixes) {
    const sql = `UPDATE File11n SET SubCount = ${f.to} WHERE Seq = ${f.seq}`;
    const res = await runExecute(sql);
    if (!res.ok) {
      console.error(`✗ فشل Seq ${f.seq}:`, res.error);
      continue;
    }
    console.log(`✓ Seq ${f.seq} (${f.num}): SubCount = ${f.to}`);
  }

  const after = findMismatches(await loadAllAccounts());
  console.log(`\nبعد الإصلاح — فروقات متبقية: ${after.length}`);
  console.log('أعد تشغيل EdariNX ثم اختبر الإداري الأصلي.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
