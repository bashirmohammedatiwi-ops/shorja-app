/**
 * إجراءات ما بعد الكتابة الآمنة إلى Edari — تحمي الإداري الأصلي من تلف AUTOINC و Sub.
 */
const { runQuery, rowObjects } = require('./edari-bridge');
const { runAccountMaintViaNxscript, runTreeRepairViaNxscript } = require('./edari-nxscript');
const { PARENT_NUM } = require('./edari-accounts');

const AUTOINC_TABLES = ['File11n', 'File12n', 'File13n', 'file14n', 'File15n'];

function isRetryableEdariError(message) {
  const s = String(message || '').toLowerCase();
  return /duplicate|unique|primary|exists|locked|busy|conflict|in use|record/i.test(s);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withEdariRetry(label, fn, { attempts = 5, delayMs = 120 } = {}) {
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn(i);
      if (result?.ok !== false) return result;
      lastError = result.error || `${label} failed`;
      if (!isRetryableEdariError(lastError)) return result;
    } catch (err) {
      lastError = err.message || String(err);
      if (!isRetryableEdariError(lastError)) throw err;
    }
    if (i < attempts - 1) await sleep(delayMs * (i + 1));
  }
  return { ok: false, error: lastError || `${label} failed after retries` };
}

function buildSubHex(childSeqs) {
  if (!childSeqs.length) return '';
  const parts = childSeqs.map((seq) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(Number(seq), 0);
    return b;
  });
  return Buffer.concat(parts).toString('hex');
}

async function maxSeqForTable(table) {
  const r = await runQuery(`SELECT MAX(Seq) AS m FROM ${table}`);
  if (!r.ok) throw new Error(r.error || `فشل MAX(Seq) من ${table}`);
  return Number(rowObjects(r)[0]?.m ?? 0);
}

async function syncAutoIncTables(tables = AUTOINC_TABLES) {
  const results = [];
  for (const table of tables) {
    const maxSeq = await maxSeqForTable(table);
    const res = await runAccountMaintViaNxscript({ table, autoinc: maxSeq });
    results.push({ table, maxSeq, ok: !!res.ok, error: res.error });
    if (!res.ok) throw new Error(res.error || `فشل ضبط AUTOINC لـ ${table}`);
  }
  return results;
}

async function rebuildParentSubBySeq(parentSeq) {
  const seq = Number(parentSeq);
  if (!seq) return { ok: false, error: 'parentSeq required' };
  const r = await runQuery(`SELECT Seq FROM File11n WHERE Master = ${seq} ORDER BY Seq`);
  if (!r.ok) throw new Error(r.error);
  const kids = rowObjects(r).map((row) => Number(row.Seq ?? row.seq));
  const subHex = buildSubHex(kids);
  return runTreeRepairViaNxscript({
    seq,
    subCount: kids.length,
    subHex: kids.length ? subHex : ''
  });
}

async function rebuildShorjaParentTree() {
  const r = await runQuery(`SELECT Seq FROM File11n WHERE Num = '${String(PARENT_NUM).replace(/'/g, "''")}'`);
  if (!r.ok) throw new Error(r.error);
  const parent = rowObjects(r)[0];
  if (!parent) return { ok: false, error: `حساب ${PARENT_NUM} غير موجود` };
  return rebuildParentSubBySeq(Number(parent.Seq ?? parent.seq));
}

async function finalizeEdariWriteSession({ tables, rebuildShorjaParent = false } = {}) {
  const out = { autoinc: [], parentSub: null };
  if (tables?.length) {
    out.autoinc = await syncAutoIncTables(tables);
  }
  if (rebuildShorjaParent) {
    out.parentSub = await rebuildShorjaParentTree();
    if (!out.parentSub.ok) throw new Error(out.parentSub.error || 'فشل إعادة بناء Sub للأب');
  }
  return out;
}

/** قبل الكتابة — يضبط AUTOINC و Sub من القاعدة الحالية (آمن مع الإداري مفتوحاً). */
async function prepareEdariWriteSession(options = {}) {
  return finalizeEdariWriteSession(options);
}

function tablesForSessionKinds({ accounts = false, invoices = false, payments = false } = {}) {
  const tables = [];
  if (accounts) tables.push('File11n');
  if (invoices) tables.push('File15n', 'file14n', 'File12n', 'File13n');
  if (payments) tables.push('File12n');
  return [...new Set(tables)];
}

module.exports = {
  AUTOINC_TABLES,
  isRetryableEdariError,
  withEdariRetry,
  syncAutoIncTables,
  rebuildParentSubBySeq,
  rebuildShorjaParentTree,
  prepareEdariWriteSession,
  finalizeEdariWriteSession,
  tablesForSessionKinds
};
