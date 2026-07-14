#!/usr/bin/env node
/**
 * يزيل بيانات الشورجة المُدخَلة مباشرة في Edari (فواتير/قيود/أسطر).
 * الاستخدام:
 *   node scripts/cleanup-shorja-edari-pollution.js          # معاينة فقط
 *   node scripts/cleanup-shorja-edari-pollution.js --execute # تنفيذ الحذف
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_MAINTENANCE = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed, ensureMaintenanceScriptDeployed } = require('../server/lib/edari-nxscript');
const { runQuery, runMaintenanceExecute, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');

async function findShorjaBills() {
  const r = await runQuery(`
    SELECT Seq, Num, Kind, Total, remarks FROM File15n
    WHERE remarks LIKE '%شورجة%' OR remarks LIKE '%SHORJA%'
    ORDER BY Seq
  `);
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r);
}

async function countLines(billSeqs) {
  if (!billSeqs.length) return 0;
  const r = await runQuery(`SELECT COUNT(*) AS c FROM file14n WHERE BillSeq IN (${billSeqs.join(',')})`);
  return Number(rowObjects(r)[0]?.c ?? 0);
}

async function countJournalByBillSeq(billSeqs) {
  if (!billSeqs.length) return 0;
  const r = await runQuery(`SELECT COUNT(*) AS c FROM File12n WHERE BillSeq IN (${billSeqs.join(',')})`);
  return Number(rowObjects(r)[0]?.c ?? 0);
}

async function countStandaloneJournal() {
  const r = await runQuery(`
    SELECT COUNT(*) AS c FROM File12n
    WHERE (BillSeq = 0 OR BillSeq IS NULL)
      AND (Exp1 LIKE '%شورجة%' OR Exp1 LIKE '%SHORJA%' OR Exp1 LIKE '%PAY-TEST%')
  `);
  return Number(rowObjects(r)[0]?.c ?? 0);
}

(async () => {
  ensureExecuteScriptDeployed();
  ensureMaintenanceScriptDeployed();
  const bills = await findShorjaBills();
  const seqs = bills.map((b) => Number(b.Seq ?? b.seq)).filter(Boolean);

  console.log(`فواتير شورجة في Edari: ${bills.length}`);
  if (bills.length) {
    console.log('من Seq', seqs[0], 'إلى', seqs[seqs.length - 1]);
    console.log('أرقام:', bills.map((b) => b.Num).join(', '));
  }

  const lineCount = await countLines(seqs);
  const jByBill = await countJournalByBillSeq(seqs);
  const jStandalone = await countStandaloneJournal();
  console.log(`أسطر file14n: ${lineCount}`);
  console.log(`قيود مرتبطة بفواتير: ${jByBill}`);
  console.log(`قيود تسديد مستقلة (شورجة): ${jStandalone}`);

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  console.log('\nبدء الحذف...');
  let deleted = { journal: 0, lines: 0, headers: 0 };

  for (const seq of seqs) {
    const j = await runMaintenanceExecute(`DELETE FROM File12n WHERE BillSeq = ${seq}`);
    if (!j.ok) console.error(`فشل حذف قيود BillSeq=${seq}:`, j.error);
    else deleted.journal += 1;

    const l = await runMaintenanceExecute(`DELETE FROM file14n WHERE BillSeq = ${seq}`);
    if (!l.ok) console.error(`فشل حذف أسطر BillSeq=${seq}:`, l.error);
    else deleted.lines += 1;

    const h = await runMaintenanceExecute(`DELETE FROM File15n WHERE Seq = ${seq}`);
    if (!h.ok) console.error(`فشل حذف فاتورة Seq=${seq}:`, h.error);
    else {
      deleted.headers += 1;
      const bill = bills.find((b) => Number(b.Seq ?? b.seq) === seq);
      console.log(`✓ حذفت فاتورة Seq=${seq} Num=${bill?.Num}`);
    }
  }

  const js = await runMaintenanceExecute(`
    DELETE FROM File12n
    WHERE (BillSeq = 0 OR BillSeq IS NULL)
      AND (Exp1 LIKE '%شورجة%' OR Exp1 LIKE '%SHORJA%' OR Exp1 LIKE '%PAY-TEST%')
  `);
  if (!js.ok) console.error('فشل حذف قيود مستقلة:', js.error);

  const max15 = await runQuery('SELECT MAX(Seq) AS m FROM File15n');
  const max12 = await runQuery('SELECT MAX(Seq) AS m FROM File12n');
  console.log('\nانتهى الحذف.');
  console.log('MAX(File15n.Seq):', rowObjects(max15)[0]?.m);
  console.log('MAX(File12n.Seq):', rowObjects(max12)[0]?.m);
  console.log('أعد تشغيل EdariNX ثم جرّب حفظ فاتورة من الإداري الأصلي.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
