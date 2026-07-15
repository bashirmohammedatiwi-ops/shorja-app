#!/usr/bin/env node
/**
 * تشخيص ربط تجهيز المخزن — شغّله على السيرفر:
 *   docker exec shorja-sales node scripts/diagnose-prep.js
 * أو محلياً: node scripts/diagnose-prep.js
 */
const db = require('../server/db');
const { getDelegateConfig, probeDelegateIntegration } = require('../server/lib/warehouse-prep');

async function main() {
  const cfg = getDelegateConfig();
  console.log('=== إعدادات التكامل ===');
  console.log('DELEGATE_PORTAL_URL:', cfg.base || '(غير مضبوط)');
  console.log('DELEGATE_INTEGRATION_KEY:', cfg.key ? `${cfg.key.slice(0, 6)}…` : '(غير مضبوط)');
  console.log('SYNC_KEY (للمزامنة فقط):', process.env.SYNC_KEY ? `${String(process.env.SYNC_KEY).slice(0, 6)}…` : '(غير مضبوط)');

  console.log('\n=== فحص الاتصال ===');
  const probe = await probeDelegateIntegration();
  console.log(JSON.stringify(probe, null, 2));

  console.log('\n=== آخر 10 فواتير تجهيز مخزن ===');
  const rows = db.prepare(`
    SELECT id, invoice_no, prep_mode, prep_status, prep_error, prep_order_no, created_at
    FROM invoices
    WHERE prep_mode = 'warehouse' OR prep_status IS NOT NULL
    ORDER BY id DESC
    LIMIT 10
  `).all();
  if (!rows.length) {
    console.log('لا توجد فواتير بتجهيز مخزن — ربما لم يُفعّل الخيار عند البيع أو الواجهة قديمة.');
  } else {
    for (const r of rows) {
      console.log(`#${r.id} ${r.invoice_no} | mode=${r.prep_mode} | status=${r.prep_status || '-'} | order=${r.prep_order_no || '-'} | ${r.prep_error || ''}`);
    }
  }

  console.log('\n=== آخر 5 فواتير (أي نوع) ===');
  const recent = db.prepare(`
    SELECT id, invoice_no, prep_mode, prep_status, prep_error
    FROM invoices ORDER BY id DESC LIMIT 5
  `).all();
  for (const r of recent) {
    console.log(`#${r.id} ${r.invoice_no} | prep_mode=${r.prep_mode || 'branch'} | prep_status=${r.prep_status || '-'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
