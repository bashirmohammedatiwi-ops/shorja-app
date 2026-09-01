#!/usr/bin/env node
/**
 * حذف تسديدات Edari (زوج قيود File12n) بالمرجع PAY-*.
 * الاستخدام:
 *   node scripts/delete-edari-payments.js PAY-20260715-0001 PAY-20260809-0001
 *   node scripts/delete-edari-payments.js PAY-20260715-0001 --execute
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.EDARI_WRITE_ENABLED = '1';
process.env.EDARI_MAINTENANCE = '1';
process.env.EDARI_WRITE_VIA_NXSCRIPT = '1';

const { ensureExecuteScriptDeployed, ensureMaintenanceScriptDeployed } = require('../server/lib/edari-nxscript');
const { runQuery, runMaintenanceExecute, rowObjects } = require('../server/lib/edari-bridge');

const EXECUTE = process.argv.includes('--execute');
const PAYMENTS = process.argv.slice(2).filter((a) => a !== '--execute');

if (!PAYMENTS.length) {
  console.error('الاستخدام: node scripts/delete-edari-payments.js PAY-... [--execute]');
  process.exit(1);
}

async function findBondNums(payRef) {
  const r = await runQuery(
    `SELECT DISTINCT Num FROM File12n WHERE Exp1 LIKE '%${payRef.replace(/'/g, "''")}%'`
  );
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r).map((row) => Number(row.Num ?? row.num)).filter(Boolean);
}

async function listBondLines(bondNum) {
  const r = await runQuery(
    `SELECT Seq, Num, Acc, Am, Dept, Exp1, BillNum, BillSeq, ForBill, Ref
     FROM File12n WHERE Num = ${bondNum} ORDER BY Seq`
  );
  if (!r.ok) throw new Error(r.error);
  return rowObjects(r);
}

(async () => {
  ensureExecuteScriptDeployed();
  ensureMaintenanceScriptDeployed();

  const toDelete = [];

  for (const pay of PAYMENTS) {
    const bondNums = await findBondNums(pay);
    if (!bondNums.length) {
      console.log(`⚠ لم يُعثر على قيود للتسديد: ${pay}`);
      continue;
    }
    for (const bn of bondNums) {
      const lines = await listBondLines(bn);
      console.log(`\nالتسديد ${pay} — سند ${bn} (${lines.length} سطر):`);
      for (const line of lines) {
        console.log(
          `  Seq=${line.Seq ?? line.seq} Acc=${line.Acc ?? line.acc} Am=${line.Am ?? line.am} Dept=${line.Dept ?? line.dept} Exp1=${line.Exp1 ?? line.exp1}`
        );
      }
      toDelete.push({ pay, bondNum: bn, seqs: lines.map((l) => Number(l.Seq ?? l.seq)).filter(Boolean) });
    }
  }

  if (!toDelete.length) {
    console.log('\nلا يوجد شيء للحذف.');
    return;
  }

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    return;
  }

  console.log('\nبدء الحذف...');
  for (const item of toDelete) {
    const r = await runMaintenanceExecute(`DELETE FROM File12n WHERE Num = ${item.bondNum}`);
    if (!r.ok) {
      console.error(`✗ فشل حذف سند ${item.bondNum} (${item.pay}):`, r.error);
      continue;
    }
    console.log(`✓ حذف سند ${item.bondNum} — ${item.pay} (Seq: ${item.seqs.join(', ')})`);
  }

  const verify = await runQuery(
    `SELECT COUNT(*) AS c FROM File12n WHERE ${PAYMENTS.map((p) => `Exp1 LIKE '%${p.replace(/'/g, "''")}%'`).join(' OR ')}`
  );
  console.log('\nقيود متبقية:', rowObjects(verify)[0]?.c ?? '?');
  console.log('أعد فتح كشف الحساب في إداري للتحقق.');
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
