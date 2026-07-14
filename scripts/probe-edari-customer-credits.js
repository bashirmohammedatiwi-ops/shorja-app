const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const rows = await runQuery(
    `SELECT TOP 10 Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n
     WHERE Acc = 2122 AND Dept = False AND (BillSeq = 0 OR BillNum = '' OR BillNum = '0')
     ORDER BY Seq DESC`
  );
  console.log(JSON.stringify(rowObjects(rows), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
