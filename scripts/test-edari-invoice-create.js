#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');
const { createEdariInvoice, createEdariPayment } = require('../server/lib/edari-invoices');
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

async function findTestCustomer() {
  const seq = Number(process.env.EDARI_WALKIN_CUSTOMER_SEQ || 2197);
  const r = await runQuery(`SELECT Seq, Num, Name1 FROM File11n WHERE Seq = ${seq}`);
  const row = rowObjects(r)[0];
  if (!row) throw new Error(`الحساب ${seq} غير موجود`);
  return {
    edariSeq: Number(row.Seq ?? row.seq),
    edariNum: String(row.Num ?? row.num),
    name: String(row.Name1 ?? row.name1 ?? '')
  };
}

async function findTestMaterial() {
  const r = await runQuery('SELECT TOP 1 Seq, Num, Name1, InTot, OutTot FROM File13n WHERE Seq > 0 ORDER BY Seq');
  const row = rowObjects(r)[0];
  if (!row) throw new Error('لا يوجد مادة في File13n');
  return {
    barcode: String(row.Num ?? row.num ?? ''),
    name: String(row.Name1 ?? row.name1 ?? ''),
    seq: Number(row.Seq ?? row.seq),
    outTotBefore: Number(row.OutTot ?? row.outtot ?? 0)
  };
}

(async () => {
  ensureExecuteScriptDeployed();
  const customer = await findTestCustomer();
  const mat = await findTestMaterial();
  console.log('زبون:', customer);
  console.log('مادة:', mat);

  const invoicePayload = {
    invoiceNo: `TEST-${Date.now()}`,
    kind: 'sale',
    edariSeq: customer.edariSeq,
    subtotal: 1100,
    total: 1000,
    discount: 100,
    paidAmount: 500,
    dueAmount: 500,
    branchName: 'اختبار شورجة',
    notes: 'فاتورة اختبار كاملة',
    invoiceDate: new Date().toISOString().slice(0, 10),
    lines: [{
      barcode: mat.barcode,
      name: mat.name,
      qty: 1,
      giftQty: 0,
      unitPrice: 1100,
      lineDiscount: 0,
      lineTotal: 1100
    }]
  };

  const inv = await createEdariInvoice(invoicePayload);
  console.log('نتيجة الفاتورة:', inv);
  if (!inv.ok) process.exit(1);

  const j = await runQuery(`SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE BillSeq = ${inv.edariBillSeq} ORDER BY Seq`);
  console.log('قيود الفاتورة:', JSON.stringify(rowObjects(j), null, 2));

  const stock = await runQuery(`SELECT InTot, OutTot FROM File13n WHERE Seq = ${mat.seq}`);
  console.log('مخزون بعد البيع:', rowObjects(stock)[0]);

  const pay = await createEdariPayment({
    paymentNo: `PAY-TEST-${Date.now()}`,
    edariSeq: customer.edariSeq,
    amount: 100,
    notes: 'تسديد اختبار',
    paymentDate: new Date().toISOString().slice(0, 10)
  });
  console.log('نتيجة التسديد:', pay);
  process.exit(pay.ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
