const { runQuery, runExecute, rowObjects, canWriteEdari } = require('./edari-bridge');
const { edariSqlLiteral, sqlEscAscii } = require('./edari-accounts');
const { lookupEdariMaterial } = require('./edari-lookup');

const SALES_ACCOUNT_SEQ = Number(process.env.EDARI_SALES_ACCOUNT_SEQ || 41);
const RETURNS_ACCOUNT_SEQ = Number(process.env.EDARI_RETURNS_ACCOUNT_SEQ || 42);
const CASH_ACCOUNT_SEQ = Number(process.env.EDARI_CASH_ACCOUNT_SEQ || 316);
const SHORJA_REMARKS = String(process.env.EDARI_SHORJA_REMARKS || 'شورجة SHORJA');

const KIND_SALE = 4;
const KIND_RETURN = 5;

function roundAmount(n) {
  return Math.round(Number(n || 0));
}

function formatEdariTimestamp(dateStr) {
  const iso = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `TIMESTAMP '${iso} 12:00:00'`;
}

async function nextSeq(table) {
  const r = await runQuery(`SELECT MAX(Seq) AS maxSeq FROM ${table}`);
  if (!r.ok) throw new Error(r.error || `فشل جلب Seq من ${table}`);
  const rows = rowObjects(r);
  return Number(rows[0]?.maxSeq ?? rows[0]?.MAXSEQ ?? 0) + 1;
}

