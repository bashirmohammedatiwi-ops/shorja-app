require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'shorja.db');
const rawDb = new DatabaseSync(dbPath);

const db = {
  exec(sql) { rawDb.exec(sql); },
  prepare(sql) {
    const stmt = rawDb.prepare(sql);
    return {
      run(...params) {
        const bound = params.map((p) => (typeof p === 'bigint' ? Number(p) : p));
        stmt.run(...bound);
        return { lastInsertRowid: Number(rawDb.lastInsertRowid), changes: rawDb.changes };
      },
      get(...params) {
        const bound = params.map((p) => (typeof p === 'bigint' ? Number(p) : p));
        return stmt.get(...bound);
      },
      all(...params) {
        const bound = params.map((p) => (typeof p === 'bigint' ? Number(p) : p));
        return stmt.all(...bound);
      }
    };
  },
  transaction(fn) {
    return (...args) => {
      rawDb.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    };
  }
};

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_seen_at TEXT,
      price_version INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'branch')),
      branch_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT NOT NULL,
      sku TEXT,
      name TEXT NOT NULL,
      unit TEXT DEFAULT 'قطعة',
      price REAL NOT NULL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      stock_qty REAL DEFAULT 0,
      category TEXT DEFAULT '',
      has_offer INTEGER DEFAULT 0,
      offer_name TEXT,
      original_price REAL,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

    CREATE TABLE IF NOT EXISTS price_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      branch_id INTEGER,
      item_count INTEGER DEFAULT 0,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS price_package_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT,
      price REAL NOT NULL,
      cost_price REAL DEFAULT 0,
      stock_qty REAL DEFAULT 0,
      category TEXT,
      has_offer INTEGER DEFAULT 0,
      offer_name TEXT,
      original_price REAL,
      FOREIGN KEY (package_id) REFERENCES price_packages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      invoice_no TEXT NOT NULL UNIQUE,
      branch_id INTEGER NOT NULL,
      cashier_id INTEGER,
      account_id INTEGER,
      customer_name TEXT,
      kind TEXT NOT NULL DEFAULT 'sale' CHECK(kind IN ('sale', 'return', 'issue')),
      parent_invoice_id INTEGER,
      status TEXT NOT NULL DEFAULT 'posted',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      notes TEXT,
      sync_status TEXT DEFAULT 'synced',
      invoice_date TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (parent_invoice_id) REFERENCES invoices(id)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON invoices(branch_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_local ON invoices(local_id);

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER,
      barcode TEXT,
      name TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      line_discount REAL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_no TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL,
      branch_id INTEGER,
      amount REAL NOT NULL,
      method TEXT DEFAULT 'cash',
      notes TEXT,
      created_by INTEGER,
      payment_date TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_no TEXT NOT NULL UNIQUE,
      account_id INTEGER,
      branch_id INTEGER,
      kind TEXT NOT NULL CHECK(kind IN ('debit', 'credit', 'payment', 'sale', 'return', 'adjustment')),
      amount REAL NOT NULL,
      balance_after REAL,
      ref_type TEXT,
      ref_id INTEGER,
      description TEXT NOT NULL,
      entry_date TEXT DEFAULT (date('now')),
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_entries(account_id, entry_date);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const branchCode = process.env.BRANCH_CODE || 'BR001';
  const branchName = process.env.BRANCH_NAME || 'ديما الحياة';
  let branchRow = db.prepare('SELECT id FROM branches WHERE code = ?').get(branchCode);
  if (!branchRow) {
    db.prepare('INSERT INTO branches (code, name) VALUES (?, ?)').run(branchCode, branchName);
    branchRow = db.prepare('SELECT id FROM branches WHERE code = ?').get(branchCode);
  }
  const branchId = Number(branchRow.id);
  db.prepare('UPDATE branches SET name = ? WHERE id = ?').run(branchName, branchId);

  const delegateCode = 'DELEGATE';
  if (!db.prepare('SELECT id FROM branches WHERE code = ?').get(delegateCode)) {
    db.prepare('INSERT INTO branches (code, name) VALUES (?, ?)').run(delegateCode, 'المندوبين');
  } else {
    db.prepare('UPDATE branches SET name = ? WHERE code = ?').run('المندوبين', delegateCode);
  }

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  if (!db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser)) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(adminUser, hash, 'مدير النظام', 'admin');
  }

  const branchUser = 'branch';
  const existingBranchUser = db.prepare('SELECT id, branch_id FROM users WHERE username = ?').get(branchUser);
  if (!existingBranchUser) {
    const hash = bcrypt.hashSync('branch123', 10);
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, branch_id) VALUES (?, ?, ?, ?, ?)')
      .run(branchUser, hash, 'كاشير الفرع', 'branch', branchId);
  } else if (!existingBranchUser.branch_id) {
    db.prepare('UPDATE users SET branch_id = ? WHERE username = ?').run(branchId, branchUser);
  }

  seedDemoProducts();
  seedDemoAccounts();
  migrateSchema();
}

function migrateSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS edari_materials (
      seq TEXT PRIMARY KEY,
      num TEXT,
      barcode TEXT,
      name1 TEXT NOT NULL,
      name2 TEXT,
      unit TEXT DEFAULT '',
      sell_pr1 REAL DEFAULT 0,
      sell_pr2 REAL DEFAULT 0,
      sell_pr3 REAL DEFAULT 0,
      sell_pr5 REAL DEFAULT 0,
      bonus REAL DEFAULT 0,
      in_tot REAL DEFAULT 0,
      out_tot REAL DEFAULT 0,
      remarks TEXT,
      synced_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_edari_materials_barcode ON edari_materials(barcode);
    CREATE INDEX IF NOT EXISTS idx_edari_materials_num ON edari_materials(num);
  `);

  const cols = [
    'ALTER TABLE invoice_lines ADD COLUMN original_price REAL',
    'ALTER TABLE invoice_lines ADD COLUMN price_edited INTEGER DEFAULT 0',
    'ALTER TABLE invoice_lines ADD COLUMN gift_qty REAL DEFAULT 0'
  ];
  for (const sql of cols) {
    try { db.exec(sql); } catch { /* already exists */ }
  }

  migrateInvoicesKind();
  migrateEdariSync();
}

function migrateEdariSync() {
  const cols = [
    'ALTER TABLE accounts ADD COLUMN edari_seq TEXT',
    'ALTER TABLE accounts ADD COLUMN edari_num TEXT',
    'ALTER TABLE accounts ADD COLUMN edari_sync_status TEXT DEFAULT \'none\'',
    'ALTER TABLE accounts ADD COLUMN edari_sync_error TEXT'
  ];
  for (const sql of cols) {
    try { db.exec(sql); } catch { /* exists */ }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS edari_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref_type TEXT,
      ref_id INTEGER,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_edari_sync_status ON edari_sync_queue(status);
  `);
  const invoiceCols = [
    'ALTER TABLE invoices ADD COLUMN edari_bill_seq TEXT',
    'ALTER TABLE invoices ADD COLUMN edari_bill_num TEXT',
    'ALTER TABLE invoices ADD COLUMN edari_sync_status TEXT DEFAULT \'none\'',
    'ALTER TABLE invoices ADD COLUMN edari_sync_error TEXT'
  ];
  const paymentCols = [
    'ALTER TABLE payments ADD COLUMN edari_journal_seq TEXT',
    'ALTER TABLE payments ADD COLUMN edari_sync_status TEXT DEFAULT \'none\'',
    'ALTER TABLE payments ADD COLUMN edari_sync_error TEXT'
  ];
  for (const sql of [...invoiceCols, ...paymentCols]) {
    try { db.exec(sql); } catch { /* exists */ }
  }
  const prepCols = [
    'ALTER TABLE invoices ADD COLUMN prep_mode TEXT DEFAULT \'branch\'',
    'ALTER TABLE invoices ADD COLUMN prep_order_id INTEGER',
    'ALTER TABLE invoices ADD COLUMN prep_order_no TEXT',
    'ALTER TABLE invoices ADD COLUMN prep_status TEXT',
    'ALTER TABLE invoices ADD COLUMN prep_error TEXT'
  ];
  for (const sql of prepCols) {
    try { db.exec(sql); } catch { /* exists */ }
  }
}

