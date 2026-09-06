/**
 * يضبط نوع فواتير الشورجة في الإداري: نقدي (PayMethod=1) مقابل آجل (PayMethod=0)
 * ويوحّد التاريخ بدون وقت. الاستخدام على جهاز الإداري:
 *   EDARI_WRITE_ENABLED=1 EDARI_WRITE_INVOICES=1 node scripts/repair-edari-cash-paymethod.js
 */
const {
  beginManualEdariSyncSession,
  endManualEdariSyncSession
} = require('../server/lib/edari-safety');
const { runQuery, rowObjects, canWriteEdari } = require('../server/lib/edari-bridge');
const {
  repairBillPayMode,
  repairBillDisplayFields,
  finalizeInvoiceWrites
} = require('../server/lib/edari-invoices');

(async () => {
  process.env.EDARI_WRITE_ENABLED = process.env.EDARI_WRITE_ENABLED || '1';
  process.env.EDARI_WRITE_INVOICES = process.env.EDARI_WRITE_INVOICES || '1';
  beginManualEdariSyncSession({ invoices: true });

  if (!canWriteEdari()) {
    console.error('الكتابة إلى إداري غير متاحة على هذا الجهاز');
    process.exit(1);
  }

  const walkInRow = rowObjects(await runQuery(
    "SELECT Seq FROM File11n WHERE Num = '121119002'"
  ))[0];
  const walkInSeq = Number(walkInRow?.Seq ?? walkInRow?.seq ?? 2317);

  const bills = rowObjects(await runQuery(
    `SELECT Seq, Num, Total, Payment, DisCnt, PayMethod, Two, Book, remarks, "Date"
     FROM File15n
     WHERE remarks LIKE '%SHORJA%' AND Kind = 4
     ORDER BY Seq`
  ));
  console.log(`فواتير شورجة: ${bills.length} · الزبون النقدي Seq=${walkInSeq}`);

  let cashFixed = 0;
  for (const header of bills) {
    const billSeq = Number(header.Seq ?? header.seq);
    const billNum = Number(header.Num ?? header.num);
    const payment = Number(header.Payment ?? header.payment ?? 0);
    const payMethod = Number(header.PayMethod ?? header.paymethod ?? 0);
    const customerSeq = Number(header.Two ?? header.two ?? 0);
    const book = Number(header.Book ?? header.book ?? 1);
    const dateStr = String(header.Date ?? header.date ?? '');
    const needsDateFix = /\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(dateStr)
      || /\d{4}-\d{2}-\d{2}[ T]\d/.test(dateStr);
    const isCash = payment > 0 && customerSeq === walkInSeq;
    if (!isCash && billNum !== 3913) {
      if (needsDateFix) {
        await repairBillDisplayFields(billSeq, book);
        console.log(`  ✓ فاتورة ${billNum}: تصحيح التاريخ فقط`);
      }
      continue;
    }
    const payload = { paymentMethod: 'cash', kind: 'sale' };
    await repairBillDisplayFields(billSeq, book);
    const result = await repairBillPayMode(billSeq, payload);
    if (!result.ok) {
      console.log(`  × فاتورة ${billNum}: ${result.error}`);
      continue;
    }
    if (payMethod !== 1) {
      cashFixed += 1;
      console.log(`  ✓ فاتورة ${billNum}: آجل → نقدي · المدفوع ${result.payment}`);
    } else if (billNum === 3913) {
      console.log(`  ✓ فاتورة 3913: نقدي · المدفوع ${result.payment}`);
    }
  }

  await finalizeInvoiceWrites();
  endManualEdariSyncSession();
  console.log(`\nتم ضبط ${cashFixed} فاتورة نقدية كانت تظهر آجل.`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
