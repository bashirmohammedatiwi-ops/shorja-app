const path = require('path');
const odbc = require(path.join('C:', 'Users', 'Future of Technology', 'Documents', 'db', 'edari-reader', 'lib', 'odbc-bridge'));
const { getEdariConnection } = require('../server/lib/edari-connection');

(async () => {
  const r = await odbc.runQuery({
    ...getEdariConnection(),
    sql: `SELECT Seq, Num, Name1, Master, SubCount, Sub, Dept FROM File11n WHERE Seq IN (2193, 2093, 1261)`
  });
  console.log(JSON.stringify(r, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
