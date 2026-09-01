#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

const PAYMENTS = ['PAY-20260715-0001', 'PAY-20260809-0001'];
const ACCOUNT_NUM = '121119001';

(async () => {
  const acc = await runQuery(
    `SELECT Seq, Num, Name1 FROM File11n WHERE Num = '${ACCOUNT_NUM}' OR Name1 LIKE '%تجريبي%'`
  );
  console.log('account', JSON.stringify(rowObjects(acc), null, 2));
  const customerSeq = Number(rowObjects(acc)[0]?.Seq ?? rowObjects(acc)[0]?.seq ?? 0);

  if (customerSeq) {
    const j = await runQuery(
      `SELECT Seq, Num, Acc, Am, Dept, Exp1, BillNum, BillSeq, ForBill, Ref
       FROM File12n WHERE Acc = ${customerSeq} ORDER BY Seq DESC`
    );
    console.log('customer journal', JSON.stringify(rowObjects(j), null, 2));
  }

  for (const pay of PAYMENTS) {
    const r = await runQuery(
      `SELECT Seq, Num, Acc, Am, Dept, Exp1, BillNum, BillSeq, ForBill, Ref
       FROM File12n WHERE Exp1 LIKE '%${pay}%' ORDER BY Seq`
    );
    const rows = rowObjects(r);
    console.log('payment rows', pay, JSON.stringify(rows, null, 2));
    if (rows.length) {
      const bondNums = [...new Set(rows.map((row) => Number(row.Num ?? row.num)).filter(Boolean))];
      for (const bn of bondNums) {
        const pair = await runQuery(
          `SELECT Seq, Num, Acc, Am, Dept, Exp1 FROM File12n WHERE Num = ${bn} ORDER BY Seq`
        );
        console.log('bond pair', bn, JSON.stringify(rowObjects(pair), null, 2));
      }
    }
  }

  const bogus = await runQuery(
    `SELECT Seq, Num, Kind, Total, Two, remarks FROM File15n
     WHERE Two = ${customerSeq || 0} AND (remarks LIKE '%PAY-%' OR remarks LIKE '%تسديد%')
     ORDER BY Seq DESC`
  );
  console.log('bogus invoices', JSON.stringify(rowObjects(bogus), null, 2));
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
