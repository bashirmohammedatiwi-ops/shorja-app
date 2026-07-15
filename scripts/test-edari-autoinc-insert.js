#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
const { ensureExecuteScriptDeployed, runAccountMaintViaNxscript } = require('../server/lib/edari-nxscript');
const { runExecute, runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  ensureExecuteScriptDeployed();
  const ins = await runExecute(
    "INSERT INTO File11n (Num, Name1, Master, SubCount, Bal, Tot1, Tot2, Dept, Cod, Dest) VALUES ('9999999992', 'AUTOINC_TEST', 2193, 0, 0, 0, 0, 0, 1, 4)"
  );
  console.log('insert:', ins);
  const row = rowObjects(await runQuery("SELECT Seq, Num FROM File11n WHERE Num = '9999999992'"));
  console.log('assigned Seq:', row);
  if (row[0]) {
    const del = await runAccountMaintViaNxscript({ table: 'File11n', seq: Number(row[0].Seq) });
    console.log('deleted:', del);
    await runAccountMaintViaNxscript({ table: 'File11n', autoinc: Number(row[0].Seq) });
    console.log('autoinc reset to', row[0].Seq);
  }
})();
