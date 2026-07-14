const iconv = require('iconv-lite');
const { runQuery, runExecute, rowObjects, canWriteEdari } = require('./edari-bridge');
const { canWriteEdariAccounts } = require('./edari-safety');

const PARENT_NUM = String(process.env.EDARI_SHORJA_PARENT_NUM || '12111').trim();
const PARENT_NAME_HINT = String(process.env.EDARI_SHORJA_PARENT_NAME || 'زبائن محل الشورجه').trim();

let cachedParent = null;

function sqlEscAscii(s) {
  return String(s ?? '').replace(/'/g, "''");
}

/** Edari/NexusDB on Arabic Windows stores Name1 as Windows-1256, not UTF-8. */
function edariSqlLiteral(value) {
  const bytes = iconv.encode(String(value ?? '').replace(/'/g, "''"), 'win1256');
  let out = "'";
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  out += "'";
  return out;
}

function normalizeName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizePhone(s) {
  return normalizeName(s).replace(/[^\d+]/g, '');
}

function normalizeAddress(address, phone = '') {
  const addr = normalizeName(address);
  const ph = normalizePhone(phone);
  if (!addr) return '';
  if (ph && normalizePhone(addr) === ph) return '';
  return addr;
}

/**
 * Edari customer naming: اسم المحل - المنطقة - الهاتف (بدون بادئة «الزبون»).
 */
function buildEdariAccountName({ name, phone = '', address = '' }) {
  const displayName = normalizeName(name).replace(/^الزبون\s+/i, '');
  const ph = normalizePhone(phone);
  const addr = normalizeName(address);
  if (!displayName) return ph || addr;

  const parts = [displayName];
  if (addr && addr !== displayName) {
    const shortLoc = addr.length > 45
      ? (addr.split(' - ').filter(Boolean)[0] || addr.slice(0, 45))
      : addr;
    if (shortLoc && shortLoc !== displayName) parts.push(shortLoc);
  }
  if (ph) parts.push(ph);
  return parts.join(' - ');
}

async function loadParentAccount() {
  if (cachedParent) return cachedParent;
  const r = await runQuery(
    `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Num = '${sqlEscAscii(PARENT_NUM)}'`
  );
  if (!r.ok) throw new Error(r.error || 'فشل الاتصال بإداري');
  const rows = rowObjects(r);
  const parent = rows[0];
  if (!parent) {
    throw new Error(`حساب الشجرة ${PARENT_NUM} (${PARENT_NAME_HINT}) غير موجود في إداري`);
  }
  cachedParent = {
    seq: String(parent.Seq ?? parent.seq),
    num: String(parent.Num ?? parent.num).trim(),
    name: normalizeName(parent.Name1 ?? parent.name1),
    masterSeq: String(parent.Master ?? parent.master ?? '0'),
    subCount: Number(parent.SubCount ?? parent.sub_count ?? 0)
  };
  return cachedParent;
}

async function nextAccountSeq() {
  const r = await runQuery('SELECT MAX(Seq) AS maxSeq FROM File11n');
  if (!r.ok) throw new Error(r.error || 'فشل جلب Seq');
  const rows = rowObjects(r);
  const maxSeq = Number(rows[0]?.maxSeq ?? rows[0]?.MAXSEQ ?? 0);
  return maxSeq + 1;
}

async function nextChildNum(parent) {
  const parentSeq = Number(parent.seq);
  const prefix = String(parent.num);
  const r = await runQuery(
    `SELECT Num FROM File11n WHERE Master = ${parentSeq}`
  );
  if (!r.ok) throw new Error(r.error || 'فشل جلب أرقام الحسابات الفرعية');
  const rows = rowObjects(r);
  let maxSuffix = 0;
  for (const row of rows) {
    const num = String(row.Num ?? row.num ?? '');
    if (!num.startsWith(prefix)) continue;
    const suffix = num.slice(prefix.length);
    const n = Number(suffix.replace(/\D/g, '')) || 0;
    if (n > maxSuffix) maxSuffix = n;
  }
  return `${prefix}${maxSuffix + 1}`;
}

/**
 * Create leaf customer account under زبائن محل الشورجه (12111) in Edari File11n.
 */
async function createEdariCustomerAccount({ name, phone = '', address = '', notes = '' }) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }
  if (!canWriteEdariAccounts()) {
    return { ok: false, queued: true, error: 'إنشاء حسابات Edari معطّل — الإداري الأصلي محمي (EDARI_WRITE_ACCOUNTS=0)' };
  }

  const parent = await loadParentAccount();
  const seq = await nextAccountSeq();
  const num = await nextChildNum(parent);
  const displayName = normalizeName(name);
  if (!displayName) throw new Error('اسم الحساب مطلوب');

  const name1 = buildEdariAccountName({ name: displayName, phone, address });
  const addr = normalizeAddress(address, phone);
  const remarks = normalizeName(notes);

  const insertSql = `INSERT INTO File11n (Seq, Num, Name1, Master, SubCount, Bal, Tot1, Tot2, Dept, Cod, Dest, Address, Remarks)
    VALUES (${seq}, '${sqlEscAscii(num)}', ${edariSqlLiteral(name1)}, ${Number(parent.seq)}, 0, 0, 0, 0, 0, 1, 4, ${edariSqlLiteral(addr)}, ${edariSqlLiteral(remarks)})`;

  const ins = await runExecute(insertSql);
  if (!ins.ok) {
    return { ok: false, error: ins.error || 'فشل إنشاء الحساب في إداري' };
  }

  await runExecute(`UPDATE File11n SET SubCount = SubCount + 1 WHERE Seq = ${Number(parent.seq)}`);

  cachedParent = { ...parent, subCount: parent.subCount + 1 };

  return {
    ok: true,
    edariSeq: String(seq),
    edariNum: num,
    edariName: name1,
    parentSeq: parent.seq,
    parentNum: parent.num
  };
}

async function getEdariParentInfo() {
  try {
    const parent = await loadParentAccount();
    return { ok: true, parent };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fixEdariAccountName(seq, name1) {
  const sql = `UPDATE File11n SET Name1 = ${edariSqlLiteral(name1)} WHERE Seq = ${Number(seq)}`;
  return runExecute(sql);
}

async function alignEdariAccountFields(seq, { name, phone = '', address = '', notes = '' } = {}) {
  const name1 = buildEdariAccountName({ name, phone, address });
  const addr = normalizeAddress(address, phone);
  const remarks = normalizeName(notes);
  const sql = `UPDATE File11n SET Name1 = ${edariSqlLiteral(name1)}, Address = ${edariSqlLiteral(addr)},
    Remarks = ${edariSqlLiteral(remarks)}, Cod = 1, Dest = 4 WHERE Seq = ${Number(seq)}`;
  return runExecute(sql);
}

module.exports = {
  PARENT_NUM,
  PARENT_NAME_HINT,
  loadParentAccount,
  createEdariCustomerAccount,
  getEdariParentInfo,
  fixEdariAccountName,
  alignEdariAccountFields,
  buildEdariAccountName,
  edariSqlLiteral,
  sqlEscAscii
};
