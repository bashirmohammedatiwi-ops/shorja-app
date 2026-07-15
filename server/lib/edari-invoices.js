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
const INVOICE_BOOK = Number(process.env.EDARI_INVOICE_BOOK || 1);
const PRICE_GROUP = Number(process.env.EDARI_PRICE_GROUP || 4);
const INVOICE_PERSON = Number(process.env.EDARI_INVOICE_PERSON || 255);
const TAX_REC_NO = Number(process.env.EDARI_TAX_REC_NO || 183);
const SHORJA_REMARKS = shorjaRemarksTag();

function resolveInvoiceBook(payload) {
  const fromEnv = Number(process.env.EDARI_INVOICE_BOOK || 0);
  if (fromEnv > 0) return fromEnv;
  const branch = String(payload.branchName || '').toLowerCase();
  if (branch.includes('حياة') || branch.includes('138')) return 1;
  return 1;
}

const KIND_SALE = 4;
const KIND_RETURN = 5;

let cachedWalkInSeq = null;

function roundAmount(n) {
  return Math.round(Number(n || 0));
}

function formatEdariTimestamp(dateStr) {
  const iso = edariDateToIso(dateStr);
  return `TIMESTAMP '${iso} 12:00:00'`;
}

function edariDateToIso(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function formatEdariDateOnly(dateStr) {
  const iso = edariDateToIso(dateStr);
  const [y, mo, d] = iso.split('-');
  return `'${d}/${mo}/${y}'`;
}

async function nextJournalBondNum() {
  const r = await runQuery('SELECT MAX(Num) AS maxNum FROM File12n WHERE Num IS NOT NULL AND Num > 0');
  if (!r.ok) throw new Error(r.error || 'فشل جلب رقم سند القيد من إداري');
  const maxNum = Number(rowObjects(r)[0]?.maxNum ?? rowObjects(r)[0]?.MAXNUM ?? 0);
  return maxNum + 1;
}

async function nextSeq(table) {
  await syncAutoIncTables([table]);
  const r = await runQuery(`SELECT MAX(Seq) AS maxSeq FROM ${table}`);
  if (!r.ok) throw new Error(r.error || `فشل جلب Seq من ${table}`);
  const rows = rowObjects(r);
  return Number(rows[0]?.maxSeq ?? rows[0]?.MAXSEQ ?? 0) + 1;
}

async function allocateNativeBillNum(invoiceBook, edariKind) {
  const ceiling = shorjaBillNumFloor();
  const book = Number(invoiceBook);
  const kind = Number(edariKind);
  const maxSql = kind === KIND_RETURN
    ? `SELECT MAX(Num) AS maxNum FROM File15n WHERE Kind = ${kind} AND Book = ${book} AND Num < ${ceiling}`
    : `SELECT MAX(Num) AS maxNum FROM File15n
       WHERE Kind = ${kind} AND Book = ${book} AND Num < ${ceiling}
         AND remarks NOT LIKE '%SHORJA%'`;
  const r = await runQuery(maxSql);
  if (!r.ok) throw new Error(r.error || 'فشل جلب رقم فاتورة الإداري');
  let candidate = Number(rowObjects(r)[0]?.maxNum ?? rowObjects(r)[0]?.MAXNUM ?? 0) + 1;
  if (candidate < 1) candidate = 1;
  for (let i = 0; i < 5000; i++) {
    const exists = await runQuery(`SELECT Seq FROM File15n WHERE Num = ${candidate}`);
    if (!exists.ok) throw new Error(exists.error);
    if (!rowObjects(exists).length && candidate < ceiling) return candidate;
    candidate += 1;
  }
  throw new Error('تعذر حجز رقم فاتورة في نطاق الإداري');
}

async function billHasGlobalNumCollision(billNum, billSeq) {
  const r = await runQuery(
    `SELECT Seq FROM File15n WHERE Num = ${Number(billNum)} AND Seq <> ${Number(billSeq)}`
  );
  if (!r.ok) return false;
  return rowObjects(r).length > 0;
}

async function billNeedsRenumber(billNum, billSeq, invoiceBook, edariKind) {
  if (billNum >= shorjaBillNumFloor()) return true;
  if (await billHasGlobalNumCollision(billNum, billSeq)) return true;
  const nativeMax = await runQuery(
    `SELECT MAX(Num) AS maxNum FROM File15n
     WHERE Kind = ${Number(edariKind)} AND Book = ${Number(invoiceBook)}
       AND Num < ${shorjaBillNumFloor()} AND remarks NOT LIKE '%SHORJA%'`
  );
  if (!nativeMax.ok) return false;
  const nativeCeil = Number(rowObjects(nativeMax)[0]?.maxNum ?? rowObjects(nativeMax)[0]?.MAXNUM ?? 0);
  return nativeCeil > 0 && billNum > nativeCeil + 200;
}

async function nextBillNum(invoiceBook, edariKind) {
  return allocateNativeBillNum(invoiceBook, edariKind);
}

async function renumberShorjaBill(billSeq, invoiceBook, edariKind) {
  const h = rowObjects(await runQuery(
    `SELECT Seq, Num, Kind, Book FROM File15n WHERE Seq = ${Number(billSeq)}`
  ))[0];
  if (!h) throw new Error(`لم تُعثر على الفاتورة Seq=${billSeq}`);
  const oldNum = Number(h.Num ?? h.num);
  const book = Number(h.Book ?? h.book ?? invoiceBook);
  const kind = Number(h.Kind ?? h.kind ?? edariKind);
  if (oldNum < shorjaBillNumFloor()
    && !(await billHasGlobalNumCollision(oldNum, billSeq))
    && !(await billNeedsRenumber(oldNum, billSeq, book, kind))) {
    return oldNum;
  }
  const newNum = await allocateNativeBillNum(book, kind);
  await runExecute(`UPDATE File15n SET Num = ${newNum} WHERE Seq = ${Number(billSeq)}`);
  await runExecute(`UPDATE file14n SET BillNo = ${newNum} WHERE BillSeq = ${Number(billSeq)}`);
  const journals = rowObjects(await runQuery(
    `SELECT Seq, Exp1 FROM File12n WHERE BillSeq = ${Number(billSeq)}`
  ));
  for (const j of journals) {
    const jSeq = Number(j.Seq ?? j.seq);
    const exp1 = String(j.Exp1 ?? j.exp1 ?? '').replace(String(oldNum), String(newNum));
    await runExecute(
      `UPDATE File12n SET BillNum = ${newNum}, Ref = '${sqlEscAscii(String(newNum))}', Exp1 = ${edariSqlLiteral(exp1)} WHERE Seq = ${jSeq}`
    );
  }
  return newNum;
}

async function readBillByNum(billNum, edariKind, invoiceBook) {
  const r = await runQuery(
    `SELECT Seq, Num FROM File15n WHERE Num = ${Number(billNum)} AND Kind = ${edariKind} AND Book = ${Number(invoiceBook)}`
  );
  if (!r.ok) throw new Error(r.error || 'فشل قراءة الفاتورة');
  const row = rowObjects(r)[0];
  if (!row) throw new Error(`لم تُعثر على الفاتورة ${billNum}`);
  return {
    edariBillSeq: String(row.Seq ?? row.seq),
    edariBillNum: String(row.Num ?? row.num)
  };
}

async function countBillLines(billSeq) {
  const r = await runQuery(`SELECT COUNT(*) AS c FROM file14n WHERE BillSeq = ${Number(billSeq)}`);
  if (!r.ok) return 0;
  return Number(rowObjects(r)[0]?.c ?? rowObjects(r)[0]?.C ?? 0);
}

async function countJournalLines(billSeq) {
  const r = await runQuery(`SELECT COUNT(*) AS c FROM File12n WHERE BillSeq = ${Number(billSeq)}`);
  if (!r.ok) return 0;
  return Number(rowObjects(r)[0]?.c ?? rowObjects(r)[0]?.C ?? 0);
}

async function billNeedsDisplayRepair(billSeq, invoiceBook) {
  const header = rowObjects(await runQuery(
    `SELECT ExtraInt1, PackList, "Date" FROM File15n WHERE Seq = ${Number(billSeq)}`
  ))[0];
  if (header) {
    const extra = Number(header.ExtraInt1 ?? header.extraint1 ?? -1);
    const dateStr = String(header.Date ?? header.date ?? '');
    if (extra !== INVOICE_PERSON) return true;
    if (/\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(dateStr)) return true;
  }
  const lineDate = await runQuery(
    `SELECT TOP 1 Seq FROM file14n WHERE BillSeq = ${Number(billSeq)}
     AND ("Date" IS NULL OR "Date" = '')`
  );
  if (lineDate.ok && rowObjects(lineDate)[0]) return true;
  const r = await runQuery(
    `SELECT TOP 1 Seq FROM file14n WHERE BillSeq = ${Number(billSeq)}
     AND (Book <> ${Number(invoiceBook)} OR person IS NULL OR person = 0)`
  );
  if (!r.ok) return false;
  return !!rowObjects(r)[0];
}

async function repairBillDisplayFields(billSeq, invoiceBook) {
  const header = rowObjects(await runQuery(
    `SELECT "Date" FROM File15n WHERE Seq = ${Number(billSeq)}`
  ))[0];
  const dateStr = edariDateToIso(header?.Date ?? header?.date);
  const upd15 = await runExecute(
    `UPDATE File15n SET Book = ${Number(invoiceBook)}, PrGrp = ${PRICE_GROUP},
      BillDayKind = 1, UnPosted = False, DTaxRecNo = ${TAX_REC_NO},
      ExtraInt1 = ${INVOICE_PERSON}, ExtraInt2 = 0, NoteClosed = False,
      "Date" = ${formatEdariTimestamp(dateStr)}
     WHERE Seq = ${Number(billSeq)}`
  );
  if (!upd15.ok) throw new Error(upd15.error || `فشل إصلاح رأس الفاتورة ${billSeq}`);
  const dateLit = formatEdariTimestamp(dateStr);
  const upd14 = await runExecute(
    `UPDATE file14n SET Book = ${Number(invoiceBook)}, person = ${INVOICE_PERSON},
      Equa = 1, Mst = 1, Curr = 0, MatName = '', "Sum" = 0, "Date" = ${dateLit}
     WHERE BillSeq = ${Number(billSeq)}`
  );
  if (!upd14.ok) throw new Error(upd14.error || `فشل إصلاح أسطر الفاتورة ${billSeq}`);
}
async function findShorjaBillState(payload) {
  const invoiceNo = String(payload.invoiceNo || '').trim();
  if (!invoiceNo) return null;
  const edariKind = payload.kind === 'return' ? KIND_RETURN : KIND_SALE;
  const r = await runQuery(
    `SELECT TOP 1 Seq, Num, DayBillN FROM File15n WHERE Kind = ${edariKind} AND remarks LIKE '%${sqlEscAscii(invoiceNo)}%' ORDER BY Seq DESC`
  );
  if (!r.ok) return null;
  const row = rowObjects(r)[0];
  if (!row) return null;
  const billSeq = Number(row.Seq ?? row.seq);
  const lineCount = await countBillLines(billSeq);
  return {
    edariBillSeq: String(billSeq),
    edariBillNum: String(row.Num ?? row.num),
    bondNum: Number(row.DayBillN ?? row.daybilln ?? 0),
    lineCount,
    complete: lineCount > 0
  };
}

async function findExistingShorjaBill(payload) {
  const state = await findShorjaBillState(payload);
  if (!state?.complete) return null;
  return {
    edariBillSeq: state.edariBillSeq,
    edariBillNum: state.edariBillNum
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

async function maxJournalSeq() {
  const r = await runQuery('SELECT MAX(Seq) AS maxSeq FROM File12n');
  if (!r.ok) throw new Error(r.error || 'فشل قراءة Seq من File12n');
  return Number(rowObjects(r)[0]?.maxSeq ?? rowObjects(r)[0]?.MAXSEQ ?? 0);
}

async function insertJournalEntry({
  acc, dateStr, amount, isDebit, exp1,
  billNum = 0, billSeq = 0, billKind = 0, billBook = 0,
  bondNum = 0, refBillNum = '', oppositeAcc = 0
}) {
  const ref = String(refBillNum || (billNum > 0 ? billNum : ''));
  const book = Number(billBook || INVOICE_BOOK || 0);
  const sql = `INSERT INTO File12n (Num, Acc, "Date", Am, Dept, Exp1, Exp2, BillNum, BillSeq, BillKind, BillBook, Remarks, ForBill, Ref, Two)
    VALUES (${Number(bondNum)}, ${Number(acc)}, ${formatEdariTimestamp(dateStr)}, ${roundAmount(amount)}, ${isDebit ? 'True' : 'False'},
      ${edariSqlLiteral(exp1)}, '', ${Number(billNum || 0)}, ${Number(billSeq || 0)}, ${Number(billKind || 0)}, ${book},
      '', 1, ${edariSqlLiteral(ref)}, ${Number(oppositeAcc || 0)})`;
  return runExecute(sql);
}

function journalRowMatches(row, { acc, amount, isDebit, billSeq = 0 }) {
  if (!row) return false;
  const bs = Number(billSeq || 0);
  if (bs > 0 && Number(row.BillSeq ?? row.billseq ?? 0) !== bs) return false;
  if (Number(row.Acc ?? row.acc) !== Number(acc)) return false;
  if (Number(row.Am ?? row.am) !== roundAmount(amount)) return false;
  const dept = String(row.Dept ?? row.dept).toLowerCase() === 'true';
  return dept === !!isDebit;
}

async function readJournalRow(seq) {
  const r = await runQuery(
    `SELECT Seq, Acc, Am, Dept, BillSeq FROM File12n WHERE Seq = ${Number(seq)}`
  );
  if (!r.ok) throw new Error(r.error || 'فشل قراءة قيد اليومية');
  return rowObjects(r)[0] || null;
}

async function lookupJournalSeq({ acc, amount, isDebit, billSeq = 0 }) {
  const deptLit = isDebit ? 'True' : 'False';
  const bs = Number(billSeq || 0);
  const attempts = bs > 0
    ? [
      `SELECT TOP 1 Seq, Acc, Am, Dept, BillSeq FROM File12n WHERE BillSeq = ${bs} AND Acc = ${Number(acc)} AND Am = ${roundAmount(amount)} AND Dept = ${deptLit} ORDER BY Seq DESC`,
      `SELECT TOP 1 Seq, Acc, Am, Dept, BillSeq FROM File12n WHERE BillSeq = ${bs} AND Acc = ${Number(acc)} AND Am = ${roundAmount(amount)} ORDER BY Seq DESC`,
      `SELECT TOP 1 Seq, Acc, Am, Dept, BillSeq FROM File12n WHERE BillSeq = ${bs} AND Acc = ${Number(acc)} ORDER BY Seq DESC`
    ]
    : [
      `SELECT TOP 1 Seq, Acc, Am, Dept, BillSeq FROM File12n WHERE Acc = ${Number(acc)} AND Am = ${roundAmount(amount)} AND Dept = ${deptLit} ORDER BY Seq DESC`
    ];
  for (const sql of attempts) {
    const r = await runQuery(sql);
    if (!r.ok) throw new Error(r.error || 'فشل قراءة قيد اليومية');
    const row = rowObjects(r)[0];
    if (journalRowMatches(row, { acc, amount, isDebit, billSeq })) {
      return Number(row.Seq ?? row.seq);
    }
  }
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function insertJournalEntryWithSeq(args) {
  const retries = 4;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const before = await maxJournalSeq();
    const ins = await insertJournalEntry(args);
    if (!ins.ok) return ins;
    await syncAutoIncTables(['File12n']);
    const after = await maxJournalSeq();
    if (after > before) {
      const row = await readJournalRow(after);
      if (journalRowMatches(row, args)) return { ok: true, seq: after };
    }
    if (attempt < retries - 1) await sleep(120);
  }
  const seq = await lookupJournalSeq({
    acc: args.acc,
    amount: args.amount,
    isDebit: args.isDebit,
    billSeq: args.billSeq
  });
  if (seq > 0) return { ok: true, seq };
  return { ok: false, error: 'لم يُعثر على قيد اليومية بعد الإدراج' };
}

async function postJournalPair({
  debitAcc, creditAcc, amount, dateStr, exp1,
  billNum = 0, billSeq = 0, billKind = 0, billBook = 0,
  bondNum = 0, refBillNum = 0
}) {
  const am = roundAmount(amount);
  if (am <= 0) return { ok: true, skipped: true };
  const bn = Number(bondNum || 0);
  if (!bn) return { ok: false, error: 'رقم سند القيد غير محدد' };
  const ref = String(refBillNum || billNum || '');
  await syncAutoIncTables(['File12n']);
  const d1 = await insertJournalEntryWithSeq({
    acc: debitAcc, dateStr, amount: am, isDebit: true,
    exp1, billNum, billSeq, billKind, billBook, bondNum: bn, refBillNum: ref, oppositeAcc: creditAcc
  });
  if (!d1.ok) return d1;
  const d2 = await insertJournalEntryWithSeq({
    acc: creditAcc, dateStr, amount: am, isDebit: false,
    exp1, billNum, billSeq, billKind, billBook, bondNum: bn, refBillNum: ref, oppositeAcc: debitAcc
  });
  if (!d2.ok) return d2;
  return { ok: true, journalSeqStart: d1.seq, journalSeqEnd: d2.seq, bondNum: bn };
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
  const priorState = await findShorjaBillState(payload);
  const invoiceBook = resolveInvoiceBook(payload);
  const edariKind = kind === 'return' ? KIND_RETURN : KIND_SALE;

  if (priorState?.complete) {
    const billSeq = Number(priorState.edariBillSeq);
    let billNum = Number(priorState.edariBillNum);
    let repaired = false;
    if (billNum >= shorjaBillNumFloor() || await billNeedsRenumber(billNum, billSeq, invoiceBook, edariKind)) {
      billNum = await renumberShorjaBill(billSeq, invoiceBook, edariKind);
      repaired = true;
    }
    if (await billNeedsDisplayRepair(billSeq, invoiceBook)) {
      await repairBillDisplayFields(billSeq, invoiceBook);
      repaired = true;
    }
    if (repaired) {
      await finalizeInvoiceWrites();
      return {
        ok: true,
        edariBillSeq: priorState.edariBillSeq,
        edariBillNum: String(billNum),
        edariBondNum: String(priorState.bondNum || ''),
        repaired: true
      };
    }
    return { ok: true, ...priorState, deduped: true };
  }

  const dateStr = payload.invoiceDate || new Date().toISOString().slice(0, 10);
  const { discount, grossTotal, paid } = invoiceAmounts(payload);
  const lines = (payload.lines || []).filter((l) => Number(l.qty) > 0 || Number(l.giftQty) > 0);
  if (!lines.length) {
    return { ok: false, error: 'لا توجد أسطر منتجات في الفاتورة — تعذر الترحيل إلى إداري' };
  }
  const lineCount = lines.length;
  const remarksRaw = [SHORJA_REMARKS, payload.branchName, payload.invoiceNo, payload.notes].filter(Boolean).join(' · ');
  const remarks = remarksRaw.length > 50 ? remarksRaw.slice(0, 47) + '...' : remarksRaw;
  const kindRecNo = kind === 'return' ? RETURNS_ACCOUNT_SEQ : SALES_ACCOUNT_SEQ;
  const cashRec = paid > 0 ? CASH_ACCOUNT_SEQ : 0;

  let billNum;
  let billSeq;
  let bondNum;
  const resuming = !!(priorState && !priorState.complete);

  if (resuming) {
    billNum = Number(priorState.edariBillNum);
    billSeq = Number(priorState.edariBillSeq);
    bondNum = priorState.bondNum || await nextJournalBondNum();
    const headerUpd = await runExecute(
      `UPDATE File15n SET Kind = ${edariKind}, "Date" = ${formatEdariTimestamp(dateStr)},
        Total = ${grossTotal}, Payment = ${paid}, DisCnt = ${discount}, "count" = ${lineCount},
        Two = ${customerSeq}, remarks = ${edariSqlLiteral(remarks)}, DayBillN = ${bondNum},
        DKindRecNo = ${kindRecNo}, DCash = ${cashRec}, DDiscntR = ${DISCOUNT_ACCOUNT_SEQ},
        Three = 0, PrGrp = ${PRICE_GROUP}, BillDayKind = 1, Book = ${invoiceBook},
        Equa = 1, curr = 0, DPurcash = 0, PayMethod = 0, NoteKind = 0, DExpR = 0,
        DTaxRecNo = ${TAX_REC_NO}, ExtraInt1 = ${INVOICE_PERSON}, ExtraInt2 = 0,
        PackList = 0, NoteClosed = False, UnPosted = False
       WHERE Seq = ${billSeq}`
    );
    if (!headerUpd.ok) return { ok: false, error: headerUpd.error || 'فشل تحديث رأس الفاتورة الناقصة في إداري' };
  } else {
    billNum = await nextBillNum(invoiceBook, edariKind);
    bondNum = await nextJournalBondNum();
    await syncAutoIncTables(['File15n']);
    const headerSql = `INSERT INTO File15n (Num, Kind, "Date", Total, Payment, DisCnt, "count", Two, remarks,
        DayBillN, DKindRecNo, DCash, DDiscntR, Three, PrGrp, BillDayKind, Book, Equa, curr, DPurcash,
        PayMethod, NoteKind, DExpR, DTaxRecNo, ExtraInt1, ExtraInt2, PackList, NoteClosed, UnPosted)
      VALUES (${billNum}, ${edariKind}, ${formatEdariTimestamp(dateStr)},
        ${grossTotal}, ${paid}, ${discount}, ${lineCount}, ${customerSeq}, ${edariSqlLiteral(remarks)},
        ${bondNum}, ${kindRecNo}, ${cashRec}, ${DISCOUNT_ACCOUNT_SEQ}, 0, ${PRICE_GROUP}, 1, ${invoiceBook}, 1, 0, 0,
        0, 0, 0, ${TAX_REC_NO}, ${INVOICE_PERSON}, 0, 0, False, False)`;
    const headerIns = await runExecute(headerSql);
    if (!headerIns.ok) return { ok: false, error: headerIns.error || 'فشل إنشاء رأس الفاتورة في إداري' };
    const bill = await readBillByNum(billNum, edariKind, invoiceBook);
    billSeq = Number(bill.edariBillSeq);
  }

  await syncAutoIncTables(['file14n']);
  const stockDeltas = [];
  for (const line of lines) {
    const mat = await resolveMaterial(line);
    const qty = Math.max(0, Number(line.qty || 0));
    const giftQty = Math.max(0, Number(line.giftQty || 0));
    const price = roundAmount(line.unitPrice);
    const lineDiscount = roundAmount(line.lineDiscount || 0);
    const lineTotal = roundAmount(line.lineTotal ?? (qty * price - lineDiscount));
    const lineSql = `INSERT INTO file14n (BillSeq, BillNo, Mat, MatName, Quant, Price, OBonus, Kind, MatRem, Two, Equa, Frst, Mst, person, Book, Curr, "Date", "Sum")
      VALUES (${billSeq}, ${billNum}, ${Number(mat.seq || 0)}, '',
        ${qty}, ${price}, ${giftQty}, ${edariKind}, '', ${customerSeq},
        1, ${kindRecNo}, 1, ${INVOICE_PERSON}, ${invoiceBook}, 0, ${formatEdariTimestamp(dateStr)}, 0)`;
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

  const journalCtx = { bondNum, refBillNum: billNum, billSeq, billKind: edariKind, billBook: invoiceBook, dateStr };
  const hasJournal = resuming ? (await countJournalLines(billSeq)) >= 2 : false;

  if (!hasJournal) {
    if (kind === 'return') {
      const expReturn = `مردودات مبيعات بالفاتورة ${billNum}`;
      const j = await postJournalPair({
        debitAcc: RETURNS_ACCOUNT_SEQ,
        creditAcc: customerSeq,
        amount: grossTotal,
        dateStr,
        exp1: expReturn,
        billNum,
        ...journalCtx
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
        ...journalCtx
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
          ...journalCtx
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
          ...journalCtx
        });
        if (!p.ok) return { ok: false, error: p.error || 'فشل قيد الدفع النقدي في إداري' };
      }
    }
  }

  await finalizeInvoiceWrites();

  return {
    ok: true,
    edariBillSeq: String(billSeq),
    edariBillNum: String(billNum),
    edariKind,
    edariBondNum: String(bondNum),
    customerSeq: String(customerSeq),
    resumed: resuming
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
  renumberShorjaBill,
  billHasGlobalNumCollision,
  billNeedsRenumber,
  repairBillDisplayFields,
  resolveCustomerSeq,
  resolveWalkInCustomerSeq,
  resolveInvoiceBook,
  SALES_ACCOUNT_SEQ,
  RETURNS_ACCOUNT_SEQ,
  CASH_ACCOUNT_SEQ,
  DISCOUNT_ACCOUNT_SEQ
};
