const { runQuery, runExecute, rowObjects, canWriteEdari } = require('./edari-bridge');
const { edariSqlLiteral, sqlEscAscii, loadParentAccount } = require('./edari-accounts');
const { lookupEdariMaterial } = require('./edari-lookup');
const {
  canWriteEdariInvoices,
  canWriteEdariPayments,
  canWriteEdariStock,
  shorjaBillNumFloor,
  shorjaRemarksTag
} = require('./edari-safety');
const { syncAutoIncTables, withEdariRetry } = require('./edari-post-write');

const SALES_ACCOUNT_SEQ = Number(process.env.EDARI_SALES_ACCOUNT_SEQ || 41);
const RETURNS_ACCOUNT_SEQ = Number(process.env.EDARI_RETURNS_ACCOUNT_SEQ || 42);
const CASH_ACCOUNT_SEQ = Number(process.env.EDARI_CASH_ACCOUNT_SEQ || 316);
const DISCOUNT_ACCOUNT_SEQ = Number(process.env.EDARI_DISCOUNT_ACCOUNT_SEQ || 132);
const WALKIN_CUSTOMER_SEQ = Number(process.env.EDARI_WALKIN_CUSTOMER_SEQ || 0);
const SHORJA_REMARKS = shorjaRemarksTag();

const KIND_SALE = 4;
const KIND_RETURN = 5;

let cachedWalkInSeq = null;

function roundAmount(n) {
  return Math.round(Number(n || 0));
}

function formatEdariTimestamp(dateStr) {
  const iso = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `TIMESTAMP '${iso} 12:00:00'`;
}

async function nextSeq(table) {
  await syncAutoIncTables([table]);
  const r = await runQuery(`SELECT MAX(Seq) AS maxSeq FROM ${table}`);
  if (!r.ok) throw new Error(r.error || `فشل جلب Seq من ${table}`);
  const rows = rowObjects(r);
  return Number(rows[0]?.maxSeq ?? rows[0]?.MAXSEQ ?? 0) + 1;
}

async function nextBillNum() {
  const floor = shorjaBillNumFloor();
  const r = await runQuery(`SELECT MAX(Num) AS maxNum FROM File15n WHERE Num >= ${floor}`);
  if (!r.ok) throw new Error(r.error || 'فشل جلب رقم فاتورة الشورجة من إداري');
  const rows = rowObjects(r);
  const maxInRange = Number(rows[0]?.maxNum ?? rows[0]?.MAXNUM ?? 0);
  let candidate = maxInRange > 0 ? maxInRange + 1 : floor;
  for (let i = 0; i < 20; i++) {
    const exists = await runQuery(`SELECT Seq FROM File15n WHERE Num = ${candidate}`);
    if (!exists.ok) throw new Error(exists.error);
    if (!rowObjects(exists).length) return candidate;
    candidate += 1;
  }
  throw new Error('تعذر حجز رقم فاتورة فريد');
}

async function readBillByNum(billNum) {
  const r = await runQuery(`SELECT Seq, Num FROM File15n WHERE Num = ${Number(billNum)}`);
  if (!r.ok) throw new Error(r.error || 'فشل قراءة الفاتورة');
  const row = rowObjects(r)[0];
  if (!row) throw new Error(`لم تُعثر على الفاتورة ${billNum}`);
  return {
    edariBillSeq: String(row.Seq ?? row.seq),
    edariBillNum: String(row.Num ?? row.num)
  };
}

async function findExistingShorjaBill(payload) {
  const invoiceNo = String(payload.invoiceNo || '').trim();
  if (!invoiceNo) return null;
  const r = await runQuery(
    `SELECT TOP 1 Seq, Num FROM File15n WHERE remarks LIKE '%${sqlEscAscii(invoiceNo)}%' ORDER BY Seq DESC`
  );
  if (!r.ok) return null;
  const row = rowObjects(r)[0];
  if (!row) return null;
  return {
    edariBillSeq: String(row.Seq ?? row.seq),
    edariBillNum: String(row.Num ?? row.num)
  };
}

