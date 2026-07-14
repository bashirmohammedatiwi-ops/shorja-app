const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery(
    `SELECT TOP 3 Seq, Num, Kind, Total, Payment, Two FROM File15n
     WHERE Payment > 0 AND Payment = Total ORDER BY Seq DESC`
  );
  console.log('cash sales', JSON.stringify(rowObjects(r), null, 2));
  const r2 = await runQuery(
    `SELECT TOP 3 Seq, Num, Kind, Total, Payment, Two FROM File15n
     WHERE Payment > 0 AND Payment < Total ORDER BY Seq DESC`
  );
  console.log('partial', JSON.stringify(rowObjects(r2), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
