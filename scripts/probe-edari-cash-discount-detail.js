const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const queries = [
    ['acc132', "SELECT Seq, Num, Name1 FROM File11n WHERE Seq = 132"],
    ['acc372', "SELECT Seq, Num, Name1 FROM File11n WHERE Seq = 372"],
    ['acc316', "SELECT Seq, Num, Name1 FROM File11n WHERE Seq = 316"],
    ['walkin', "SELECT TOP 8 Seq, Num, Name1, Master FROM File11n WHERE Name1 LIKE '%الزبون%' AND SubCount = 0 ORDER BY Seq"],
    ['cashPay236', "SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE BillSeq = 236 AND Exp1 LIKE '%دفعة نقدية%' ORDER BY Seq"],
    ['ourPay4629', "SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE BillSeq = 16125 AND Exp1 LIKE '%دفعة نقدية%' ORDER BY Seq"],
    ['lineAfterSale', "SELECT Seq, InTot, OutTot FROM File13n WHERE Seq = 8"]
  ];
  for (const [label, sql] of queries) {
    const r = await runQuery(sql);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rowObjects(r), null, 2));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
