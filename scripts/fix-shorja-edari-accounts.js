#!/usr/bin/env node
/**
 * يصحّح حسابات الشورجة الموجودة في Edari لتطابق أسلوب الحسابات الأصلية (12109).
 * الاستخدام: node scripts/fix-shorja-edari-accounts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed } = require('../server/lib/edari-nxscript');
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');
const { alignEdariAccountFields, loadParentAccount } = require('../server/lib/edari-accounts');
const db = require('../server/db');

(async () => {
  ensureExecuteScriptDeployed();
  const parent = await loadParentAccount();
  const r = await runQuery(`SELECT Seq, Num, Name1, Address, Remarks FROM File11n WHERE Master = ${Number(parent.seq)} ORDER BY Num`);
  const edariRows = rowObjects(r);

  const accounts = db.prepare('SELECT id, name, phone, address, notes, edari_seq, edari_num FROM accounts WHERE edari_seq IS NOT NULL AND edari_seq != \'\'').all();
  const bySeq = new Map(accounts.map((a) => [String(a.edari_seq), a]));

  console.log(`تصحيح ${edariRows.length} حساب/حسابات تحت ${parent.num}...`);

  for (const row of edariRows) {
    const seq = String(row.Seq ?? row.seq);
    const local = bySeq.get(seq);
    const name = local?.name || String(row.Name1 || '').replace(/^الزبون\s+/i, '');
    const phone = local?.phone || '';
    const address = local?.address || String(row.Address || '');
    const notes = local?.notes || String(row.Remarks || '').replace(/^shorja-app\s*·?\s*/i, '');

    const result = await alignEdariAccountFields(seq, { name, phone, address, notes });
    if (!result.ok) {
      console.error(`فشل Seq ${seq}:`, result.error);
      continue;
    }
    console.log(`✓ ${row.Num}: ${name}`);
  }

  console.log('انتهى التصحيح.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
