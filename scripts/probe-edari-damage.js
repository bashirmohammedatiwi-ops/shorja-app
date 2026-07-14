const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const queries = [
    ['FileSrNr', 'SELECT TOP 20 * FROM FileSrNr'],
    ['shorjaBills', "SELECT Seq, Num, Kind, Total, remarks FROM File15n WHERE remarks LIKE '%شورجة%' OR remarks LIKE '%SHORJA%' OR Num >= 9000000 OR Num IN (4628, 4629) ORDER BY Seq"],
    ['shorjaJournal', "SELECT COUNT(*) AS c FROM File12n WHERE Exp1 LIKE '%شورجة%' OR Exp1 LIKE '%TEST-%'"],
    ['maxSeqs', 'SELECT (SELECT MAX(Seq) FROM File15n) AS max15, (SELECT MAX(Seq) FROM File12n) AS max12, (SELECT MAX(Seq) FROM File11n) AS max11'],
    ['recentShorjaJ', "SELECT TOP 10 Seq, Acc, Am, Exp1, BillSeq FROM File12n WHERE Seq >= 106339 ORDER BY Seq"]
  ];
  for (const [label, sql] of queries) {
    const r = await runQuery(sql);
    console.log(`\n=== ${label} ===`);
    if (!r.ok) console.log(String(r.error).slice(0, 500));
    else console.log(JSON.stringify(rowObjects(r), null, 2));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
