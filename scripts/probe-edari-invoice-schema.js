const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const inv = await runQuery(
    'SELECT TOP 1 Seq, Num, Kind, "Date", Total, Payment, DisCnt, "count", Two, remarks FROM File15n ORDER BY Seq DESC'
  );
  const header = rowObjects(inv)[0];
  console.log('header', JSON.stringify(header, null, 2));
  const seq = header?.Seq ?? header?.seq;
  if (seq) {
    const lines = await runQuery(
      `SELECT TOP 3 BillSeq, BillNo, Mat, MatName, Quant, Price, OBonus, "Sum", Kind, MatRem FROM file14n WHERE BillSeq = ${seq}`
    );
    console.log('lines', JSON.stringify(rowObjects(lines), null, 2));
    const j = await runQuery(
      `SELECT TOP 2 Seq, Acc, "Date", Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE BillSeq = ${seq}`
    );
    console.log('journal', JSON.stringify(rowObjects(j), null, 2));
  }
  const pay = await runQuery(
    'SELECT TOP 1 Seq, Acc, "Date", Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE Dept = False ORDER BY Seq DESC'
  );
  console.log('payment', JSON.stringify(rowObjects(pay)[0], null, 2));
  const max = await runQuery('SELECT MAX(Seq) AS m FROM File15n');
  console.log('maxBill', rowObjects(max)[0]);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