async function resolveWalkInCustomerSeq() {
  if (WALKIN_CUSTOMER_SEQ > 0) return WALKIN_CUSTOMER_SEQ;
  if (cachedWalkInSeq) return cachedWalkInSeq;

  try {
    const parent = await loadParentAccount();
    const r = await runQuery(
      `SELECT TOP 1 Seq FROM File11n WHERE Master = ${Number(parent.seq)} AND (Name1 LIKE '%نقدي%' OR Name1 LIKE '%الزبون%') ORDER BY Seq`
    );
    if (r.ok) {
      const row = rowObjects(r)[0];
      if (row) {
        cachedWalkInSeq = Number(row.Seq ?? row.seq);
        return cachedWalkInSeq;
      }
    }
  } catch {
    /* try global fallback below */
  }

  const fallback = await runQuery(
    "SELECT TOP 1 Seq FROM File11n WHERE Name1 LIKE '%الزبون%' AND SubCount = 0 ORDER BY Seq"
  );
  if (fallback.ok) {
    const row = rowObjects(fallback)[0];
    if (row) {
      cachedWalkInSeq = Number(row.Seq ?? row.seq);
      return cachedWalkInSeq;
    }
  }

  return 0;
}

async function resolveCustomerSeq(payload) {
  const direct = Number(payload.edariSeq || 0);
  if (direct > 0) return direct;

  const isCashSale = payload.kind !== 'return' && (
    (Number(payload.dueAmount || 0) <= 0 && Number(payload.paidAmount || 0) > 0)
    || (!payload.accountId && Number(payload.paidAmount || 0) > 0)
  );

  if (isCashSale) {
    const walkIn = await resolveWalkInCustomerSeq();
    if (walkIn > 0) return walkIn;
  }

  return 0;
}

async function resolveMaterial(line) {
  const code = String(line.barcode || line.num || '').trim();
  if (!code) return { seq: 0, name: String(line.name || '').trim() };
  try {
    const mat = await lookupEdariMaterial(code);
    if (mat?.seq) {
      return { seq: Number(mat.seq), name: String(mat.name || line.name || '').trim() };
    }
  } catch {
    /* fallback below */
  }
  const r = await runQuery(
    `SELECT TOP 1 Seq, Name1 FROM File13n WHERE Num = '${sqlEscAscii(code)}' OR Barcode = '${sqlEscAscii(code)}'`
  );
  if (r.ok) {
    const row = rowObjects(r)[0];
    if (row) {
      return { seq: Number(row.Seq ?? row.seq ?? 0), name: String(row.Name1 ?? row.name1 ?? line.name ?? '').trim() };
    }
  }
  return { seq: 0, name: String(line.name || '').trim() };
}

async function adjustMaterialStock(matSeq, qtyDelta) {
  if (!canWriteEdariStock()) return { ok: true, skipped: true, reason: 'stock_writes_disabled' };
  const delta = Number(qtyDelta || 0);
  if (!matSeq || !delta) return { ok: true, skipped: true };
  const sql = `UPDATE File13n SET OutTot = OutTot + ${delta} WHERE Seq = ${Number(matSeq)}`;
  return runExecute(sql);
}

async function insertJournalEntry({
  acc, dateStr, amount, isDebit, exp1, billNum = 0, billSeq = 0, billKind = 0
}) {
  const sql = `INSERT INTO File12n (Acc, "Date", Am, Dept, Exp1, Exp2, BillNum, BillSeq, BillKind, Remarks)
    VALUES (${Number(acc)}, ${formatEdariTimestamp(dateStr)}, ${roundAmount(amount)}, ${isDebit ? 'True' : 'False'},
      ${edariSqlLiteral(exp1)}, '', ${Number(billNum || 0)}, ${Number(billSeq || 0)}, ${Number(billKind || 0)}, '')`;
  return runExecute(sql);
}

async function lookupJournalSeq({ acc, amount, isDebit, billNum = 0, billSeq = 0, exp1 = '' }) {
  const expFilter = exp1
    ? ` AND Exp1 = ${edariSqlLiteral(exp1)}`
    : '';
  const r = await runQuery(`
    SELECT TOP 1 Seq FROM File12n
    WHERE Acc = ${Number(acc)} AND Am = ${roundAmount(amount)}
      AND Dept = ${isDebit ? 'True' : 'False'}
      AND BillNum = ${Number(billNum || 0)} AND BillSeq = ${Number(billSeq || 0)}
      ${expFilter}
    ORDER BY Seq DESC
  `);
  if (!r.ok) throw new Error(r.error || 'فشل قراءة قيد اليومية');
  const row = rowObjects(r)[0];
  if (!row) throw new Error('لم يُعثر على قيد اليومية بعد الإدراج');
  return Number(row.Seq ?? row.seq);
}

