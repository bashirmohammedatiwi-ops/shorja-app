const { runQuery, runExecute, rowObjects, canWriteEdari } = require('./edari-bridge');

const PARENT_NUM = String(process.env.EDARI_SHORJA_PARENT_NUM || '12111').trim();
const PARENT_NAME_HINT = String(process.env.EDARI_SHORJA_PARENT_NAME || 'زبائن محل الشورجه').trim();

let cachedParent = null;

function sqlEsc(s) {
  return String(s ?? '').replace(/'/g, "''");
}

function normalizeName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function loadParentAccount() {
  if (cachedParent) return cachedParent;
  const r = await runQuery(
    `SELECT Seq, Num, Name1, Master, SubCount FROM File11n WHERE Num = '${sqlEsc(PARENT_NUM)}'`
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
    `SELECT Num FROM File11n WHERE Master = ${parentSeq} ORDER BY Num DESC`
  );
  if (!r.ok) throw new Error(r.error || 'فشل جلب أرقام الحسابات الفرعية');
  const rows = rowObjects(r);
  if (!rows.length) {
    return `${prefix}${String(1).padStart(4, '0')}`;
  }
  const lastNum = String(rows[0].Num ?? rows[0].num ?? '');
  const suffix = lastNum.startsWith(prefix) ? lastNum.slice(prefix.length) : '';
  const n = Number(suffix.replace(/\D/g, '')) || rows.length;
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

/**
 * Create leaf customer account under زبائن محل الشورجه (12111) in Edari File11n.
 */
async function createEdariCustomerAccount({ name, phone = '', address = '', notes = '' }) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }

  const parent = await loadParentAccount();
  const seq = await nextAccountSeq();
  const num = await nextChildNum(parent);
  const displayName = normalizeName(name);
  if (!displayName) throw new Error('اسم الحساب مطلوب');

  const name1 = displayName.startsWith('الزبون') ? displayName : `الزبون ${displayName}`;
  const addr = [phone, address].filter(Boolean).join(' · ');
  const remarks = ['shorja-app', notes].filter(Boolean).join(' · ');

  const insertSql = `INSERT INTO File11n (Seq, Num, Name1, Master, SubCount, Bal, Tot1, Tot2, Dept, Address, Remarks)
    VALUES (${seq}, '${sqlEsc(num)}', '${sqlEsc(name1)}', ${Number(parent.seq)}, 0, 0, 0, 0, 0, '${sqlEsc(addr)}', '${sqlEsc(remarks)}')`;

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

module.exports = {
  PARENT_NUM,
  PARENT_NAME_HINT,
  loadParentAccount,
  createEdariCustomerAccount,
  getEdariParentInfo
};
