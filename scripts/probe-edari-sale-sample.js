const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const inv = await runQuery(
    `SELECT TOP 1 Seq, Num, Kind, "Date", Total, Payment, DisCnt, "count", Two, remarks
     FROM File15n WHERE Kind IN (0, 4) AND Two > 0 ORDER BY Seq DESC`
  );
  const header = rowObjects(inv)[0];
  console.log('sale', JSON.stringify(header, null, 2));
  const seq = header?.Seq;
  if (seq) {
    const j = await runQuery(
      `SELECT Seq, Acc, "Date", Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE BillSeq = ${seq}`
    );
    console.log('journal', JSON.stringify(rowObjects(j), null, 2));
    const lines = await runQuery(
      `SELECT BillSeq, BillNo, Mat, MatName, Quant, Price, OBonus, "Sum", Kind FROM file14n WHERE BillSeq = ${seq}`
    );
    console.log('lines', JSON.stringify(rowObjects(lines), null, 2));
  }
  const pay = await runQuery(
    `SELECT TOP 3 Seq, Acc, "Date", Am, Dept, Exp1, BillNum, BillSeq, BillKind
     FROM File12n WHERE Dept = False AND (BillSeq = 0 OR BillSeq IS NULL OR BillNum = '' OR BillNum = '0')
     ORDER BY Seq DESC`
  );
  console.log('standalone payments', JSON.stringify(rowObjects(pay), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
