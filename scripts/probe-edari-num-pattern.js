const path = require('path');
const odbc = require(path.join('C:', 'Users', 'Future of Technology', 'Documents', 'db', 'edari-reader', 'lib', 'odbc-bridge'));
const { getEdariConnection } = require('../server/lib/edari-connection');

(async () => {
  const r = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Master = '2093' ORDER BY Num`
  });
  console.log('children of 2093 (12110):', JSON.stringify(r.rows, null, 2));
  const sample = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT TOP 3 Seq, Num, Name1, Master, SubCount, Sub, Address, Remarks FROM File11n WHERE SubCount = 0 AND Master != '0' ORDER BY Seq DESC`
  });
  console.log('recent leaves:', JSON.stringify(sample.rows, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