function migrateInvoicesKind() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get();
  if (!row?.sql || row.sql.includes("'issue'")) return;
  db.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN;
    CREATE TABLE invoices_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT UNIQUE,
      invoice_no TEXT NOT NULL UNIQUE,
      branch_id INTEGER NOT NULL,
      cashier_id INTEGER,
      account_id INTEGER,
      customer_name TEXT,
      kind TEXT NOT NULL DEFAULT 'sale' CHECK(kind IN ('sale', 'return', 'issue')),
      parent_invoice_id INTEGER,
      status TEXT NOT NULL DEFAULT 'posted',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      due_amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      notes TEXT,
      sync_status TEXT DEFAULT 'synced',
      invoice_date TEXT DEFAULT (date('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (parent_invoice_id) REFERENCES invoices(id)
    );
    INSERT INTO invoices_new SELECT * FROM invoices;
    DROP TABLE invoices;
    ALTER TABLE invoices_new RENAME TO invoices;
    CREATE INDEX IF NOT EXISTS idx_invoices_branch_date ON invoices(branch_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_local ON invoices(local_id);
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
}

function seedDemoProducts() {
  const skipMeta = db.prepare("SELECT value FROM sync_meta WHERE key = 'skip_demo_products'").get();
  if (skipMeta?.value === '1' || process.env.SKIP_DEMO_PRODUCTS === '1') return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count > 0) return;
  const products = [
    { barcode: '6281000001001', name: 'كريم مرطب 50مل', price: 15000, stock_qty: 120, category: 'عناية' },
    { barcode: '6281000001002', name: 'شامبو 400مل', price: 8500, stock_qty: 85, category: 'عناية' },
    { barcode: '6281000001003', name: 'عطر رجالي 100مل', price: 45000, stock_qty: 30, category: 'عطور' },
    { barcode: '6281000001004', name: 'ماسكارا طويلة', price: 12000, stock_qty: 60, category: 'مكياج' },
    { barcode: '6281000001005', name: 'لوشن جسم 250مل', price: 9500, stock_qty: 45, category: 'عناية' },
    { barcode: '6281000001006', name: 'معجون أسنان', price: 3500, stock_qty: 200, category: 'عناية' },
    { barcode: '6281000001007', name: 'صابون طبيعي', price: 2500, stock_qty: 150, category: 'عناية' },
    { barcode: '6281000001008', name: 'سيروم فيتامين سي', price: 28000, stock_qty: 25, category: 'عناية', has_offer: 1, original_price: 32000, offer_name: 'خصم 12%' }
  ];
  const stmt = db.prepare(`
    INSERT INTO products (barcode, name, price, stock_qty, category, has_offer, original_price, offer_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const p of rows) {
      stmt.run(
        p.barcode, p.name, p.price, p.stock_qty, p.category || '',
        p.has_offer ? 1 : 0, p.original_price || null, p.offer_name || null
      );
    }
  });
  tx(products);
}

function seedDemoAccounts() {
  const skipMeta = db.prepare("SELECT value FROM sync_meta WHERE key = 'skip_demo_accounts'").get();
  if (skipMeta?.value === '1' || process.env.SKIP_DEMO_ACCOUNTS === '1') return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (count > 0) return;
  const accounts = [
    { code: 'C001', name: 'أحمد محمد', phone: '07701234567', balance: 125000 },
    { code: 'C002', name: 'سارة علي', phone: '07809876543', balance: 45000 },
    { code: 'C003', name: 'محل الجمال', phone: '07501112233', balance: 320000, credit_limit: 500000 }
  ];
  const stmt = db.prepare(`
    INSERT INTO accounts (code, name, phone, balance, credit_limit) VALUES (?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const a of rows) {
      stmt.run(a.code, a.name, a.phone, a.balance, a.credit_limit || 0);
    }
  });
  tx(accounts);
}

initSchema();

module.exports = db;
