const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const queries = [
    ['cashSale236', `SELECT Seq, Num, Kind, Total, Payment, DisCnt, Two, remarks FROM File15n WHERE Seq = 236`],
    ['cashSaleJournal', `SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE BillSeq = 236 ORDER BY Seq`],
    ['cashCustomer445', `SELECT Seq, Num, Name1, Master FROM File11n WHERE Seq = 445`],
    ['nativePayment', `SELECT TOP 5 Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE (BillSeq = 0 OR BillSeq IS NULL) AND Exp1 LIKE '%تسديد%' ORDER BY Seq DESC`],
    ['nativeSond', `SELECT TOP 5 Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE Exp1 LIKE '%سند%' ORDER BY Seq DESC`],
    ['discountInv', `SELECT TOP 3 Seq, Num, Kind, Total, Payment, DisCnt, Two FROM File15n WHERE DisCnt > 0 AND Kind = 4 ORDER BY Seq DESC`],
    ['discountJournal', `SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE BillSeq = (SELECT TOP 1 Seq FROM File15n WHERE DisCnt > 0 AND Kind = 4 ORDER BY Seq DESC) ORDER BY Seq`],
    ['file13cols', `SELECT TOP 1 Seq, Num, Name1, InTot, OutTot FROM File13n WHERE Seq = 8`],
    ['stockMove', `SELECT TOP 5 * FROM FileMtD ORDER BY Seq DESC`]
  ];
  for (const [label, sql] of queries) {
    const r = await runQuery(sql);
    console.log(`\n=== ${label} ===`);
    if (!r.ok) console.log(String(r.error).slice(0, 400));
    else console.log(JSON.stringify(rowObjects(r), null, 2));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
