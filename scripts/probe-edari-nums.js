const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery('SELECT MAX(Seq) AS ms FROM File15n');
  const r2 = await runQuery('SELECT MAX(Seq) AS ms FROM File12n');
  const r3 = await runQuery('SELECT TOP 5 Num FROM File15n ORDER BY Seq DESC');
  console.log('max', rowObjects(r)[0], rowObjects(r2)[0]);
  console.log('recent nums', rowObjects(r3).map((x) => x.Num));
  const mat = await runQuery('SELECT TOP 1 Seq, Num, Name1 FROM File13n WHERE Num <> \'\' ORDER BY Seq DESC');
  console.log('mat', rowObjects(mat)[0]);
})().catch((e) => { console.error(e.message); process.exit(1); });
