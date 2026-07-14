const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  for (const term of ['مطابقة', 'ترصيد', 'قبض', 'صرف', 'نقد']) {
    const r = await runQuery(
      `SELECT TOP 2 Seq, Acc, Am, Dept, Exp1, BillNum, BillSeq FROM File12n WHERE Exp1 LIKE '%${term}%' ORDER BY Seq DESC`
    );
    const rows = rowObjects(r);
    if (rows.length) console.log(term, JSON.stringify(rows, null, 2));
  }
  const acc42 = await runQuery('SELECT Seq, Num, Name1 FROM File11n WHERE Seq IN (41, 42)');
  console.log('sales accounts', JSON.stringify(rowObjects(acc42), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
