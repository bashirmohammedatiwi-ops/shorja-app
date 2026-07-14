const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const sql = `SELECT Seq, Num, Name1, Cod, Dest, Sub, Dept, BalSee, CloseAcc, SelType, PayTypeIdx, Address, Address2, Agent, Extra1, Extra2, Extra3
    FROM File11n WHERE Num IN ('121098', '121110004')`;
  const r = await runQuery(sql);
  console.log(JSON.stringify(rowObjects(r), null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
