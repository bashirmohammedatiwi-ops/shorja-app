#!/usr/bin/env node
/**
 * مسح بيانات العمل من قاعدة الشورجة (محلي أو سيرفر بعيد).
 *
 * محلي:
 *   node scripts/reset-shorja-data.js --execute
 *
 * سيرفر بعيد (بعد نشر التحديث على VPS):
 *   node scripts/reset-shorja-data.js --remote http://187.124.23.65:5007 --execute
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const EXECUTE = process.argv.includes('--execute');
const remoteIdx = process.argv.indexOf('--remote');
const REMOTE = remoteIdx >= 0 ? String(process.argv[remoteIdx + 1] || '').replace(/\/$/, '') : '';
const SYNC_KEY = process.env.SYNC_KEY
  || (() => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'desktop-admin', 'server.json'), 'utf8'));
      return cfg.syncKey || '';
    } catch {
      return '';
    }
  })();

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'shorja.db');

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

function previewLocal(db) {
  const tables = [
    'accounts', 'invoices', 'invoice_lines', 'payments', 'journal_entries',
    'edari_sync_queue', 'products', 'price_packages', 'edari_materials'
  ];
  console.log('الوضع الحالي:');
  for (const t of tables) {
    console.log(`  ${t}: ${count(db, t)}`);
  }
}

function resetLocal(db) {
  const { resetBusinessData } = require('../server/lib/reset-business-data');
  return resetBusinessData({ includeProducts: true });
}

async function previewRemote() {
  const r = await fetch(`${REMOTE}/api/sync/reset/preview`, {
    headers: { 'x-sync-key': SYNC_KEY }
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  console.log('الوضع الحالي على السيرفر:');
  for (const [k, v] of Object.entries(j.counts || {})) {
    console.log(`  ${k}: ${v}`);
  }
}

async function resetRemote() {
  const r = await fetch(`${REMOTE}/api/sync/reset`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sync-key': SYNC_KEY
    },
    body: JSON.stringify({ confirm: 'RESET', includeProducts: true })
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  console.log('قبل:', j.before);
  console.log('بعد:', j.after);
}

(async () => {
  if (REMOTE) {
    if (!SYNC_KEY) throw new Error('مفتاح المزامنة غير محدد (SYNC_KEY أو desktop-admin/server.json)');
    await previewRemote();
    if (!EXECUTE) {
      console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
      return;
    }
    await resetRemote();
    console.log('\nتم مسح بيانات السيرفر البعيد.');
    return;
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`لم يُعثر على قاعدة البيانات: ${dbPath}`);
    process.exit(1);
  }
  const db = new DatabaseSync(dbPath);
  previewLocal(db);
  if (!EXECUTE) {
    console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
    console.log('للمسح على VPS: --remote http://IP:5007 --execute');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${dbPath}.backup-${stamp}`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`\nنسخة احتياطية: ${backupPath}`);
  const result = resetLocal(db);
  console.log('\nبعد المسح:', result.after);
  console.log('\nتم.');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