async function postJournalPair({
  debitAcc, creditAcc, amount, dateStr, exp1, billNum = 0, billSeq = 0, billKind = 0
}) {
  const am = roundAmount(amount);
  if (am <= 0) return { ok: true, skipped: true };
  await syncAutoIncTables(['File12n']);
  const d1 = await insertJournalEntry({
    acc: debitAcc, dateStr, amount: am, isDebit: true,
    exp1, billNum, billSeq, billKind
  });
  if (!d1.ok) return d1;
  const debitSeq = await lookupJournalSeq({
    acc: debitAcc, amount: am, isDebit: true, billNum, billSeq, exp1
  });
  const d2 = await insertJournalEntry({
    acc: creditAcc, dateStr, amount: am, isDebit: false,
    exp1, billNum, billSeq, billKind
  });
  if (!d2.ok) return d2;
  const creditSeq = await lookupJournalSeq({
    acc: creditAcc, amount: am, isDebit: false, billNum, billSeq, exp1
  });
  return { ok: true, journalSeqStart: debitSeq, journalSeqEnd: creditSeq };
}

function invoiceAmounts(payload) {
  const discount = roundAmount(payload.discount);
  const netTotal = roundAmount(payload.total);
  const grossTotal = roundAmount(payload.subtotal) || (netTotal + discount);
  const paid = roundAmount(payload.paidAmount);
  return { discount, netTotal, grossTotal, paid };
}

async function createEdariInvoice(payload) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }
  if (!canWriteEdariInvoices()) {
    return { ok: false, queued: true, error: 'كتابة فواتير Edari معطّلة — الإداري الأصلي محمي (EDARI_WRITE_INVOICES=0)' };
  }

  const existing = await findExistingShorjaBill(payload);
  if (existing) {
    return { ok: true, ...existing, deduped: true };
  }

  const kind = payload.kind === 'return' ? 'return' : 'sale';
  const customerSeq = await resolveCustomerSeq(payload);
  if (!customerSeq) {
    const name = String(payload.customerName || '').trim();
    if (payload.accountId) {
      return {
        ok: false,
        error: `حساب العميل «${name || payload.accountId}» غير مربوط بإداري — رحّل الحساب أولاً من تبويب مزامنة الإداري`
      };
    }
    return {
      ok: false,
      error: 'الحساب غير مربوط بإداري — للمبيعات النقدية عيّن EDARI_WALKIN_CUSTOMER_SEQ أو اربط حساب نقدي'
    };
  }

  return withEdariRetry('createEdariInvoice', async () => {
  const existingMid = await findExistingShorjaBill(payload);
  if (existingMid) return { ok: true, ...existingMid, deduped: true };

  const billNum = await nextBillNum();
  const edariKind = kind === 'return' ? KIND_RETURN : KIND_SALE;
  const dateStr = payload.invoiceDate || new Date().toISOString().slice(0, 10);
  const { discount, grossTotal, paid } = invoiceAmounts(payload);
  const lines = (payload.lines || []).filter((l) => Number(l.qty) > 0 || Number(l.giftQty) > 0);
  const lineCount = lines.length || 1;
  const remarksRaw = [SHORJA_REMARKS, payload.branchName, payload.invoiceNo, payload.notes].filter(Boolean).join(' · ');
  const remarks = remarksRaw.length > 50 ? remarksRaw.slice(0, 47) + '...' : remarksRaw;

  await syncAutoIncTables(['File15n']);

  const headerSql = `INSERT INTO File15n (Num, Kind, "Date", Total, Payment, DisCnt, "count", Two, remarks)
    VALUES (${billNum}, ${edariKind}, ${formatEdariTimestamp(dateStr)},
      ${grossTotal}, ${paid}, ${discount}, ${lineCount}, ${customerSeq}, ${edariSqlLiteral(remarks)})`;
  const headerIns = await runExecute(headerSql);
  if (!headerIns.ok) return { ok: false, error: headerIns.error || 'فشل إنشاء رأس الفاتورة في إداري' };

  const bill = await readBillByNum(billNum);
  const billSeq = Number(bill.edariBillSeq);

  const stockDeltas = [];
  for (const line of lines) {
    const mat = await resolveMaterial(line);
    const qty = Math.max(0, Number(line.qty || 0));
    const giftQty = Math.max(0, Number(line.giftQty || 0));
    const price = roundAmount(line.unitPrice);
    const lineDiscount = roundAmount(line.lineDiscount || 0);
    const lineTotal = roundAmount(line.lineTotal ?? (qty * price - lineDiscount));
    const lineSql = `INSERT INTO file14n (BillSeq, BillNo, Mat, MatName, Quant, Price, OBonus, "Sum", Kind, MatRem)
      VALUES (${billSeq}, ${billNum}, ${Number(mat.seq || 0)}, ${edariSqlLiteral(mat.name || line.name || '')},
        ${qty}, ${price}, ${giftQty}, ${lineTotal}, ${edariKind}, '')`;
    const lineIns = await runExecute(lineSql);
    if (!lineIns.ok) return { ok: false, error: lineIns.error || `فشل سطر الفاتورة: ${line.name}` };

    if (mat.seq && (qty > 0 || giftQty > 0)) {
      const moveQty = qty + giftQty;
      stockDeltas.push({ matSeq: mat.seq, delta: kind === 'return' ? -moveQty : moveQty });
    }
  }

  for (const { matSeq, delta } of stockDeltas) {
    const stockRes = await adjustMaterialStock(matSeq, delta);
    if (!stockRes.ok) return { ok: false, error: stockRes.error || `فشل تحديث مخزون المادة ${matSeq}` };
  }

  if (kind === 'return') {
    const expReturn = `مردودات مبيعات بالفاتورة ${billNum}`;
    const j = await postJournalPair({
      debitAcc: RETURNS_ACCOUNT_SEQ,
      creditAcc: customerSeq,
      amount: grossTotal,
      dateStr,
      exp1: expReturn,
      billNum,
      billSeq,
      billKind: edariKind
    });
    if (!j.ok) return { ok: false, error: j.error || 'فشل قيد المرتجع في إداري' };
  } else {
    const expSale = `مبيعات بالفاتورة ${billNum}`;
    const j = await postJournalPair({
      debitAcc: customerSeq,
      creditAcc: SALES_ACCOUNT_SEQ,
      amount: grossTotal,
      dateStr,
      exp1: expSale,
      billNum,
      billSeq,
      billKind: edariKind
    });
    if (!j.ok) return { ok: false, error: j.error || 'فشل قيد المبيعات في إداري' };

    if (discount > 0) {
      const expDisc = `حسم على الفاتورة مبيعات ${billNum}`;
      const d = await postJournalPair({
        debitAcc: DISCOUNT_ACCOUNT_SEQ,
        creditAcc: customerSeq,
        amount: discount,
        dateStr,
        exp1: expDisc,
        billNum: 0,
        billSeq,
        billKind: edariKind
      });
      if (!d.ok) return { ok: false, error: d.error || 'فشل قيد الحسم في إداري' };
    }

    if (paid > 0) {
      const expPay = `دفعة نقدية للفاتورة ${billNum}`;
      const p = await postJournalPair({
        debitAcc: CASH_ACCOUNT_SEQ,
        creditAcc: customerSeq,
        amount: paid,
        dateStr,
        exp1: expPay,
        billNum: 0,
        billSeq,
        billKind: edariKind
      });
      if (!p.ok) return { ok: false, error: p.error || 'فشل قيد الدفع النقدي في إداري' };
    }
  }

  await finalizeInvoiceWrites();

  return {
    ok: true,
    edariBillSeq: bill.edariBillSeq,
    edariBillNum: bill.edariBillNum,
    edariKind,
    customerSeq: String(customerSeq)
  };
  });
}

