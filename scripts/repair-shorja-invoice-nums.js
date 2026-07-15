/**
 * يُعيد ترقيم فواتير الشورجة من نطاق 9000000+ إلى أرقام الإداري الطبيعية.
 * الاستخدام: EDARI_WRITE_ENABLED=1 node scripts/repair-shorja-invoice-nums.js
 */
const { runQuery, rowObjects, canWriteEdari } = require('../server/lib/edari-bridge');
const { shorjaBillNumFloor } = require('../server/lib/edari-safety');
const {
  renumberShorjaBill,
  billNeedsRenumber,
  repairBillDisplayFields,
  resolveInvoiceBook,
  finalizeInvoiceWrites
} = require('../server/lib/edari-invoices');

(async () => {
  if (!canWriteEdari()) {
    console.error('الكتابة إلى إداري غير متاحة — شغّل على Windows مع EDARI_WRITE_ENABLED=1');
    process.exit(1);
  }

  const floor = shorjaBillNumFloor();
  const bills = rowObjects(await runQuery(
    `SELECT Seq, Num, Kind, Book, remarks FROM File15n
     WHERE Num >= ${floor} OR remarks LIKE '%SHORJA%'
     ORDER BY Seq`
  ));

  console.log(`فواتير للترقيم: ${bills.length}`);
  for (const header of bills) {
    const billSeq = Number(header.Seq ?? header.seq);
    const oldNum = Number(header.Num ?? header.num);
    const kind = Number(header.Kind ?? header.kind);
    const book = Number(header.Book ?? header.book ?? 1);
    const payload = { branchName: String(header.remarks || ''), kind: kind === 5 ? 'return' : 'sale' };
    const invoiceBook = resolveInvoiceBook(payload);
    const needsRenumber = await billNeedsRenumber(oldNum, billSeq, invoiceBook, kind);
    if (needsRenumber) {
      const newNum = await renumberShorjaBill(billSeq, invoiceBook, kind);
      await repairBillDisplayFields(billSeq, invoiceBook);
      console.log(`  ✓ ${oldNum} → ${newNum}${oldNum < floor ? ' (تعارض رقم)' : ''}`);
      continue;
    }
    if (oldNum < floor) {
      await repairBillDisplayFields(billSeq, book);
      console.log(`  ~ فاتورة ${oldNum}: إصلاح عرض فقط`);
      continue;
    }
    await repairBillDisplayFields(billSeq, invoiceBook);
    console.log(`  ~ فاتورة ${oldNum}: إصلاح عرض`);
  }

  await finalizeInvoiceWrites();
  console.log('\nتم ترقيم الفواتير ضمن نطاق الإداري.');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
