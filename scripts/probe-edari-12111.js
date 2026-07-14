const path = require('path');
const root = process.env.EDARI_READER_ROOT
  || path.join('C:', 'Users', 'Future of Technology', 'Documents', 'db', 'edari-reader');
const { getEdariConnection } = require('../server/lib/edari-connection');
const odbc = require(path.join(root, 'lib', 'odbc-bridge'));

(async () => {
  const sql = `SELECT Seq, Num, Name1, Master, SubCount FROM File11n
    WHERE Num = '12111' OR Name1 LIKE '%شورجه%' OR Name1 LIKE '%شورجة%'
    ORDER BY Num`;
  const r = await odbc.runQuery({ ...getEdariConnection(), sql });
  console.log(JSON.stringify(r, null, 2));
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
