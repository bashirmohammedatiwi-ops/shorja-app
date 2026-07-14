#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');
const { createEdariInvoice, createEdariPayment } = require('../server/lib/edari-invoices');
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

async function findTestCustomer() {
  const r = await runQuery(`SELECT TOP 1 Seq, Num, Name1 FROM File11n WHERE Num LIKE '12111%' ORDER BY Seq DESC`);
  if (!r.ok) throw new Error(r.error);
  const row = rowObjects(r)[0];
  if (!row) throw new Error('لا يوجد حساب تحت 12111 للاختبار');
  return {
    edariSeq: Number(row.Seq ?? row.seq),
    edariNum: String(row.Num ?? row.num),
    name: String(row.Name1 ?? row.name1 ?? '')
  };
}

async function findTestMaterial() {
  const r = await runQuery('SELECT TOP 1 Seq, Num, Name1 FROM File13n WHERE Seq > 0 ORDER BY Seq');
  if (!r.ok) throw new Error(r.error);
  const row = rowObjects(r)[0];
  if (!row) throw new Error('لا يوجد مادة في File13n');
  return {
    barcode: String(row.Num ?? row.num ?? ''),
    name: String(row.Name1 ?? row.name1 ?? ''),
    seq: Number(row.Seq ?? row.seq)
  };
}

(async () => {
  ensureExecuteScriptDeployed();
  const customer = await findTestCustomer();
  const mat = await findTestMaterial();
  console.log('زبون اختبار:', customer);
  console.log('مادة اختبار:', mat);

  const invoicePayload = {
    invoiceNo: `TEST-${Date.now()}`,
    kind: 'sale',
    edariSeq: customer.edariSeq,
    total: 1000,
    paidAmount: 500,
    dueAmount: 500,
    discount: 0,
    branchName: 'اختبار شورجة',
    notes: 'فاتورة اختبار تلقائي',
    invoiceDate: new Date().toISOString().slice(0, 10),
    lines: [{
      barcode: mat.barcode,
      name: mat.name,
      qty: 1,
      giftQty: 0,
      unitPrice: 1000,
      lineTotal: 1000
    }]
  };

  const inv = await createEdariInvoice(invoicePayload);
  console.log('نتيجة الفاتورة:', inv);
  if (!inv.ok) process.exit(1);

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
