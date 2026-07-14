const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const j = await runQuery('SELECT Seq, Acc, Am, Dept, Exp1 FROM File12n WHERE BillSeq = 236');
  console.log(JSON.stringify(rowObjects(j), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
