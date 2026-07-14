const path = require('path');
const root = process.env.EDARI_READER_ROOT
  || path.join('C:', 'Users', 'Future of Technology', 'Documents', 'db', 'edari-reader');
const { getEdariConnection } = require('../server/lib/edari-connection');
const odbc = require(path.join(root, 'lib', 'odbc-bridge'));

(async () => {
  const queries = [
    `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Seq = '13' OR Master = '13' ORDER BY Num`,
    `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Master = '2193' ORDER BY Num`,
    `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Name1 LIKE '%مبيعات%شور%' OR Num LIKE '1211%' ORDER BY Num`
  ];
  for (const sql of queries) {
    console.log('\n---', sql.slice(0, 80), '...');
    const r = await odbc.runQuery({ ...getEdariConnection(), sql });
    console.log(JSON.stringify(r.rows?.slice(0, 15), null, 2), r.rows?.length > 15 ? `... +${r.rows.length - 15} more` : '');
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
