#!/usr/bin/env node
/**
 * حذف فواتير محددة من Edari (File12n → file14n → File15n).
 * الاستخدام:
 *   node scripts/delete-edari-bills.js 3548 3552           # معاينة
 *   node scripts/delete-edari-bills.js 3548 3552 --execute # تنفيذ
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_MAINTENANCE = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureMaintenanceScriptDeployed } = require('../server/lib/edari-nxscript');
const { runQuery, runMaintenanceExecute, rowObjects } = require('../server/lib/edari-bridge');

const billNums = process.argv.slice(2).filter((a) => a !== '--execute').map(Number).filter((n) => n > 0);
const EXECUTE = process.argv.includes('--execute');
const customerSeq = Number(process.env.EDARI_CUSTOMER_SEQ || 0);

async function findBills() {
  if (!billNums.length) throw new Error('حدّد أرقام الفواتير: node scripts/delete-edari-bills.js 3548 3552');
  const nums = billNums.join(', ');
  const customerFilter = customerSeq > 0 ? ` AND Two = ${customerSeq}` : '';
  const r = await runQuery(
    `SELECT Seq, Num, Kind, Total, Payment, Two, remarks, "Date" FROM File15n WHERE Num IN (${nums})${customerFilter} ORDER BY Num`
  );
  if (!r.ok) throw new Error(r.error || 'فشل قراءة الفواتير');
  return rowObjects(r);
}

async function deleteBill(seq, num) {
  const j = await runMaintenanceExecute(`DELETE FROM File12n WHERE BillSeq = ${seq}`);
  if (!j.ok) throw new Error(`فشل حذف قيود BillSeq=${seq}: ${j.error}`);

  const l = await runMaintenanceExecute(`DELETE FROM file14n WHERE BillSeq = ${seq}`);
  if (!l.ok) throw new Error(`فشل حذف أسطر BillSeq=${seq}: ${l.error}`);

  const h = await runMaintenanceExecute(`DELETE FROM File15n WHERE Seq = ${seq}`);
  if (!h.ok) throw new Error(`فشل حذف فاتورة Seq=${seq}: ${h.error}`);

  console.log(`✓ حذفت فاتورة ${num} (Seq=${seq})`);
}

(async () => {
  ensureMaintenanceScriptDeployed();
  const bills = await findBills();
  console.log(`فواتير مطابقة: ${bills.length}`);
  for (const b of bills) {
    const seq = Number(b.Seq ?? b.seq);
    const num = Number(b.Num ?? b.num);
    const jr = await runQuery(`SELECT COUNT(*) AS c FROM File12n WHERE BillSeq = ${seq}`);
    const lr = await runQuery(`SELECT COUNT(*) AS c FROM file14n WHERE BillSeq = ${seq}`);
    const jc = Number(rowObjects(jr)[0]?.c ?? 0);
    const lc = Number(rowObjects(lr)[0]?.c ?? 0);
    console.log(`  - فاتورة ${num} Seq=${seq} عميل=${b.Two ?? b.two} إجمالي=${b.Total ?? b.total} قيود=${jc} أسطر=${lc}`);
  }

  const missing = billNums.filter((n) => !bills.some((b) => Number(b.Num ?? b.num) === n));
  if (missing.length) console.log('لم تُعثر على:', missing.join(', '));

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  if (!bills.length) {
    console.log('لا شيء للحذف.');
    return;
  }

  console.log('\nبدء الحذف...');
  for (const b of bills) {
    await deleteBill(Number(b.Seq ?? b.seq), Number(b.Num ?? b.num));
  }
  console.log('\nتم. أعد فتح كشف الحساب في الإداري للتحقق.');
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
