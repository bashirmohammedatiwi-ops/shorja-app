#!/usr/bin/env node
/**
 * يمسح حسابات العملاء وبياناتها المرتبطة من قاعدة الشورجة لبداية جديدة.
 * الاستخدام:
 *   node scripts/reset-shorja-accounts.js          # معاينة
 *   node scripts/reset-shorja-accounts.js --execute
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const EXECUTE = process.argv.includes('--execute');
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'shorja.db');

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

function preview(db) {
  const tables = [
    'accounts',
    'invoices',
    'invoice_lines',
    'payments',
    'journal_entries',
    'edari_sync_queue'
  ];
  console.log('الوضع الحالي:');
  for (const t of tables) {
    console.log(`  ${t}: ${count(db, t)}`);
  }
}

function backupDb() {
  if (!fs.existsSync(dbPath)) throw new Error(`لم يُعثر على قاعدة البيانات: ${dbPath}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${dbPath}.backup-${stamp}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function reset(db) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM edari_sync_queue');
    db.exec('DELETE FROM invoice_lines');
    db.exec('DELETE FROM journal_entries');
    db.exec('DELETE FROM payments');
    db.exec('DELETE FROM invoices');
    db.exec('DELETE FROM accounts');
    db.prepare(
      `INSERT INTO sync_meta (key, value) VALUES ('skip_demo_accounts', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

if (!fs.existsSync(dbPath)) {
  console.error(`لم يُعثر على قاعدة البيانات: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
preview(db);

if (!EXECUTE) {
  console.log('\nمعاينة فقط — للتنفيذ أضف: --execute');
  console.log('سيُحذف: كل الحسابات + الفواتير + المدفوعات + قيود اليومية + طابور مزامنة إداري');
  console.log('لن يُحذف: المستخدمون، الفروع، المنتجات');
  process.exit(0);
}

const backupPath = backupDb();
console.log(`\nنسخة احتياطية: ${backupPath}`);

reset(db);
console.log('\nبعد المسح:');
preview(db);
console.log('\nتم. أعد تشغيل السيرفر/تطبيق الإدارة.');
console.log('في تطبيق الفرع: امسح بيانات الموقع (localStorage) أو أعد تسجيل الدخول.');
