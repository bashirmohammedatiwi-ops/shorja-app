/**
 * يُكمل الجانب الناقص من قيد اليومية المزدوج لفواتير الشورجة في إداري.
 * الاستخدام: EDARI_WRITE_ENABLED=1 node scripts/repair-shorja-journal-pairs.js
 */
const { runQuery, runExecute, rowObjects, canWriteEdari } = require('../server/lib/edari-bridge');
const { edariSqlLiteral, sqlEscAscii } = require('../server/lib/edari-accounts');
const { shorjaBillNumFloor } = require('../server/lib/edari-safety');
const { syncAutoIncTables } = require('../server/lib/edari-post-write');

const SALES_ACCOUNT_SEQ = Number(process.env.EDARI_SALES_ACCOUNT_SEQ || 41);
const RETURNS_ACCOUNT_SEQ = Number(process.env.EDARI_RETURNS_ACCOUNT_SEQ || 42);

function roundAmount(n) {
  return Math.round(Number(n || 0));
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
function formatEdariTimestamp(dateStr) {
  const iso = String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `TIMESTAMP '${iso} 12:00:00'`;
}

function hasJournalLine(rows, { acc, amount, isDebit }) {
  return rows.some((row) => {
    const dept = String(row.Dept ?? row.dept).toLowerCase() === 'true';
    return Number(row.Acc ?? row.acc) === Number(acc)
      && Number(row.Am ?? row.am) === roundAmount(amount)
      && dept === !!isDebit;
  });
}

async function insertMissingLine({ acc, amount, isDebit, exp1, billNum, billSeq, billKind, billBook, dateStr }) {
  const book = Number(billBook || process.env.EDARI_INVOICE_BOOK || 1);
  const sql = `INSERT INTO File12n (Acc, "Date", Am, Dept, Exp1, Exp2, BillNum, BillSeq, BillKind, BillBook, Remarks)
    VALUES (${Number(acc)}, ${formatEdariTimestamp(dateStr)}, ${roundAmount(amount)}, ${isDebit ? 'True' : 'False'},
      ${edariSqlLiteral(exp1)}, '', ${Number(billNum)}, ${Number(billSeq)}, ${Number(billKind)}, ${book}, '')`;
  return runExecute(sql);
}

async function repairBill(header) {
  const billSeq = Number(header.Seq ?? header.seq);
  const billNum = Number(header.Num ?? header.num);
  const kind = Number(header.Kind ?? header.kind);
  const customerSeq = Number(header.Two ?? header.two);
  const total = roundAmount(header.Total ?? header.total);
  const dateStr = edariDateToIso(header.Date ?? header.date);

  const jr = await runQuery(
    `SELECT Seq, Acc, Am, Dept, Exp1 FROM File12n WHERE BillSeq = ${billSeq} ORDER BY Seq`
  );
  if (!jr.ok) throw new Error(jr.error || `فشل قراءة قيود الفاتورة ${billNum}`);
  const journalRows = rowObjects(jr);

  const fixes = [];
  if (kind === 4) {
    const expSale = `مبيعات بالفاتورة ${billNum}`;
    if (!hasJournalLine(journalRows, { acc: customerSeq, amount: total, isDebit: true })) {
      fixes.push({ acc: customerSeq, amount: total, isDebit: true, exp1: expSale });
    }
    if (!hasJournalLine(journalRows, { acc: SALES_ACCOUNT_SEQ, amount: total, isDebit: false })) {
      fixes.push({ acc: SALES_ACCOUNT_SEQ, amount: total, isDebit: false, exp1: expSale });
    }
  } else if (kind === 5) {
    const expReturn = `مردودات مبيعات بالفاتورة ${billNum}`;
    if (!hasJournalLine(journalRows, { acc: RETURNS_ACCOUNT_SEQ, amount: total, isDebit: true })) {
      fixes.push({ acc: RETURNS_ACCOUNT_SEQ, amount: total, isDebit: true, exp1: expReturn });
    }
    if (!hasJournalLine(journalRows, { acc: customerSeq, amount: total, isDebit: false })) {
      fixes.push({ acc: customerSeq, amount: total, isDebit: false, exp1: expReturn });
    }
  } else {
    return { billNum, skipped: true, reason: `Kind ${kind} غير مدعوم` };
  }

  if (!fixes.length) return { billNum, ok: true, repaired: 0 };

  for (const fix of fixes) {
    const ins = await insertMissingLine({
      ...fix,
      billNum,
      billSeq,
      billKind: kind,
      billBook: Number(header.Book ?? header.book ?? process.env.EDARI_INVOICE_BOOK ?? 1),
      dateStr
    });
    if (!ins.ok) throw new Error(ins.error || `فشل إدراج قيد للفاتورة ${billNum}`);
    console.log(`  + فاتورة ${billNum}: Acc=${fix.acc} ${fix.isDebit ? 'مدين' : 'دائن'} ${fix.amount}`);
  }
  return { billNum, ok: true, repaired: fixes.length };
}

(async () => {
  if (!canWriteEdari()) {
    console.error('الكتابة إلى إداري غير متاحة — شغّل على Windows مع EDARI_WRITE_ENABLED=1');
    process.exit(1);
  }

  const floor = shorjaBillNumFloor();
  const r = await runQuery(
    `SELECT Seq, Num, Kind, "Date", Total, Two, remarks FROM File15n
     WHERE Num >= ${floor} OR remarks LIKE '%SHORJA%'
     ORDER BY Seq`
  );
  if (!r.ok) throw new Error(r.error || 'فشل قراءة فواتير الشورجة');
  const bills = rowObjects(r);
  console.log(`فواتير شورجة للفحص: ${bills.length}`);

  let repairedBills = 0;
  let insertedLines = 0;
  for (const header of bills) {
    const result = await repairBill(header);
    if (result.repaired) {
      repairedBills += 1;
      insertedLines += result.repaired;
    } else if (result.skipped) {
      console.log(`تخطي ${result.billNum}: ${result.reason}`);
    }
  }

  await syncAutoIncTables(['File12n']);
  console.log(`\nتم: ${insertedLines} قيداً نُقصت في ${repairedBills} فاتورة`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
