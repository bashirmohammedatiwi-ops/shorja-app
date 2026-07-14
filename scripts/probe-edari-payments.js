const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const pay = await runQuery(
    `SELECT TOP 8 Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n
     WHERE Exp1 LIKE '%تسديد%' OR Exp1 LIKE '%سند%' OR Exp1 LIKE '%دفعة%'
     ORDER BY Seq DESC`
  );
  console.log('payments', JSON.stringify(rowObjects(pay), null, 2));
  const accs = await runQuery('SELECT Seq, Num, Name1 FROM File11n WHERE Seq IN (41, 2122, 316)');
  console.log('accs', JSON.stringify(rowObjects(accs), null, 2));
  const ret = await runQuery(
    `SELECT TOP 1 Seq, Num, Kind, Two, Total FROM File15n WHERE Kind IN (2, 5) ORDER BY Seq DESC`
  );
  console.log('return', JSON.stringify(rowObjects(ret)[0], null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
