require('dotenv').config();
const { fixEdariAccountName } = require('../server/lib/edari-accounts');
const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');

const fixes = [
  { seq: 2194, name: 'الزبون زبون تجريبي nx' },
  { seq: 2195, name: 'الزبون ابو غسان الحياة' }
];

(async () => {
  ensureExecuteScriptDeployed();
  for (const row of fixes) {
    const r = await fixEdariAccountName(row.seq, row.name);
    console.log(row.seq, row.name, r.ok ? 'OK' : r.error);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
