const path = require('path');
const odbc = require(path.join('C:', 'Users', 'Future of Technology', 'Documents', 'db', 'edari-reader', 'lib', 'odbc-bridge'));
const { getEdariConnection } = require('../server/lib/edari-connection');

(async () => {
  const r = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT Seq, Num, Name1, Master, SubCount, Sub FROM File11n WHERE Master = '2193' ORDER BY Num`
  });
  console.log('children of 2193 (12111):', r.rows);
  const r2 = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Seq = '13'`
  });
  console.log('seq 13:', r2.rows);
  const r3 = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Master = '13' ORDER BY Num`
  });
  console.log('children of 13:', r3.rows);
  const r4 = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT MAX(CAST(Seq AS INTEGER)) AS maxSeq FROM File11n`
  });
  console.log('max seq:', r4.rows);
})().catch((e) => { console.error(e); process.exit(1); });
