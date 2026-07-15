#!/usr/bin/env node
/**
 * يصحّح أرقام حسابات File11n التي تكسر ترتيب الإداري الأصلي.
 * مثال: تحت 12109 أرقام 1210100-1210104 ترتيبها نصياً قبل 121091
 * فيقترح الإداري 1210911 عند الإضافة ويفشل الحفظ بصمت.
 *
 *   node scripts/repair-edari-account-nums.js           # معاينة
 *   node scripts/repair-edari-account-nums.js --execute # تنفيذ
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed, ensureTreeRepairScriptDeployed, runTreeRepairViaNxscript } = require('../server/lib/edari-nxscript');
const { runQuery, runExecute, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');

/** Seq → رقم صحيح يأتي بعد 121099 نصياً */
const RENUMBER = [
  { seq: 2181, from: '1210100', to: '1210991', name: 'كوزمتك هيلين' },
  { seq: 2182, from: '1210101', to: '1210992', name: 'كوزمتك نسمات' },
  { seq: 2184, from: '1210102', to: '1210993', name: 'كوزمتك حسين' },
  { seq: 2185, from: '1210103', to: '1210994', name: 'كوزمتك اللؤلؤة' },
  { seq: 2192, from: '1210104', to: '1210995', name: 'كوزمتك تحسين' }
];

function buildSubHex(childSeqs) {
  const parts = childSeqs.map((seq) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(seq), 0);
    return b;
  });
  return Buffer.concat(parts).toString('hex');
}

async function childrenOf(masterSeq) {
  const r = await runQuery(`SELECT Seq, Num FROM File11n WHERE Master = ${Number(masterSeq)} ORDER BY Seq`);
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r);
}

async function rebuildParentSub(masterSeq) {
  const kids = await childrenOf(masterSeq);
  const seqs = kids.map((k) => Number(k.Seq ?? k.seq));
  return runTreeRepairViaNxscript({
    seq: masterSeq,
    subCount: seqs.length,
    subHex: buildSubHex(seqs)
  });
}

(async () => {
  ensureExecuteScriptDeployed();
  ensureTreeRepairScriptDeployed();

  console.log('تصحيح أرقام حسابات 12109 (زبائن اثير اي لوف):\n');
  for (const item of RENUMBER) {
    const r = await runQuery(`SELECT Seq, Num, Name1 FROM File11n WHERE Seq = ${item.seq}`);
    const row = rowObjects(r)[0];
    const current = String(row?.Num ?? row?.num ?? '');
    console.log(`  Seq ${item.seq}: ${current || item.from} → ${item.to}`);
    if (current && current !== item.from && current !== item.to) {
      console.log(`    ⚠ الرقم الحالي غير متوقع — تخطي`);
      item.skip = true;
    }
  }

  const taken = await runQuery(`SELECT Seq, Num FROM File11n WHERE Num IN ('1210991','1210992','1210993','1210994','1210995','1210996')`);
  const busy = rowObjects(taken).filter((r) => !RENUMBER.some((x) => String(x.seq) === String(r.Seq ?? r.seq)));
  if (busy.length) {
    console.error('\nأرقام الهدف مستخدمة:', busy);
    process.exit(1);
  }

  const kidsBefore = await childrenOf(2166);
  console.log('\nترتيب الأبناء قبل:', kidsBefore.map((k) => k.Num).join(', '));
  console.log('MAX نصي حالياً:', [...kidsBefore.map((k) => String(k.Num))].sort().pop());
  console.log('الرقم التالي المتوقع بعد الإصلاح: 1210996');

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  console.log('\nتطبيق التصحيح...');
  for (const item of RENUMBER) {
    if (item.skip) continue;
    const sql = `UPDATE File11n SET Num = '${item.to}' WHERE Seq = ${item.seq}`;
    const res = await runExecute(sql);
    if (!res.ok) {
      console.error(`✗ Seq ${item.seq}:`, res.error);
      process.exit(1);
    }
    console.log(`✓ Seq ${item.seq}: ${item.to}`);
  }

  const sub2166 = await rebuildParentSub(2166);
  if (!sub2166.ok) {
    console.error('✗ فشل إعادة بناء Sub لـ 12109:', sub2166.error);
    process.exit(1);
  }
  console.log('✓ Sub لحساب 12109 (Seq 2166)');

  const sub13 = await rebuildParentSub(13);
  if (!sub13.ok) {
    console.error('✗ فشل إعادة بناء Sub لـ 121:', sub13.error);
    process.exit(1);
  }
  console.log('✓ Sub لحساب 121 (Seq 13)');

  const kidsAfter = await childrenOf(2166);
  console.log('\nترتيب الأبناء بعد:', kidsAfter.map((k) => k.Num).join(', '));
  console.log('MAX نصي بعد:', [...kidsAfter.map((k) => String(k.Num))].sort().pop());
  console.log('\nأعد تشغيل EdariNX ثم جرّب إضافة حساب تحت 12109 — الرقم المقترح يجب أن يكون 1210996');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
