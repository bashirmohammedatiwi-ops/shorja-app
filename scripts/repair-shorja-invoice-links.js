/**
 * يربط فواتير الشورجة بسند القيد في إداري (DayBillN + File12n.Num + ForBill/Ref/Two).
 * الاستخدام: EDARI_WRITE_ENABLED=1 node scripts/repair-shorja-invoice-links.js
 */
const { runQuery, runExecute, rowObjects, canWriteEdari } = require('../server/lib/edari-bridge');
const { sqlEscAscii } = require('../server/lib/edari-accounts');
const { shorjaBillNumFloor } = require('../server/lib/edari-safety');
const { syncAutoIncTables } = require('../server/lib/edari-post-write');

const SALES_ACCOUNT_SEQ = Number(process.env.EDARI_SALES_ACCOUNT_SEQ || 41);
const RETURNS_ACCOUNT_SEQ = Number(process.env.EDARI_RETURNS_ACCOUNT_SEQ || 42);
const CASH_ACCOUNT_SEQ = Number(process.env.EDARI_CASH_ACCOUNT_SEQ || 316);
const DISCOUNT_ACCOUNT_SEQ = Number(process.env.EDARI_DISCOUNT_ACCOUNT_SEQ || 132);

async function nextJournalBondNum() {
  const r = await runQuery('SELECT MAX(Num) AS maxNum FROM File12n WHERE Num IS NOT NULL AND Num > 0');
  if (!r.ok) throw new Error(r.error || 'فشل جلب رقم سند القيد');
  return Number(rowObjects(r)[0]?.maxNum ?? 0) + 1;
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
  const iso = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const [y, mo, d] = iso.split('-');
  return `'${d}/${mo}/${y}'`;
}

function formatEdariTimestamp(dateStr) {
  const iso = edariDateToIso(String(dateStr || '').includes('/') ? dateStr : dateStr);
  const [y, mo, d] = iso.split('-');
  return `TIMESTAMP '${y}-${mo}-${d} 12:00:00'`;
}

async function ensureUniqueBondNum(billSeq, bondNum) {
  const bn = Number(bondNum || 0);
  if (!bn) return nextJournalBondNum();
  const dup = rowObjects(await runQuery(
    `SELECT Seq FROM File15n WHERE DayBillN = ${bn} AND Seq <> ${Number(billSeq)}`
  ));
  if (!dup.length) return bn;
  return nextJournalBondNum();
}

