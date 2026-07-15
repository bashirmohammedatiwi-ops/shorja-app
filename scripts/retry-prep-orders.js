#!/usr/bin/env node
/**
 * إعادة إرسال فواتير «تجهيز من المخزن» التي فشل إرسالها أو تُخطّيت.
 * الاستخدام: node scripts/retry-prep-orders.js [--dry-run]
 */
require('dotenv').config();
const db = require('../server/db');
const { loadInvoice } = require('../server/lib/invoices');
const { submitWarehousePrepOrder, probeDelegateIntegration } = require('../server/lib/warehouse-prep');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const probe = await probeDelegateIntegration();
  console.log('فحص التكامل:', probe);
  if (!probe.ok) {
    console.error('أصلح إعدادات .env ثم أعد المحاولة.');
    process.exit(1);
  }

  const rows = db.prepare(`
    SELECT id FROM invoices
    WHERE prep_mode = 'warehouse'
      AND COALESCE(prep_status, '') != 'submitted'
    ORDER BY id DESC
    LIMIT 100
  `).all();

  if (!rows.length) {
    console.log('لا توجد فواتير تجهيز بحاجة لإعادة الإرسال.');
    return;
  }

  console.log(`وُجد ${rows.length} فاتورة لإعادة الإرسال${dryRun ? ' (تجربة فقط)' : ''}.`);
  for (const row of rows) {
    const invoice = loadInvoice(row.id);
    const branch = db.prepare('SELECT name FROM branches WHERE id = ?').get(invoice.branchId);
    const acc = invoice.accountId
      ? db.prepare('SELECT edari_seq AS edariSeq FROM accounts WHERE id = ?').get(invoice.accountId)
      : null;
    console.log(`- ${invoice.invoiceNo} (${invoice.prepStatus || '—'}): ${invoice.prepError || ''}`);
    if (dryRun) continue;

    const prep = await submitWarehousePrepOrder(invoice, {
      branchName: branch?.name || '',
      edariSeq: acc?.edariSeq || ''
    });
    if (prep.ok) {
      db.prepare(`
        UPDATE invoices
        SET prep_order_id = ?, prep_order_no = ?, prep_status = 'submitted', prep_error = NULL
        WHERE id = ?
      `).run(prep.prepOrderId || null, prep.prepOrderNo || '', invoice.id);
      console.log(`  ✓ أُرسل → ${prep.prepOrderNo || prep.prepOrderId}`);
    } else {
      db.prepare(`
        UPDATE invoices SET prep_status = ?, prep_error = ? WHERE id = ?
      `).run(prep.skipped ? 'skipped' : 'error', prep.error || 'فشل الإرسال', invoice.id);
      console.log(`  ✗ ${prep.error}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