async function finalizeInvoiceWrites() {
  return syncAutoIncTables(['File15n', 'file14n', 'File12n', 'File13n']);
}

async function createEdariPayment(payload) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }
  if (!canWriteEdariPayments()) {
    return { ok: false, queued: true, error: 'كتابة قيود Edari معطّلة — استخدم المزامنة اليدوية من تطبيق الإدارة' };
  }

  const customerSeq = Number(payload.edariSeq || 0);
  if (!customerSeq) {
    return { ok: false, error: 'الحساب غير مربوط بإداري' };
  }

  const amount = roundAmount(payload.amount);
  if (amount <= 0) return { ok: false, error: 'مبلغ التسديد غير صالح' };

  const dateStr = payload.paymentDate || new Date().toISOString().slice(0, 10);
  const exp1 = `تسديد${payload.paymentNo ? ` ${payload.paymentNo}` : ''}${payload.notes ? ` — ${payload.notes}` : ''}`;

  const result = await withEdariRetry('createEdariPayment', async () => {
    const j = await postJournalPair({
      debitAcc: CASH_ACCOUNT_SEQ,
      creditAcc: customerSeq,
      amount,
      dateStr,
      exp1,
      billNum: 0,
      billSeq: 0,
      billKind: 0
    });
    if (!j.ok) return { ok: false, error: j.error || 'فشل قيد التسديد في إداري' };
    await syncAutoIncTables(['File12n']);
    return { ok: true, edariJournalSeq: String(j.journalSeqStart || '') };
  });
  return result;
}

module.exports = {
  createEdariInvoice,
  createEdariPayment,
  finalizeInvoiceWrites,
  resolveCustomerSeq,
  resolveWalkInCustomerSeq,
  SALES_ACCOUNT_SEQ,
  RETURNS_ACCOUNT_SEQ,
  CASH_ACCOUNT_SEQ,
  DISCOUNT_ACCOUNT_SEQ
};