async function nextBillNum() {
  const floor = Number(process.env.EDARI_SHORJA_BILL_NUM_START || 0);
  const r = await runQuery('SELECT MAX(Num) AS maxNum FROM File15n');
  if (!r.ok) throw new Error(r.error || 'فشل جلب رقم الفاتورة من إداري');
  const rows = rowObjects(r);
  const maxNum = Number(rows[0]?.maxNum ?? rows[0]?.MAXNUM ?? 0);
  return Math.max(maxNum + 1, floor || 0);
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

async function insertJournalEntry({
  seq, acc, dateStr, amount, isDebit, exp1, billNum = 0, billSeq = 0, billKind = 0
}) {
  const billNumVal = Number(billNum || 0);
  const sql = `INSERT INTO File12n (Seq, Acc, "Date", Am, Dept, Exp1, Exp2, BillNum, BillSeq, BillKind, Remarks)
    VALUES (${seq}, ${Number(acc)}, ${formatEdariTimestamp(dateStr)}, ${roundAmount(amount)}, ${isDebit ? 'True' : 'False'},
      ${edariSqlLiteral(exp1)}, '', ${billNumVal}, ${Number(billSeq || 0)}, ${Number(billKind || 0)}, '')`;
  return runExecute(sql);
}

async function postJournalPair({
  debitAcc, creditAcc, amount, dateStr, exp1, billNum, billSeq, billKind
}) {
  const am = roundAmount(amount);
  if (am <= 0) return { ok: true, skipped: true };
  const startSeq = await nextSeq('File12n');
  const d1 = await insertJournalEntry({
    seq: startSeq, acc: debitAcc, dateStr, amount: am, isDebit: true,
    exp1, billNum, billSeq, billKind
  });
  if (!d1.ok) return d1;
  const d2 = await insertJournalEntry({
    seq: startSeq + 1, acc: creditAcc, dateStr, amount: am, isDebit: false,
    exp1, billNum, billSeq, billKind
  });
  if (!d2.ok) return d2;
  return { ok: true, journalSeqStart: startSeq, journalSeqEnd: startSeq + 1 };
}

async function createEdariInvoice(payload) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }

  const kind = payload.kind === 'return' ? 'return' : 'sale';
  if (kind === 'sale' && !payload.edariSeq && Number(payload.dueAmount || 0) <= 0 && Number(payload.paidAmount || 0) > 0) {
    return { ok: true, skipped: true, reason: 'cash_sale_no_edari_account' };
  }

  const customerSeq = Number(payload.edariSeq || 0);
  if (!customerSeq) {
    return { ok: false, error: 'الحساب غير مربوط بإداري — أنشئ/زامِن الحساب أولاً' };
  }

  const billSeq = await nextSeq('File15n');
  const billNum = await nextBillNum();
  const edariKind = kind === 'return' ? KIND_RETURN : KIND_SALE;
  const dateStr = payload.invoiceDate || new Date().toISOString().slice(0, 10);
  const total = roundAmount(payload.total);
  const paid = roundAmount(payload.paidAmount);
  const discount = roundAmount(payload.discount);
  const lines = (payload.lines || []).filter((l) => Number(l.qty) > 0 || Number(l.giftQty) > 0);
  const lineCount = lines.length || 1;
  const remarksRaw = [SHORJA_REMARKS, payload.branchName, payload.invoiceNo, payload.notes].filter(Boolean).join(' · ');
  const remarks = remarksRaw.length > 50 ? remarksRaw.slice(0, 47) + '...' : remarksRaw;

  const headerSql = `INSERT INTO File15n (Seq, Num, Kind, "Date", Total, Payment, DisCnt, "count", Two, remarks)
    VALUES (${billSeq}, ${billNum}, ${edariKind}, ${formatEdariTimestamp(dateStr)},
      ${total}, ${paid}, ${discount}, ${lineCount}, ${customerSeq}, ${edariSqlLiteral(remarks)})`;
  const headerIns = await runExecute(headerSql);
  if (!headerIns.ok) return { ok: false, error: headerIns.error || 'فشل إنشاء رأس الفاتورة في إداري' };

  for (const line of lines) {
    const mat = await resolveMaterial(line);
    const qty = Math.max(0, Number(line.qty || 0));
    const giftQty = Math.max(0, Number(line.giftQty || 0));
    const price = roundAmount(line.unitPrice);
    const lineTotal = roundAmount(line.lineTotal ?? qty * price);
    const lineSql = `INSERT INTO file14n (BillSeq, BillNo, Mat, MatName, Quant, Price, OBonus, "Sum", Kind, MatRem)
      VALUES (${billSeq}, ${billNum}, ${Number(mat.seq || 0)}, ${edariSqlLiteral(mat.name || line.name || '')},
        ${qty}, ${price}, ${giftQty}, ${lineTotal}, ${edariKind}, '')`;
    const lineIns = await runExecute(lineSql);
    if (!lineIns.ok) return { ok: false, error: lineIns.error || `فشل سطر الفاتورة: ${line.name}` };
  }

  const expSale = kind === 'return'
    ? `مردودات مبيعات بالفاتورة ${billNum}`
    : `مبيعات بالفاتورة ${billNum}`;

  if (kind === 'return') {
    const j = await postJournalPair({
      debitAcc: RETURNS_ACCOUNT_SEQ,
      creditAcc: customerSeq,
      amount: total,
      dateStr,
      exp1: expSale,
      billNum,
      billSeq,
      billKind: edariKind
    });
    if (!j.ok) return { ok: false, error: j.error || 'فشل قيد المرتجع في إداري' };
  } else {
    const j = await postJournalPair({
      debitAcc: customerSeq,
      creditAcc: SALES_ACCOUNT_SEQ,
      amount: total,
      dateStr,
      exp1: expSale,
      billNum,
      billSeq,
      billKind: edariKind
    });
    if (!j.ok) return { ok: false, error: j.error || 'فشل قيد المبيعات في إداري' };

    if (paid > 0) {
      const expPay = `دفعة نقدية للفاتورة ${billNum}`;
      const p = await postJournalPair({
        debitAcc: CASH_ACCOUNT_SEQ,
        creditAcc: customerSeq,
        amount: paid,
        dateStr,
        exp1: expPay,
        billNum,
        billSeq,
        billKind: edariKind
      });
      if (!p.ok) return { ok: false, error: p.error || 'فشل قيد الدفع النقدي في إداري' };
    }
  }

  return {
    ok: true,
    edariBillSeq: String(billSeq),
    edariBillNum: String(billNum),
    edariKind
  };
}

async function createEdariPayment(payload) {
  if (!canWriteEdari()) {
    return { ok: false, queued: true, error: 'كتابة Edari غير متاحة على هذا السيرفر' };
  }

  const customerSeq = Number(payload.edariSeq || 0);
  if (!customerSeq) {
    return { ok: false, error: 'الحساب غير مربوط بإداري' };
  }

  const amount = roundAmount(payload.amount);
  if (amount <= 0) return { ok: false, error: 'مبلغ التسديد غير صالح' };

  const dateStr = payload.paymentDate || new Date().toISOString().slice(0, 10);
  const exp1 = ['تسديد', payload.paymentNo, payload.notes, SHORJA_REMARKS].filter(Boolean).join(' — ');

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

  return { ok: true, edariJournalSeq: String(j.journalSeqStart || '') };
}

module.exports = {
  createEdariInvoice,
  createEdariPayment,
  SALES_ACCOUNT_SEQ,
  RETURNS_ACCOUNT_SEQ,
  CASH_ACCOUNT_SEQ
};
