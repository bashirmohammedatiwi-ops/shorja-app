const fs = require('fs');
const path = require('path');
const { STORE_NAME } = require('./config');
const { formatEnglishDateTime } = require('./datetime');

let cachedLogoUri = null;
function logoDataUri() {
  if (cachedLogoUri !== null) return cachedLogoUri;
  const file = path.join(__dirname, '../../public/brand/deema-alhayat-logo.jpg');
  try {
    cachedLogoUri = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    cachedLogoUri = '';
  }
  return cachedLogoUri;
}

function logoMarkup(cls) {
  const src = logoDataUri();
  if (!src) return `<div class="logo-fallback">د</div>`;
  return `<img class="${cls}" src="${src}" alt="${esc(STORE_NAME)}">`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtMoney(n) {
  return `${fmt(n)} د.ع`;
}

function payLabel(method) {
  if (method === 'credit') return 'آجل / حساب';
  if (method === 'partial') return 'دفع جزئي';
  if (method === 'issue') return 'إخراج مخزون';
  return 'نقدي';
}

function isAccountCustomer(invoice) {
  if (!invoice || invoice.kind === 'issue') return false;
  if (invoice.accountId) return true;
  return invoice.paymentMethod === 'credit' || invoice.paymentMethod === 'partial';
}

function invoicePageFrame() {
  return `<div class="page-edge" aria-hidden="true"></div><div class="page-edge inner" aria-hidden="true"></div>`;
}

function invoicePageFoot(thanksText) {
  return `
    <footer class="page-foot">
      <p class="thanks-line">${esc(thanksText || 'شكراً لزيارتكم')}</p>
      <div class="phone-row">
        <div class="phone-card">
          <span class="phone-k">مدير مبيعات الجملة</span>
          <b dir="ltr">07828630399</b>
        </div>
        <div class="phone-card">
          <span class="phone-k">محل الشورجة</span>
          <b dir="ltr">07707683512</b>
        </div>
      </div>
    </footer>`;
}

function invoiceFooterContacts() {
  return `
      <div class="contacts">
        <div class="phone-card">
          <span class="phone-k">مدير مبيعات الجملة</span>
          <b dir="ltr">07828630399</b>
        </div>
        <div class="phone-card">
          <span class="phone-k">محل الشورجة</span>
          <b dir="ltr">07707683512</b>
        </div>
      </div>`;
}

function invoiceDocMeta(invoice) {
  if (invoice.kind === 'return') return { title: 'إشعار مرتجع' };
  if (invoice.kind === 'issue') return { title: 'إذن إخراج مخزون' };
  return { title: 'فاتورة مبيعات' };
}

function formatReceiptDateTime(invoice) {
  return formatEnglishDateTime(invoice);
}

function receiptSummary(invoice) {
  const lines = invoice.lines || [];
  const itemQty = lines.reduce((s, l) => s + Number(l.qty || 0) + Number(l.giftQty || 0), 0);
  return { lineCount: lines.length, itemQty };
}

function thermalLineItems(invoice) {
  return (invoice.lines || []).map((l, i) => {
    const edited = l.priceEdited && l.originalPrice != null && l.originalPrice !== l.unitPrice;
    const gift = Number(l.giftQty || 0);
    const qtyPart = gift > 0
      ? `<span dir="ltr">${l.qty} + ${gift} هدية</span>`
      : `<span dir="ltr">${l.qty}</span>`;
    const pricePart = edited
      ? `<span dir="ltr">${fmt(l.unitPrice)}</span> <span class="was-price" dir="ltr">(${fmt(l.originalPrice)})</span>`
      : `<span dir="ltr">${fmt(l.unitPrice)}</span>`;
    return `
      <div class="item">
        <div class="item-head">
          <span class="item-num">${i + 1}</span>
          <span class="item-name">${esc(l.name)}${edited ? '<span class="edited-tag">*</span>' : ''}</span>
        </div>
        <div class="item-calc">
          ${qtyPart}
          <span class="item-x">×</span>
          ${pricePart}
          <span class="item-eq">=</span>
          <span class="item-total" dir="ltr">${fmt(l.lineTotal)}</span>
        </div>
        <div class="item-barcode" dir="ltr">${esc(l.barcode)}</div>
      </div>`;
  }).join('');
}

function a4LineItems(invoice, { showGifts = false, showMoney = true } = {}) {
  return (invoice.lines || []).map((l, i) => {
    const edited = l.priceEdited && l.originalPrice != null && l.originalPrice !== l.unitPrice;
    const gift = Number(l.giftQty || 0);
    const moneyCells = showMoney ? `
        <td class="t-price" dir="ltr">${fmt(l.unitPrice)}${edited ? `<div class="was">${fmt(l.originalPrice)}</div>` : ''}</td>
        <td class="t-total" dir="ltr">${fmt(l.lineTotal)}</td>` : '';
    const giftCell = showGifts ? `<td class="t-gift" dir="ltr">${gift > 0 ? `<span class="gift-val">${gift}</span>` : '—'}</td>` : '';
    return `
      <tr>
        <td class="t-idx">${i + 1}</td>
        <td class="t-name">
          <strong>${esc(l.name)}</strong>
          ${edited ? '<span class="tag-edit">سعر معدّل</span>' : ''}
          <span class="t-code" dir="ltr">${esc(l.barcode)}</span>
        </td>
        <td class="t-qty" dir="ltr">${l.qty}</td>
        ${giftCell}
        ${moneyCells}
      </tr>`;
  }).join('');
}

function totCell(label, value, extraClass = '') {
  return `<div class="tot-cell${extraClass ? ` ${extraClass}` : ''}"><span>${label}</span><b dir="ltr">${value}</b></div>`;
}

function totGrid(cells) {
  if (!cells.length) return '';
  return `<div class="tot-grid">${cells.join('')}</div>`;
}

function a4TotalsPanel(invoice, accent, debtInfo) {
  const top = [totCell('المجموع الفرعي', fmt(invoice.subtotal))];
  if (Number(invoice.discount)) {
    top.push(totCell('الخصم', `− ${fmt(invoice.discount)}`, 'disc'));
  }
  let html = totGrid(top);
  html += `<div class="tot-grand"><span>الصافي</span><b dir="ltr">${fmtMoney(invoice.total)}</b></div>`;

  const after = [];
  if (Number(invoice.paidAmount)) {
    after.push(totCell('المدفوع', fmt(invoice.paidAmount), 'paid'));
  }

  if (isAccountCustomer(invoice)) {
    const prev = Number(debtInfo?.previousDebt || 0);
    const due = Number(debtInfo?.invoiceDue || invoice.dueAmount || 0);
    const total = Number(debtInfo?.totalDebt || 0);
    if (prev > 0 || due > 0) {
      html += totGrid(after);
      html += `<div class="tot-sep">حساب العميل</div>`;
      const debt = [];
      if (prev > 0) debt.push(totCell('ديون سابقة', fmtMoney(prev), 'debt-prev'));
      if (due > 0) debt.push(totCell('دين هذه الفاتورة', fmtMoney(due), 'due'));
      if (total > 0 && prev > 0) debt.push(totCell('إجمالي الدين', fmtMoney(total), 'debt-total'));
      html += totGrid(debt);
      return html;
    }
  } else if (Number(invoice.dueAmount)) {
    after.push(totCell('المتبقي', fmtMoney(invoice.dueAmount), 'due'));
  }
  html += totGrid(after);
  return html;
}

function buildA4InvoiceHtml(invoice, branchName, opts) {
  const doc = invoiceDocMeta(invoice);
  const title = doc.title;
  const thanksText = 'شكراً لزيارتكم';
  const debtInfo = opts.debtInfo || null;
  const summary = receiptSummary(invoice);
  const giftTotal = (invoice.lines || []).reduce((s, l) => s + Number(l.giftQty || 0), 0);
  const soldTotal = (invoice.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const dateTime = formatReceiptDateTime(invoice);
  const customer = invoice.customerName || invoice.accountName || 'عميل نقدي';
  const isIssue = invoice.kind === 'issue';
  const showGifts = !isIssue && giftTotal > 0;
  const showMoney = !isIssue;
  const nameWidth = showMoney ? (showGifts ? '46%' : '54%') : '72%';
  const sheet = (copyLabel) => `
  <section class="sheet">
      <header class="mast">
        <div class="id-bar">
          <span class="copy-mark">${esc(copyLabel)}</span>
          <span class="doc-kind">${esc(title)}</span>
        </div>
        <div class="brand-center">
          ${logoMarkup('logo-img')}
          <p class="slogan">simply the best in beauty</p>
        </div>
      </header>
      <div class="info">
        <div class="info-cell">
          <span class="k">رقم الفاتورة</span>
          <span class="v ltr">${esc(invoice.invoiceNo)}</span>
        </div>
        <div class="info-cell">
          <span class="k">التاريخ والوقت</span>
          <span class="v ltr">${esc(dateTime)}</span>
        </div>
        <div class="info-cell">
          <span class="k">العميل</span>
          <span class="v">${esc(customer)}</span>
        </div>
        <div class="info-cell">
          <span class="k">${isIssue ? 'النوع' : 'طريقة الدفع'}</span>
          <span class="v">${esc(isIssue ? title : payLabel(invoice.paymentMethod))}</span>
        </div>
      </div>
      <div class="tbl-box">
        <table class="tbl">
          <colgroup>
            <col style="width:6%">
            <col style="width:${nameWidth}">
            <col style="width:10%">
            ${showGifts ? '<col style="width:10%">' : ''}
            ${showMoney ? '<col style="width:14%"><col style="width:16%">' : ''}
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th class="th-name">المنتج</th>
              <th>الكمية</th>
              ${showGifts ? '<th>هدايا</th>' : ''}
              ${showMoney ? '<th>السعر</th><th>الإجمالي</th>' : ''}
            </tr>
          </thead>
          <tbody>${a4LineItems(invoice, { showGifts, showMoney })}</tbody>
        </table>
      </div>
      <div class="sum-box">
        <div class="sum-head">ملخص الأصناف</div>
        <div class="sum-stats">
          <div><span>الأصناف</span><b dir="ltr">${summary.lineCount}</b></div>
          <div><span>القطع</span><b dir="ltr">${soldTotal}</b></div>
          ${giftTotal ? `<div><span>الهدايا</span><b dir="ltr">${giftTotal}</b></div>` : ''}
        </div>
      </div>
      ${showMoney ? `<div class="sum-box totals">
        <div class="sum-head">ملخص المبالغ</div>
        <div class="tot-body">${a4TotalsPanel(invoice, null, debtInfo)}</div>
      </div>` : ''}
      ${invoice.notes ? `<div class="sum-box notes-box"><div class="sum-head">ملاحظات</div><div class="notes-v">${esc(invoice.notes)}</div></div>` : ''}
  </section>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)} ${esc(invoice.invoiceNo)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 7mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif;
      font-size: 10px;
      color: #000;
      background: #fff;
      line-height: 1.3;
    }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page-edge {
      position: fixed;
      top: 0; right: 0; bottom: 0; left: 0;
      border: 1.7px solid #000;
      pointer-events: none;
      z-index: 4;
    }
    .page-edge.inner {
      top: 1.5mm; right: 1.5mm; bottom: 1.5mm; left: 1.5mm;
      border-width: 0.7px;
    }
    .sheet {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 2mm 3mm 28mm;
      page-break-after: always;
    }
    .sheet:last-of-type { page-break-after: auto; }
    .page-foot {
      position: fixed;
      left: 3.2mm;
      right: 3.2mm;
      bottom: 3.2mm;
      height: 23mm;
      padding: 1.8mm 2mm 0;
      background: #fff;
      text-align: center;
      z-index: 5;
      border-top: 1.3px solid #000;
    }
    .thanks-line {
      font-size: 13.5px;
      font-weight: 800;
      letter-spacing: 0.05em;
      margin: 0 0 1.8mm;
      line-height: 1.2;
    }
    .phone-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .phone-card {
      border: 1px solid #000;
      padding: 3px 8px 4px;
      text-align: center;
    }
    .phone-k {
      display: block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin-bottom: 0;
    }
    .phone-card b {
      display: block;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.04em;
      direction: ltr;
    }
    .mast { margin-bottom: 5px; }
    .id-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .copy-mark, .doc-kind {
      font-size: 12.5px;
      font-weight: 800;
      letter-spacing: 0.06em;
      border: 1px solid #000;
      padding: 3px 12px;
    }
    .doc-kind { border-width: 1.6px; }
    .brand-center {
      text-align: center;
      padding: 0 0 5px;
      border-bottom: 2px double #000;
    }
    .logo-img {
      display: block;
      height: 82px;
      width: auto;
      max-width: 290px;
      margin: 0 auto 4px;
      object-fit: contain;
      filter: grayscale(100%) contrast(1.12);
    }
    .logo-fallback {
      width: 62px; height: 62px;
      margin: 0 auto 4px;
      border: 1.5px solid #000;
      font-size: 26px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .slogan {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: lowercase;
    }
    .info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      margin: 6px 0 6px;
      border: 1.3px solid #000;
    }
    .info-cell {
      padding: 4px 8px 5px;
      min-width: 0;
      border-inline-start: 1px solid #000;
      border-bottom: 1px solid #000;
    }
    .info-cell:nth-child(odd) { border-inline-start: 0; }
    .info-cell:nth-last-child(-n+2) { border-bottom: 0; }
    .info-cell .k {
      display: block;
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.06em;
      margin-bottom: 1px;
    }
    .info-cell .v { display: block; font-size: 13px; font-weight: 800; word-break: break-word; }
    .info-cell .v.ltr { direction: ltr; font-family: Consolas, monospace; font-size: 13px; }
    .tbl-box {
      border: 1.3px solid #000;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .tbl { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0; }
    .tbl thead { display: table-header-group; }
    .tbl th {
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.03em;
      padding: 4px 4px 3px;
      text-align: center;
      border-bottom: 1.3px solid #000;
    }
    .tbl th.th-name { text-align: right; padding-right: 8px; }
    .tbl td { padding: 4px 4px; border-bottom: 1px dotted #000; text-align: center; vertical-align: middle; }
    .tbl tbody tr:last-child td { border-bottom: none; }
    .tbl tbody tr { page-break-inside: avoid; }
    .t-idx { font-weight: 700; font-size: 10.5px; }
    .t-name { text-align: right !important; padding-right: 8px !important; vertical-align: top; }
    .t-name strong { display: block; font-size: 10.5px; font-weight: 800; }
    .t-code { display: block; margin-top: 1px; font-family: Consolas, monospace; font-size: 8px; direction: ltr; letter-spacing: 0.02em; }
    .t-qty { font-weight: 800; font-size: 13.5px; }
    .t-price { font-weight: 700; font-size: 13px; }
    .t-total { font-weight: 800; font-size: 13.5px; }
    .t-qty, .t-price, .t-total, .t-gift, .sum-stats b, .tot-cell b, .tot-grand b {
      font-variant-numeric: tabular-nums;
    }
    .tag-edit {
      display: inline-block; margin-top: 1px; font-size: 7.5px;
      border: 1px solid #000; padding: 0 4px; font-weight: 800;
    }
    .gift-val { display: inline-block; border: 1px solid #000; font-weight: 800; padding: 0 5px; }
    .was { font-size: 7.5px; text-decoration: line-through; margin-top: 1px; }
    .sum-box {
      width: 100%;
      border: 1.3px solid #000;
      margin-bottom: 5px;
      page-break-inside: avoid;
    }
    .sum-head {
      text-align: center;
      padding: 4px 6px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      border-bottom: 1px solid #000;
    }
    .sum-stats {
      display: flex;
      text-align: center;
    }
    .sum-stats > div { flex: 1; padding: 4px 4px 5px; border-inline-start: 1px solid #000; }
    .sum-stats > div:first-child { border-inline-start: 0; }
    .sum-stats span { display: block; font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 0; }
    .sum-stats b { display: block; font-size: 16px; font-weight: 800; }
    .totals .tot-body { padding: 0; }
    .tot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .tot-cell {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      padding: 5px 8px;
      font-size: 13px;
      border-inline-start: 1px solid #000;
      border-bottom: 1px dotted #000;
    }
    .tot-cell:nth-child(odd) { border-inline-start: 0; }
    .tot-cell:last-child:nth-child(odd) {
      grid-column: 1 / -1;
      border-inline-start: 0;
    }
    .tot-cell b { white-space: nowrap; font-weight: 800; }
    .tot-grid:last-child .tot-cell { border-bottom: none; }
    .tot-sep {
      margin: 0;
      padding: 4px 6px;
      font-size: 10px;
      font-weight: 800;
      text-align: center;
      letter-spacing: 0.06em;
      border-top: 1.3px solid #000;
      border-bottom: 1px solid #000;
    }
    .tot-grand {
      display: flex; justify-content: space-between; align-items: center;
      margin: 0; padding: 6px 8px;
      border: none;
      border-top: 1.5px solid #000;
      border-bottom: 1.5px solid #000;
      font-size: 13px; font-weight: 800;
    }
    .tot-grand b { font-size: 18px; }
    .tot-cell.debt-total { font-weight: 800; }
    .notes-box .notes-v { padding: 5px 10px 6px; font-size: 10.5px; font-weight: 600; }
    @media print { .sheet { max-width: 100%; } }
  </style>
</head>
<body>
  ${invoicePageFrame()}
  ${invoicePageFoot(thanksText)}
  ${sheet('نسخة العميل')}
  ${sheet('نسخة الشركة')}
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function totalsBlock(invoice, { compact = false, debtInfo = null } = {}) {
  const rows = [];
  rows.push(`<div class="total-row"><span>المجموع الفرعي</span><span dir="ltr">${fmt(invoice.subtotal)}</span></div>`);
  if (Number(invoice.discount)) {
    rows.push(`<div class="total-row discount"><span>الخصم</span><span dir="ltr">− ${fmt(invoice.discount)}</span></div>`);
  }
  rows.push(`<div class="total-row grand"><span>الصافي</span><span dir="ltr">${fmtMoney(invoice.total)}</span></div>`);
  if (Number(invoice.paidAmount)) {
    rows.push(`<div class="total-row paid"><span>المبلغ المدفوع</span><span dir="ltr">${fmt(invoice.paidAmount)}</span></div>`);
  }
  if (isAccountCustomer(invoice)) {
    const prev = Number(debtInfo?.previousDebt || 0);
    const due = Number(debtInfo?.invoiceDue || invoice.dueAmount || 0);
    const total = Number(debtInfo?.totalDebt || 0);
    if (prev > 0 || due > 0) {
      rows.push(`<div class="total-row debt-sep"><span>حساب العميل</span><span></span></div>`);
      if (prev > 0) {
        rows.push(`<div class="total-row debt-prev"><span>ديون سابقة</span><span dir="ltr">${fmtMoney(prev)}</span></div>`);
      }
      if (due > 0) {
        rows.push(`<div class="total-row due"><span>دين هذه الفاتورة</span><span dir="ltr">${fmtMoney(due)}</span></div>`);
      }
      if (total > 0 && prev > 0) {
        rows.push(`<div class="total-row debt-total"><span>إجمالي الدين</span><span dir="ltr">${fmtMoney(total)}</span></div>`);
      }
    }
  } else if (Number(invoice.dueAmount)) {
    rows.push(`<div class="total-row due"><span>المتبقي على الحساب</span><span dir="ltr">${fmt(invoice.dueAmount)}</span></div>`);
  }
  return rows.join('');
}

function invoicePrintHtml(invoice, branchName = '', opts = {}) {
  const doc = invoiceDocMeta(invoice);
  const title = doc.title;
  const thermal = !!opts.thermal;
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
  const debtInfo = opts.debtInfo || null;
  const summary = receiptSummary(invoice);
  const dateTime = formatReceiptDateTime(invoice);
  const customer = invoice.customerName || invoice.accountName || 'نقدي';

  if (thermal) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)} ${esc(invoice.invoiceNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Tahoma, 'Segoe UI', Arial, sans-serif;
      width: 72mm;
      margin: 4mm auto;
      padding: 6px 4px 10px;
      font-size: 11px;
      color: #000;
      line-height: 1.45;
    }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .receipt { width: 100%; page-break-after: always; }
    .receipt:last-of-type { page-break-after: auto; }
    .copy-badge {
      display: block;
      text-align: center;
      border: 1.4px solid #000;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.12em;
      margin-bottom: 8px;
    }
    .cut {
      border: none;
      border-top: 1px dashed #000;
      margin: 14px 0;
    }

    .rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 8px 0;
    }
    .rule-solid {
      border: none;
      border-top: 2px solid #000;
      margin: 8px 0;
    }
    .rule-double {
      border: none;
      border-top: 3px double #000;
      margin: 10px 0 8px;
    }
    .ornament { width: 72px; height: 12px; display: block; margin: 4px auto 6px; }

    .head { text-align: center; padding: 2px 0 4px; }
    .logo-img {
      display: block;
      height: auto;
      width: auto;
      max-width: 54mm;
      max-height: 24mm;
      margin: 0 auto 5px;
      object-fit: contain;
      filter: grayscale(100%) contrast(1.12);
    }
    .logo-fallback {
      width: 40px; height: 40px;
      margin: 0 auto 8px;
      border: 2px solid #000;
      font-size: 20px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .slogan {
      font-size: 8.5px;
      letter-spacing: 0.12em;
      font-weight: 700;
      margin: 2px 0 6px;
      text-transform: lowercase;
    }
    .doc-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 3px 12px;
      border: 1.5px solid #000;
      margin: 2px 0 4px;
    }
    .branch-name {
      font-size: 10px;
      color: #000;
      font-weight: 700;
      margin-top: 2px;
    }

    .meta-box {
      border: 1.6px solid #000;
      padding: 8px 10px;
      font-size: 10px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      padding: 2px 0;
    }
    .meta-row + .meta-row { border-top: 1px dotted #000; margin-top: 2px; padding-top: 4px; }
    .meta-lbl { color: #000; font-weight: 600; flex-shrink: 0; }
    .meta-val { font-weight: 800; text-align: left; }
    .meta-val.mono { font-family: Consolas, 'Courier New', monospace; font-size: 9.5px; letter-spacing: 0.02em; }

    .items-head {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      font-weight: 800;
      color: #000;
      padding: 0 2px 4px;
    }

    .item {
      padding: 7px 0;
      border-bottom: 1px dashed #000;
    }
    .item:last-child { border-bottom: none; }
    .item-head { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 3px; }
    .item-num {
      flex-shrink: 0;
      width: 16px; height: 16px;
      border: 1px solid #000;
      font-size: 8px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }
    .item-name { font-weight: 800; font-size: 11px; line-height: 1.35; flex: 1; }
    .edited-tag { color: #000; font-weight: 800; margin-inline-start: 2px; }
    .item-calc {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      color: #000;
      padding-inline-start: 22px;
      flex-wrap: wrap;
    }
    .item-x, .item-eq { color: #000; font-weight: 600; }
    .item-total { margin-inline-start: auto; font-size: 11px; font-weight: 800; color: #000; }
    .was-price { font-size: 8px; color: #000; font-weight: 600; text-decoration: line-through; }
    .item-barcode { font-size: 8px; color: #000; padding-inline-start: 22px; margin-top: 2px; font-family: Consolas, monospace; }

    .totals { margin-top: 4px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 2px;
      font-size: 10px;
      font-weight: 600;
    }
    .total-row.discount,
    .total-row.paid,
    .total-row.due,
    .total-row.debt-prev,
    .total-row.debt-total { color: #000; font-weight: 800; }
    .total-row.grand {
      margin-top: 6px;
      padding: 8px 10px;
      background: #fff;
      border: 2px solid #000;
      font-size: 13px;
      font-weight: 800;
    }
    .total-row.grand span:last-child { font-size: 15px; }
    .total-row.debt-sep {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #000;
      font-size: 9px;
      font-weight: 800;
      color: #000;
    }

    .pay-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 8px;
      padding: 7px 8px;
      background: #fff;
      color: #000;
      border: 2px solid #000;
      font-size: 10px;
      font-weight: 800;
    }

    .notes {
      margin-top: 8px;
      padding: 6px 8px;
      border: 1px dashed #000;
      font-size: 9px;
      color: #000;
    }
    .notes strong { color: #000; }

    .summary-line {
      text-align: center;
      font-size: 9px;
      color: #000;
      margin-top: 6px;
    }

    .foot {
      text-align: center;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #000;
    }
    .foot-msg {
      font-size: 10px;
      font-weight: 700;
      color: #000;
      line-height: 1.6;
      margin-bottom: 4px;
    }
    .foot-brand {
      font-size: 9px;
      color: #000;
      font-weight: 600;
    }
    .contacts {
      margin-top: 8px;
      display: grid;
      gap: 6px;
    }
    .contacts .phone-card {
      border: 1.3px solid #000;
      padding: 5px 8px;
      text-align: center;
    }
    .contacts .phone-k {
      display: block;
      font-size: 8px;
      font-weight: 800;
      margin-bottom: 2px;
    }
    .contacts .phone-card b {
      display: block;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 11px;
      font-weight: 800;
      direction: ltr;
      letter-spacing: 0.04em;
    }
    .inv-code {
      margin-top: 6px;
      font-family: Consolas, monospace;
      font-size: 9px;
      letter-spacing: 0.12em;
      color: #000;
      direction: ltr;
    }

    @media print {
      @page { margin: 0; }
      body { width: 72mm; padding: 0; margin: 4mm auto; }
    }
  </style>
</head>
<body>
  ${['نسخة العميل', 'نسخة الشركة'].map((copyLabel) => `
  <div class="receipt">
    <div class="copy-badge">${copyLabel}</div>
    <header class="head">
      ${logoMarkup('logo-img')}
      <div class="slogan">simply the best in beauty</div>
      <div class="doc-badge">${title}</div>
    </header>

    <hr class="rule-solid">

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-lbl">رقم الفاتورة</span>
        <span class="meta-val mono" dir="ltr">${esc(invoice.invoiceNo)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-lbl">التاريخ والوقت</span>
        <span class="meta-val" dir="ltr">${esc(dateTime)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-lbl">العميل</span>
        <span class="meta-val">${esc(customer)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-lbl">طريقة الدفع</span>
        <span class="meta-val">${payLabel(invoice.paymentMethod)}</span>
      </div>
    </div>

    <hr class="rule">

    <div class="items-head">
      <span>المنتجات (${summary.lineCount})</span>
      <span>المجموع</span>
    </div>

    <section class="items">
      ${thermalLineItems(invoice)}
    </section>

    <hr class="rule-double">

    <div class="totals">
      ${totalsBlock(invoice, { debtInfo })}
    </div>

    <div class="pay-strip">
      <span>${payLabel(invoice.paymentMethod)}</span>
      <span>·</span>
      <span dir="ltr">${fmtMoney(invoice.total)}</span>
    </div>

    ${invoice.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${esc(invoice.notes)}</div>` : ''}

    <div class="summary-line">${summary.lineCount} بند · ${summary.itemQty} قطعة</div>

    <footer class="foot">
      <div class="foot-msg">شكراً لزيارتكم</div>
      ${invoiceFooterContacts()}
      <div class="inv-code">${esc(invoice.invoiceNo)}</div>
    </footer>
  </div>`).join('<hr class="cut">')}
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
  }

  return buildA4InvoiceHtml(invoice, branchName, { footer, debtInfo });
}

function parseProductsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const items = [];
  const start = lines[0].includes('barcode') || lines[0].includes('باركود') ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 3) continue;
    const [barcode, name, price, stock, category] = parts;
    if (!barcode || !name) continue;
    items.push({
      barcode,
      name,
      price: Number(price) || 0,
      stockQty: Number(stock) || 0,
      category: category || ''
    });
  }
  return items;
}

module.exports = { invoicePrintHtml, parseProductsCsv };
