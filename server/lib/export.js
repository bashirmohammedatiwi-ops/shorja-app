const { STORE_NAME } = require('./config');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function payLabel(method) {
  if (method === 'credit') return 'آجل / حساب';
  if (method === 'partial') return 'دفع جزئي';
  return 'نقدي';
}

function payIcon(method) {
  if (method === 'credit') return '📋';
  if (method === 'partial') return '💰';
  return '💵';
}

function formatReceiptDateTime(invoice) {
  const date = invoice.invoiceDate || '';
  let time = '';
  if (invoice.createdAt) {
    try {
      const d = new Date(invoice.createdAt);
      if (!Number.isNaN(d.getTime())) {
        time = d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
      }
    } catch { /* ignore */ }
  }
  return time ? `${date} · ${time}` : date;
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

function a4LineItems(invoice) {
  return (invoice.lines || []).map((l, i) => {
    const edited = l.priceEdited && l.originalPrice != null && l.originalPrice !== l.unitPrice;
    const gift = Number(l.giftQty || 0);
    return `
      <tr>
        <td class="t-idx">${i + 1}</td>
        <td class="t-name">${esc(l.name)}${edited ? ' <span class="tag-edit">معدّل</span>' : ''}</td>
        <td class="t-code" dir="ltr">${esc(l.barcode)}</td>
        <td class="t-qty" dir="ltr">${l.qty}</td>
        <td class="t-gift" dir="ltr">${gift > 0 ? `<span class="gift-val">${gift}</span>` : '<span class="gift-zero">—</span>'}</td>
        <td class="t-price" dir="ltr">${fmt(l.unitPrice)}${edited ? `<div class="was">${fmt(l.originalPrice)}</div>` : ''}</td>
        <td class="t-total" dir="ltr">${fmt(l.lineTotal)}</td>
      </tr>`;
  }).join('');
}

function a4TotalsPanel(invoice, accent, debtInfo) {
  let html = `<div class="tot-line"><span>المجموع الفرعي</span><b dir="ltr">${fmt(invoice.subtotal)}</b></div>`;
  if (Number(invoice.discount)) {
    html += `<div class="tot-line disc"><span>الخصم</span><b dir="ltr">− ${fmt(invoice.discount)}</b></div>`;
  }
  html += `<div class="tot-grand"><span>الصافي</span><b dir="ltr">${fmt(invoice.total)}</b></div>`;
  if (Number(invoice.paidAmount)) {
    html += `<div class="tot-line paid"><span>المدفوع</span><b dir="ltr">${fmt(invoice.paidAmount)}</b></div>`;
  }
  if (debtInfo && (debtInfo.previousDebt > 0 || debtInfo.invoiceDue > 0)) {
    html += `<div class="tot-sep">حساب العميل</div>`;
    if (debtInfo.previousDebt > 0) {
      html += `<div class="tot-line debt-prev"><span>دين سابق على الحساب</span><b dir="ltr">${fmt(debtInfo.previousDebt)}</b></div>`;
    }
    if (debtInfo.invoiceDue > 0) {
      html += `<div class="tot-line due"><span>دين هذه الفاتورة</span><b dir="ltr">${fmt(debtInfo.invoiceDue)}</b></div>`;
      if (debtInfo.totalDebt > 0) {
        html += `<div class="tot-line debt-total"><span>إجمالي الدين على الحساب</span><b dir="ltr">${fmt(debtInfo.totalDebt)}</b></div>`;
      }
    }
  } else if (Number(invoice.dueAmount)) {
    html += `<div class="tot-line due"><span>المتبقي</span><b dir="ltr">${fmt(invoice.dueAmount)}</b></div>`;
  }
  return html;
}

function buildA4InvoiceHtml(invoice, branchName, opts) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
  const debtInfo = opts.debtInfo || null;
  const accent = isReturn ? '#b71c1c' : '#2e7d32';
  const accentDark = isReturn ? '#7f0000' : '#1b5e20';
  const accentLight = isReturn ? '#ffebee' : '#e8f5e9';
  const summary = receiptSummary(invoice);
  const giftTotal = (invoice.lines || []).reduce((s, l) => s + Number(l.giftQty || 0), 0);
  const soldTotal = (invoice.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0);
  const dateTime = formatReceiptDateTime(invoice);
  const customer = invoice.customerName || invoice.accountName || 'عميل نقدي';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title></title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { width: 100%; }
    body {
      font-family: Tahoma, Arial, sans-serif;
      font-size: 11px;
      color: #212121;
      background: #fff;
      line-height: 1.45;
      margin: 0;
      padding: 0;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .inv {
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
      padding: 10mm;
      overflow: hidden;
    }

    /* ── رأس ── */
    .hdr {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 2px solid ${accent};
    }
    .hdr-store { min-width: 0; flex: 1; }
    .hdr-store h1 {
      font-size: 20px;
      font-weight: 700;
      color: ${accentDark};
      margin-bottom: 2px;
      line-height: 1.25;
    }
    .hdr-store p {
      font-size: 12px;
      color: #616161;
      font-weight: 600;
    }
    .hdr-meta {
      text-align: left;
      flex-shrink: 0;
      max-width: 48%;
    }
    .hdr-type {
      display: block;
      font-size: 11px;
      font-weight: 700;
      color: ${accent};
      margin-bottom: 4px;
    }
    .hdr-no {
      display: block;
      font-family: Consolas, monospace;
      font-size: 11px;
      font-weight: 700;
      color: #424242;
      direction: ltr;
      word-break: break-all;
    }

    /* ── معلومات ── */
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .meta-item {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 7px 10px;
      background: #fafafa;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      min-width: 0;
    }
    .meta-item .k {
      font-size: 10px;
      color: #757575;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .meta-item .k::after { content: ':'; margin-inline-start: 2px; }
    .meta-item .v {
      font-size: 11px;
      font-weight: 700;
      color: #212121;
      min-width: 0;
      word-break: break-word;
    }
    .meta-item .v.ltr {
      direction: ltr;
      text-align: left;
      font-family: Consolas, monospace;
      font-size: 10px;
    }

    /* ── جدول ── */
    .tbl-wrap {
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .tbl {
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10.5px;
    }
    .tbl thead { display: table-header-group; }
    .tbl th {
      background: ${accent};
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      padding: 7px 4px;
      text-align: center;
      border: 1px solid ${accentDark};
      line-height: 1.3;
    }
    .tbl th.th-name { text-align: right; padding-right: 8px; }
    .tbl td {
      padding: 6px 4px;
      border: 1px solid #e0e0e0;
      text-align: center;
      vertical-align: middle;
      line-height: 1.35;
      overflow: hidden;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    .tbl tbody tr:nth-child(even) { background: #f5f5f5; }
    .tbl tbody tr { page-break-inside: avoid; }

    .t-name {
      text-align: right !important;
      padding-right: 8px !important;
      font-weight: 600;
      font-size: 10.5px;
    }
    .t-code {
      font-family: Consolas, monospace;
      font-size: 9px;
      color: #616161;
      direction: ltr;
    }
    .t-qty { font-weight: 700; font-size: 11px; direction: ltr; }
    .t-total { font-weight: 700; color: ${accentDark}; font-size: 10.5px; direction: ltr; }
    .t-price { font-weight: 600; font-size: 10px; direction: ltr; }

    .gift-val {
      display: inline-block;
      background: #f8bbd0;
      color: #880e4f;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      direction: ltr;
    }
    .gift-zero { color: #bdbdbd; font-size: 11px; }
    .tag-edit {
      display: inline-block;
      font-size: 8px;
      background: #fff9c4;
      color: #f57f17;
      padding: 1px 4px;
      border-radius: 2px;
      font-weight: 700;
      vertical-align: middle;
    }
    .was { font-size: 8px; color: #9e9e9e; text-decoration: line-through; }

    /* ── أسفل ── */
    .footer-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 36%);
      gap: 10px;
      max-width: 100%;
      page-break-inside: avoid;
    }
    .notes-box {
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 10px;
      min-height: 72px;
      min-width: 0;
    }
    .notes-box .k {
      font-size: 10px;
      color: #757575;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .notes-box .v { font-size: 10.5px; color: #424242; word-break: break-word; }
    .notes-box .empty { color: #bdbdbd; }

    .totals-box {
      width: 100%;
      max-width: 100%;
      border: 1.5px solid ${accent};
      border-radius: 4px;
      overflow: hidden;
      min-width: 0;
    }
    .totals-box .tot-head {
      background: ${accent};
      color: #fff;
      text-align: center;
      padding: 6px;
      font-size: 10px;
      font-weight: 700;
    }
    .totals-box .tot-body { padding: 8px 10px; }
    .tot-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      font-size: 10.5px;
      border-bottom: 1px dashed #e0e0e0;
    }
    .tot-line b { font-weight: 700; white-space: nowrap; }
    .tot-line.disc { color: #e65100; }
    .tot-line.paid { color: #2e7d32; }
    .tot-line.due { color: #c62828; font-weight: 700; }
    .tot-line.debt-prev { color: #e65100; font-weight: 700; }
    .tot-line.debt-total {
      color: #b71c1c;
      font-weight: 800;
      border-bottom: none;
      margin-top: 2px;
      padding-top: 6px;
      border-top: 2px solid #ffcdd2;
    }
    .tot-sep {
      margin: 8px 0 4px;
      padding: 4px 0 2px;
      font-size: 9px;
      font-weight: 800;
      color: #757575;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .tot-grand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      padding: 8px;
      background: ${accentLight};
      border-radius: 3px;
      font-size: 12px;
      font-weight: 700;
    }
    .tot-grand b { font-size: 15px; color: ${accentDark}; white-space: nowrap; }

    .inv-foot {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
      text-align: center;
    }
    .inv-foot .msg { font-size: 11px; font-weight: 700; color: ${accentDark}; margin-bottom: 3px; }
    .inv-foot .sub { font-size: 9px; color: #9e9e9e; line-height: 1.5; }

    @media print {
      html, body { width: 100%; overflow: hidden; margin: 0; padding: 0; }
      @page { margin: 0; }
      .inv { max-width: 100%; padding: 10mm; }
      .tbl-wrap { overflow: visible; }
    }
  </style>
</head>
<body>
  <div class="inv">

    <header class="hdr">
      <div class="hdr-store">
        <h1>${esc(STORE_NAME)}</h1>
        <p>${esc(branchName || 'نقطة البيع')}</p>
      </div>
      <div class="hdr-meta">
        <span class="hdr-type">${title}</span>
        <span class="hdr-no">${esc(invoice.invoiceNo)}</span>
      </div>
    </header>

    <div class="meta">
      <div class="meta-item">
        <span class="k">التاريخ</span>
        <span class="v ltr">${esc(dateTime)}</span>
      </div>
      <div class="meta-item">
        <span class="k">العميل</span>
        <span class="v">${esc(customer)}</span>
      </div>
      <div class="meta-item">
        <span class="k">الدفع</span>
        <span class="v">${payLabel(invoice.paymentMethod)}</span>
      </div>
      <div class="meta-item">
        <span class="k">مباع / هدايا</span>
        <span class="v">${soldTotal} / ${giftTotal}</span>
      </div>
    </div>

    <div class="tbl-wrap">
      <table class="tbl">
        <colgroup>
          <col style="width:4%">
          <col style="width:30%">
          <col style="width:14%">
          <col style="width:8%">
          <col style="width:8%">
          <col style="width:14%">
          <col style="width:14%">
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th class="th-name">المنتج</th>
            <th>الباركود</th>
            <th>العدد</th>
            <th>هدايا</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>${a4LineItems(invoice)}</tbody>
      </table>
    </div>

    <div class="footer-grid">
      <div class="notes-box">
        <div class="k">ملاحظات</div>
        <div class="v">${invoice.notes ? esc(invoice.notes) : '<span class="empty">—</span>'}</div>
      </div>
      <div class="totals-box">
        <div class="tot-head">ملخص المبالغ</div>
        <div class="tot-body">${a4TotalsPanel(invoice, accent, debtInfo)}</div>
      </div>
    </div>

    <footer class="inv-foot">
      <div class="msg">${esc(footer)}</div>
      <div class="sub">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''} · ${summary.lineCount} صنف · ${soldTotal} مباع${giftTotal ? ` · ${giftTotal} هدية` : ''}</div>
    </footer>

  </div>
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
  rows.push(`<div class="total-row grand"><span>الصافي</span><span dir="ltr">${fmt(invoice.total)}</span></div>`);
  if (Number(invoice.paidAmount)) {
    rows.push(`<div class="total-row paid"><span>المبلغ المدفوع</span><span dir="ltr">${fmt(invoice.paidAmount)}</span></div>`);
  }
  if (debtInfo && (debtInfo.previousDebt > 0 || debtInfo.invoiceDue > 0)) {
    rows.push(`<div class="total-row debt-sep"><span>حساب العميل</span><span></span></div>`);
    if (debtInfo.previousDebt > 0) {
      rows.push(`<div class="total-row debt-prev"><span>دين سابق على الحساب</span><span dir="ltr">${fmt(debtInfo.previousDebt)}</span></div>`);
    }
    if (debtInfo.invoiceDue > 0) {
      rows.push(`<div class="total-row due"><span>دين هذه الفاتورة</span><span dir="ltr">${fmt(debtInfo.invoiceDue)}</span></div>`);
      if (debtInfo.totalDebt > 0) {
        rows.push(`<div class="total-row debt-total"><span>إجمالي الدين على الحساب</span><span dir="ltr">${fmt(debtInfo.totalDebt)}</span></div>`);
      }
    }
  } else if (Number(invoice.dueAmount)) {
    rows.push(`<div class="total-row due"><span>المتبقي على الحساب</span><span dir="ltr">${fmt(invoice.dueAmount)}</span></div>`);
  }
  return rows.join('');
}

function invoicePrintHtml(invoice, branchName = '', opts = {}) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const thermal = !!opts.thermal;
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
  const debtInfo = opts.debtInfo || null;
  const accent = isReturn ? '#dc2626' : '#047857';
  const accentSoft = isReturn ? '#fef2f2' : '#ecfdf5';
  const summary = receiptSummary(invoice);
  const dateTime = formatReceiptDateTime(invoice);
  const customer = invoice.customerName || invoice.accountName || 'نقدي';

  if (thermal) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title></title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Tahoma, 'Segoe UI', Arial, sans-serif;
      width: 72mm;
      margin: 4mm auto;
      padding: 6px 4px 10px;
      font-size: 11px;
      color: #0b1220;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt { width: 100%; }

    .rule {
      border: none;
      border-top: 1px dashed #999;
      margin: 8px 0;
    }
    .rule-solid {
      border: none;
      border-top: 2px solid #111;
      margin: 8px 0;
    }
    .rule-double {
      border: none;
      border-top: 3px double #111;
      margin: 10px 0 8px;
    }

    .head { text-align: center; padding: 4px 0 2px; }
    .logo {
      width: 44px; height: 44px;
      margin: 0 auto 8px;
      border-radius: 12px;
      background: ${accent};
      color: #fff;
      font-size: 22px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #111;
    }
    .store-name {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    .doc-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      padding: 3px 12px;
      border-radius: 999px;
      background: ${accentSoft};
      color: ${accent};
      border: 1.5px solid ${accent};
      margin: 4px 0;
    }
    .branch-name {
      font-size: 10px;
      color: #444;
      font-weight: 700;
      margin-top: 2px;
    }

    .meta-box {
      border: 1.5px solid #111;
      border-radius: 8px;
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
    .meta-row + .meta-row { border-top: 1px dotted #ccc; margin-top: 2px; padding-top: 4px; }
    .meta-lbl { color: #555; font-weight: 600; flex-shrink: 0; }
    .meta-val { font-weight: 800; text-align: left; }
    .meta-val.mono { font-family: Consolas, 'Courier New', monospace; font-size: 9.5px; letter-spacing: 0.02em; }

    .items-head {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      font-weight: 800;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0 2px 4px;
    }

    .item {
      padding: 7px 0;
      border-bottom: 1px dashed #bbb;
    }
    .item:last-child { border-bottom: none; }
    .item-head { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 3px; }
    .item-num {
      flex-shrink: 0;
      width: 16px; height: 16px;
      border-radius: 4px;
      background: #f1f5f9;
      border: 1px solid #ccc;
      font-size: 8px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }
    .item-name { font-weight: 800; font-size: 11px; line-height: 1.35; flex: 1; }
    .edited-tag { color: ${accent}; font-weight: 800; margin-inline-start: 2px; }
    .item-calc {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      color: #333;
      padding-inline-start: 22px;
      flex-wrap: wrap;
    }
    .item-x, .item-eq { color: #888; font-weight: 600; }
    .item-total { margin-inline-start: auto; font-size: 11px; font-weight: 800; color: #111; }
    .was-price { font-size: 8px; color: #888; font-weight: 600; text-decoration: line-through; }
    .item-barcode { font-size: 8px; color: #888; padding-inline-start: 22px; margin-top: 2px; font-family: Consolas, monospace; }

    .totals { margin-top: 4px; }
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 2px;
      font-size: 10px;
      font-weight: 600;
    }
    .total-row.discount { color: #b45309; }
    .total-row.grand {
      margin-top: 6px;
      padding: 8px 10px;
      background: ${accentSoft};
      border: 2px solid ${accent};
      border-radius: 8px;
      font-size: 13px;
      font-weight: 800;
    }
    .total-row.grand span:last-child { font-size: 15px; }
    .total-row.paid { color: #047857; }
    .total-row.due { color: #dc2626; font-weight: 800; }
    .total-row.debt-prev { color: #b45309; font-weight: 800; }
    .total-row.debt-total { color: #b91c1c; font-weight: 800; }
    .total-row.debt-sep {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #bbb;
      font-size: 9px;
      font-weight: 800;
      color: #666;
    }

    .pay-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 8px;
      padding: 6px;
      border: 1px dashed #999;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 700;
    }

    .notes {
      margin-top: 8px;
      padding: 6px 8px;
      background: #f8fafc;
      border-radius: 6px;
      border: 1px dashed #ccc;
      font-size: 9px;
      color: #444;
    }
    .notes strong { color: #111; }

    .summary-line {
      text-align: center;
      font-size: 9px;
      color: #666;
      margin-top: 6px;
    }

    .foot {
      text-align: center;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #999;
    }
    .foot-msg {
      font-size: 10px;
      font-weight: 700;
      color: #333;
      line-height: 1.6;
      margin-bottom: 4px;
    }
    .foot-brand {
      font-size: 9px;
      color: #888;
      font-weight: 600;
    }
    .inv-code {
      margin-top: 6px;
      font-family: Consolas, monospace;
      font-size: 9px;
      letter-spacing: 0.12em;
      color: #555;
      direction: ltr;
    }

    @media print {
      @page { margin: 0; }
      body { width: 72mm; padding: 0; margin: 4mm auto; }
      .receipt { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <header class="head">
      <div class="logo">د</div>
      <div class="store-name">${esc(STORE_NAME)}</div>
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
      <span>${payIcon(invoice.paymentMethod)}</span>
      <span>${payLabel(invoice.paymentMethod)}</span>
      <span>·</span>
      <span dir="ltr">${fmt(invoice.total)}</span>
    </div>

    ${invoice.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${esc(invoice.notes)}</div>` : ''}

    <div class="summary-line">${summary.lineCount} بند · ${summary.itemQty} قطعة</div>

    <footer class="foot">
      <div class="foot-msg">${esc(footer)}</div>
      <div class="foot-brand">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''}</div>
      <div class="inv-code">${esc(invoice.invoiceNo)}</div>
    </footer>
  </div>
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