async function repairBill(header) {
  const billSeq = Number(header.Seq ?? header.seq);
  const billNum = Number(header.Num ?? header.num);
  const kind = Number(header.Kind ?? header.kind);
  const customerSeq = Number(header.Two ?? header.two);
  const kindRecNo = kind === 5 ? RETURNS_ACCOUNT_SEQ : SALES_ACCOUNT_SEQ;
  const book = Number(process.env.EDARI_INVOICE_BOOK || 1);
  const dateOnly = formatEdariDateOnly(edariDateToIso(header.Date ?? header.date));
  const dateTs = formatEdariTimestamp(header.Date ?? header.date);

  let bondNum = await ensureUniqueBondNum(billSeq, Number(header.DayBillN ?? header.daybilln ?? 0));

  const upd15 = await runExecute(
    `UPDATE File15n SET DayBillN = ${bondNum}, DKindRecNo = ${kindRecNo},
      DCash = 0, DDiscntR = ${DISCOUNT_ACCOUNT_SEQ}, Equa = 1, curr = 0, DPurcash = 0,
      Three = 0, PrGrp = ${Number(process.env.EDARI_PRICE_GROUP || 4)}, BillDayKind = 1,
      Book = ${Number(process.env.EDARI_INVOICE_BOOK || 1)}, PayMethod = 0, NoteKind = 0, DExpR = 0, UnPosted = False
     WHERE Seq = ${billSeq}`
  );
  if (!upd15.ok) throw new Error(upd15.error || `فشل تحديث رأس الفاتورة ${billNum}`);

  const jr = await runQuery(`SELECT Seq, Acc, Am, Dept FROM File12n WHERE BillSeq = ${billSeq} ORDER BY Seq`);
  if (!jr.ok) throw new Error(jr.error || `فشل قراءة قيود الفاتورة ${billNum}`);
  const journalRows = rowObjects(jr);
  let journalFixed = 0;
  for (const row of journalRows) {
    const seq = Number(row.Seq ?? row.seq);
    const acc = Number(row.Acc ?? row.acc);
    const am = Number(row.Am ?? row.am);
    const isDebit = String(row.Dept ?? row.dept).toLowerCase() === 'true';
    const pair = journalRows.find((other) => {
      if (Number(other.Seq ?? other.seq) === seq) return false;
      return Number(other.Am ?? other.am) === am
        && String(other.Dept ?? other.dept).toLowerCase() !== String(row.Dept ?? row.dept).toLowerCase();
    });
    const oppositeAcc = pair ? Number(pair.Acc ?? pair.acc) : (isDebit ? kindRecNo : customerSeq);
    const lineBillNum = Number(row.BillNum ?? row.billnum ?? 0);
    const upd12 = await runExecute(
      `UPDATE File12n SET Num = ${bondNum}, ForBill = 1, BillBook = ${book},
        Ref = '${sqlEscAscii(String(billNum))}', Two = ${oppositeAcc}
       WHERE Seq = ${seq}`
    );
    if (!upd12.ok) throw new Error(upd12.error || `فشل تحديث قيد ${seq}`);
    journalFixed += 1;
    void acc;
    void lineBillNum;
  }

  const person = Number(process.env.EDARI_INVOICE_PERSON || 255);
  const upd14 = await runExecute(
    `UPDATE file14n SET Two = ${customerSeq}, Equa = 1, Frst = ${kindRecNo}, Mst = 1,
      person = ${person}, Book = ${book}, Curr = 0, MatName = '', "Sum" = 0, "Date" = ${dateTs}
     WHERE BillSeq = ${billSeq}`
  );
  if (!upd14.ok) throw new Error(upd14.error || `فشل تحديث أسطر الفاتورة ${billNum}`);

  return { billNum, bondNum, journalFixed };
}

(async () => {
  if (!canWriteEdari()) {
    console.error('الكتابة إلى إداري غير متاحة — شغّل على Windows مع EDARI_WRITE_ENABLED=1');
    process.exit(1);
  }

  const floor = shorjaBillNumFloor();
  const r = await runQuery(
    `SELECT Seq, Num, Kind, "Date", Two, DayBillN FROM File15n
     WHERE Num >= ${floor} OR remarks LIKE '%SHORJA%'
     ORDER BY Seq`
  );
  if (!r.ok) throw new Error(r.error || 'فشل قراءة فواتير الشورجة');
  const bills = rowObjects(r);
  console.log(`فواتير شورجة للربط: ${bills.length}`);

  for (const header of bills) {
    const result = await repairBill(header);
    console.log(`  ✓ فاتورة ${result.billNum} → سند ${result.bondNum} (${result.journalFixed} قيد)`);
  }

  const testRows = await runQuery(
    `SELECT Seq, Acc, Am, Exp1 FROM File12n WHERE Exp1 LIKE 'test-%' OR Exp1 LIKE 'test_%'`
  );
  if (testRows.ok) {
    for (const row of rowObjects(testRows)) {
      await runExecute(`DELETE FROM File12n WHERE Seq = ${Number(row.Seq ?? row.seq)}`);
      console.log(`  - حذف قيد تجريبي: ${row.Exp1 ?? row.exp1}`);
    }
  }

  await syncAutoIncTables(['File15n', 'file14n', 'File12n']);
  console.log('\nتم ربط الفواتير بسند القيد.');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
