const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const seq = 16099;
  const j = await runQuery(
    `SELECT Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq, BillKind FROM File12n WHERE BillSeq = ${seq}`
  );
  console.log('return journal', JSON.stringify(rowObjects(j), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
