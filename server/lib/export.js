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

function brandOrnament(cls = 'ornament') {
  return `<svg class="${cls}" viewBox="0 0 220 20" fill="none" aria-hidden="true">
    <path d="M8 12c24-10 48-10 72-3s48 12 72 3 48-10 60-4" stroke="#000" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M18 16c22-8 44-8 66-2s44 10 66 2 40-8 52-3" stroke="#000" stroke-width=".7" stroke-linecap="round"/>
  </svg>`;
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

function invoicePageFoot() {
  return `
    <footer class="page-foot">
      ${brandOrnament('ornament ornament-foot')}
      <div class="page-foot-row">
        <span>مدير مبيعات الجملة <b dir="ltr">07828630399</b></span>
        <span class="foot-mark">${esc(STORE_NAME)}</span>
        <span>محل الشورجة <b dir="ltr">07707683512</b></span>
      </div>
    </footer>`;
}

function invoiceFooterContacts() {
  return `
      <div class="contacts">
        <div class="contact-row"><span>مدير مبيعات الجملة</span><b dir="ltr">07828630399</b></div>
        <div class="contact-row"><span>محل الشورجة</span><b dir="ltr">07707683512</b></div>
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

function a4TotalsPanel(invoice, accent, debtInfo) {
  let html = `<div class="tot-line"><span>المجموع الفرعي</span><b dir="ltr">${fmt(invoice.subtotal)}</b></div>`;
  if (Number(invoice.discount)) {
    html += `<div class="tot-line disc"><span>الخصم</span><b dir="ltr">− ${fmt(invoice.discount)}</b></div>`;
  }
  html += `<div class="tot-grand"><span>الصافي</span><b dir="ltr">${fmtMoney(invoice.total)}</b></div>`;
  if (Number(invoice.paidAmount)) {
    html += `<div class="tot-line paid"><span>المدفوع</span><b dir="ltr">${fmt(invoice.paidAmount)}</b></div>`;
  }
  if (isAccountCustomer(invoice)) {
    const prev = Number(debtInfo?.previousDebt || 0);
    const due = Number(debtInfo?.invoiceDue || invoice.dueAmount || 0);
    const total = Number(debtInfo?.totalDebt || 0);
    if (prev > 0 || due > 0) {
      html += `<div class="tot-sep">حساب العميل</div>`;
      if (prev > 0) {
        html += `<div class="tot-line debt-prev"><span>ديون سابقة</span><b dir="ltr">${fmtMoney(prev)}</b></div>`;
      }
      if (due > 0) {
        html += `<div class="tot-line due"><span>دين هذه الفاتورة</span><b dir="ltr">${fmtMoney(due)}</b></div>`;
      }
      if (total > 0 && prev > 0) {
        html += `<div class="tot-line debt-total"><span>إجمالي الدين</span><b dir="ltr">${fmtMoney(total)}</b></div>`;
      }
    }
  } else if (Number(invoice.dueAmount)) {
    html += `<div class="tot-line due"><span>المتبقي</span><b dir="ltr">${fmtMoney(invoice.dueAmount)}</b></div>`;
  }
  return html;
}

function buildA4InvoiceHtml(invoice, branchName, opts) {
  const doc = invoiceDocMeta(invoice);
  const title = doc.title;
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
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
    <div class="frame">
      <header class="mast">
        <div class="mast-top">
          <span class="copy-mark">${esc(copyLabel)}</span>
          <span class="doc-kind">${esc(title)}</span>
        </div>
        <div class="brand-row">
          ${logoMarkup('logo-img')}
          <div class="brand-text">
            <p class="brand-en">deema alhayat</p>
            <h1>${esc(STORE_NAME)}</h1>
            ${brandOrnament()}
            <p class="brand-sub">${esc(branchName || 'نقطة البيع')} · ${summary.lineCount} صنف · ${soldTotal} قطعة${giftTotal ? ` · ${giftTotal} هدية` : ''}</p>
          </div>
          <div class="inv-plate">
            <span class="inv-k">رقم الفاتورة</span>
            <span class="inv-no" dir="ltr">${esc(invoice.invoiceNo)}</span>
          </div>
        </div>
      </header>
      <div class="info">
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
      <div class="bottom">
        <div class="side">
          ${invoice.notes ? `<div class="notes"><div class="k">ملاحظات</div><div class="v">${esc(invoice.notes)}</div></div>` : `<div class="quiet-card"><div class="k">ملخص الأصناف</div><div class="v">${summary.lineCount} صنف · ${soldTotal} قطعة${giftTotal ? ` · ${giftTotal} هدية` : ''}</div></div>`}
        </div>
        ${showMoney ? `<div class="totals">
          <div class="tot-head">ملخص المبالغ</div>
          <div class="tot-body">${a4TotalsPanel(invoice, null, debtInfo)}</div>
        </div>` : `<div class="quiet-card"><div class="k">عدد الأصناف</div><div class="v">${summary.lineCount} صنف · ${soldTotal} قطعة</div></div>`}
      </div>
      <div class="thanks">
        ${brandOrnament('ornament ornament-sm')}
        <p>${esc(footer)}</p>
      </div>
    </div>
  </section>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)} ${esc(invoice.invoiceNo)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 9mm 11mm 20mm 11mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif;
      font-size: 11px;
      color: #000;
      background: #fff;
      line-height: 1.45;
    }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 100%; max-width: 188mm; margin: 0 auto; page-break-after: always; }
    .sheet:last-of-type { page-break-after: auto; }
    .frame {
      border: 1.8px solid #000;
      box-shadow: inset 0 0 0 3.5px #fff, inset 0 0 0 4.5px #000;
      padding: 7mm 7mm 6mm;
    }
    .page-foot {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: 17mm;
      padding: 2mm 12mm 3mm;
      background: #fff;
      text-align: center;
    }
    .page-foot .ornament-foot { width: 88px; height: 10px; margin: 0 auto 2px; display: block; }
    .page-foot-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      font-size: 10px;
      font-weight: 700;
      border-top: 1.6px solid #000;
      padding-top: 3mm;
    }
    .page-foot-row b { font-family: Consolas, 'Courier New', monospace; letter-spacing: 0.05em; }
    .foot-mark { letter-spacing: 0.18em; font-size: 9px; font-weight: 800; }
    .ornament { width: 118px; height: 14px; display: block; }
    .ornament-sm { width: 92px; height: 12px; margin: 0 auto 6px; }
    .mast { margin-bottom: 8px; }
    .mast-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .copy-mark, .doc-kind {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      border: 1px solid #000;
      padding: 3px 11px;
    }
    .doc-kind { border-width: 1.6px; }
    .brand-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding-bottom: 10px;
      border-bottom: 3px double #000;
    }
    .logo-img {
      height: 64px;
      width: auto;
      max-width: 210px;
      object-fit: contain;
      flex-shrink: 0;
      filter: grayscale(100%) contrast(1.25);
    }
    .logo-fallback {
      width: 56px; height: 56px;
      border: 2px solid #000;
      font-size: 26px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-text { min-width: 0; }
    .brand-en {
      font-size: 9px;
      letter-spacing: 0.28em;
      font-weight: 700;
      text-transform: lowercase;
      margin-bottom: 1px;
    }
    .brand-text h1 { font-size: 23px; font-weight: 800; line-height: 1.15; }
    .brand-text .ornament { margin: 4px 0 5px; }
    .brand-sub { font-size: 10.5px; font-weight: 700; }
    .inv-plate {
      text-align: left;
      min-width: 168px;
      padding: 8px 12px 9px;
      border: 1.8px solid #000;
      box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 3px #000;
    }
    .inv-k { display: block; font-size: 8.5px; font-weight: 800; letter-spacing: 0.12em; margin-bottom: 4px; }
    .inv-no {
      display: block;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 13.5px;
      font-weight: 800;
      direction: ltr;
      letter-spacing: 0.04em;
    }
    .info {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 12px 0 11px;
      border-top: 1.6px solid #000;
      border-bottom: 1.6px solid #000;
    }
    .info-cell { padding: 8px 12px 9px; border-inline-start: 1px solid #000; min-width: 0; }
    .info-cell:first-child { border-inline-start: 0; padding-right: 0; }
    .info-cell .k {
      display: block;
      font-size: 8.5px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin-bottom: 3px;
    }
    .info-cell .v { display: block; font-size: 12.5px; font-weight: 800; word-break: break-word; }
    .info-cell .v.ltr { direction: ltr; font-family: Consolas, monospace; font-size: 11.5px; }
    .tbl { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 12px; }
    .tbl thead { display: table-header-group; }
    .tbl th {
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
      padding: 8px 6px 7px;
      text-align: center;
      border-top: 2.2px solid #000;
      border-bottom: 2.2px solid #000;
    }
    .tbl th.th-name { text-align: right; padding-right: 10px; }
    .tbl td { padding: 8px 6px; border-bottom: 1px dotted #000; text-align: center; vertical-align: top; }
    .tbl tbody tr:last-child td { border-bottom: 1.8px solid #000; }
    .tbl tbody tr { page-break-inside: avoid; }
    .t-idx { font-weight: 700; font-size: 10px; }
    .t-name { text-align: right !important; padding-right: 10px !important; }
    .t-name strong { display: block; font-size: 11.5px; font-weight: 800; }
    .t-code { display: block; margin-top: 2px; font-family: Consolas, monospace; font-size: 8.5px; direction: ltr; letter-spacing: 0.03em; }
    .t-qty { font-weight: 800; font-size: 12px; }
    .t-price { font-weight: 700; }
    .t-total { font-weight: 800; font-size: 12px; }
    .tag-edit {
      display: inline-block; margin-top: 2px; font-size: 8px;
      border: 1px solid #000; padding: 1px 5px; font-weight: 800;
    }
    .gift-val { display: inline-block; border: 1px solid #000; font-weight: 800; padding: 1px 7px; }
    .was { font-size: 8px; text-decoration: line-through; margin-top: 2px; }
    .bottom {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 236px;
      gap: 16px;
      align-items: start;
      page-break-inside: avoid;
    }
    .side { display: flex; flex-direction: column; gap: 10px; }
    .notes, .quiet-card {
      border: 1px solid #000;
      padding: 10px 12px;
      min-height: 54px;
    }
    .notes .k, .quiet-card .k { font-size: 8.5px; font-weight: 800; letter-spacing: 0.1em; margin-bottom: 5px; }
    .notes .v, .quiet-card .v { font-size: 11.5px; font-weight: 600; }
    .totals {
      border: 1.8px solid #000;
      box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 3px #000;
    }
    .totals .tot-head {
      text-align: center;
      padding: 7px 8px;
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.14em;
      border-bottom: 1.4px solid #000;
    }
    .totals .tot-body { padding: 8px 12px 11px; }
    .tot-line {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 0;
      font-size: 11px;
      border-bottom: 1px dotted #000;
    }
    .tot-line b { white-space: nowrap; font-weight: 800; }
    .tot-line.debt-total { border-bottom: none; border-top: 1.6px solid #000; margin-top: 4px; padding-top: 8px; }
    .tot-sep { margin: 8px 0 4px; font-size: 9px; font-weight: 800; text-align: center; letter-spacing: 0.08em; }
    .tot-grand {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 7px; padding: 9px 10px; border: 1.8px solid #000;
      font-size: 12px; font-weight: 800;
    }
    .tot-grand b { font-size: 16.5px; }
    .thanks { margin-top: 14px; text-align: center; }
    .thanks p { font-size: 11.5px; font-weight: 800; letter-spacing: 0.04em; }
    @media print { .sheet { max-width: 100%; } }
  </style>
</head>
<body>
  ${invoicePageFoot()}
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
      max-height: 20mm;
      margin: 0 auto 4px;
      object-fit: contain;
      filter: grayscale(100%) contrast(1.3);
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
    .store-name {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 0;
    }
    .brand-en {
      font-size: 8px;
      letter-spacing: 0.22em;
      font-weight: 700;
      margin-bottom: 1px;
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
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: right;
    }
    .contact-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 0;
    }
    .contact-row + .contact-row { border-top: 1px dotted #000; padding-top: 4px; margin-top: 2px; }
    .contact-row b { font-family: Consolas, 'Courier New', monospace; font-size: 10px; direction: ltr; }
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
      <div class="brand-en">deema alhayat</div>
      <div class="store-name">${esc(STORE_NAME)}</div>
      ${brandOrnament()}
      <div class="doc-badge">${title}</div>
      ${branchName ? `<div class="branch-name">${esc(branchName)}</div>` : ''}
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
      <div class="foot-msg">${esc(footer)}</div>
      <div class="foot-brand">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''}</div>
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
