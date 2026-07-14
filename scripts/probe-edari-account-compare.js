const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const queries = [
    ['children12109', 'SELECT Seq, Num, Name1, Address, Remarks FROM File11n WHERE Master = 2166 ORDER BY Num'],
    ['children12111', 'SELECT Seq, Num, Name1, Address, Remarks FROM File11n WHERE Master = 2193 ORDER BY Num'],
    ['account1210100', "SELECT Seq, Num, Name1, Address, Remarks, Extra1, Extra2, Extra3, Cod, Dest FROM File11n WHERE Num = '1210100'"]
  ];
  for (const [label, sql] of queries) {
    const r = await runQuery(sql);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rowObjects(r), null, 2));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
