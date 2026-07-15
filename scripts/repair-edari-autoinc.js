#!/usr/bin/env node
/**
 * يصلح عداد AUTOINC في جداول Edari بعد كتابة SQL مباشرة (شورجة).
 * الإداري الأصلي يعتمد على AUTOINC لحقل Seq — إذا تعطّل لا يعمل زر إضافة.
 *
 *   node scripts/repair-edari-autoinc.js           # معاينة
 *   node scripts/repair-edari-autoinc.js --execute # تنفيذ
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';

const {
  ensureAccountMaintScriptDeployed,
  ensureTreeRepairScriptDeployed,
  runAccountMaintViaNxscript,
  runTreeRepairViaNxscript
} = require('../server/lib/edari-nxscript');
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');

const TABLES = ['File11n', 'File12n', 'File13n', 'file14n', 'File15n'];

function buildSubHex(childSeqs) {
  const parts = childSeqs.map((seq) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(seq), 0);
    return b;
  });
  return Buffer.concat(parts).toString('hex');
}

async function maxSeq(table) {
  const r = await runQuery(`SELECT MAX(Seq) AS m FROM ${table}`);
  if (!r.ok) throw new Error(r.error);
  return Number(rowObjects(r)[0]?.m ?? 0);
}

(async () => {
  ensureAccountMaintScriptDeployed();
  ensureTreeRepairScriptDeployed();

  const plan = [];
  for (const table of TABLES) {
    const m = await maxSeq(table);
    plan.push({ table, maxSeq: m, setAutoIncTo: m });
  }

  console.log('عدادات AUTOINC المطلوبة (SetAutoIncValue = MAX(Seq)):');
  for (const p of plan) {
    console.log(`  ${p.table}: ${p.setAutoIncTo}`);
  }

  const test = rowObjects(await runQuery(`SELECT Seq, Num, Name1 FROM File11n WHERE Num = '9999999991'`));
  if (test.length) {
    console.log(`\nسجّل اختبار للحذف: Seq ${test[0].Seq} (${test[0].Num})`);
  }

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  console.log('\nتطبيق الإصلاح...');

  if (test.length) {
    const del = await runAccountMaintViaNxscript({ table: 'File11n', seq: Number(test[0].Seq) });
    if (!del.ok) {
      console.error('✗ فشل حذف سجل الاختبار:', del.error);
    } else {
      console.log(`✓ حذف سجل الاختبار Seq ${test[0].Seq}`);
    }
  }

  const kids2193 = rowObjects(await runQuery('SELECT Seq FROM File11n WHERE Master = 2193 ORDER BY Seq'));
  const subRes = await runTreeRepairViaNxscript({
    seq: 2193,
    subCount: kids2193.length,
    subHex: buildSubHex(kids2193.map((k) => Number(k.Seq)))
  });
  if (!subRes.ok) console.error('✗ Sub 2193:', subRes.error);
  else console.log(`✓ Sub 12111 (${kids2193.length} أبناء)`);

  for (const p of plan) {
    const m = p.table === 'File11n' && test.length ? await maxSeq(p.table) : p.setAutoIncTo;
    const res = await runAccountMaintViaNxscript({ table: p.table, autoinc: m });
    if (!res.ok) {
      console.error(`✗ ${p.table}:`, res.error);
      continue;
    }
    console.log(`✓ ${p.table} AUTOINC = ${m}`);
  }

  console.log('\nانتهى — أغلق الإداري و EdariNX ثم أعد تشغيلهما وجرب الإضافة.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
