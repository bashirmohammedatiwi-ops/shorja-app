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

function a4TotalsPanel(invoice, accent) {
  let html = `<div class="tot-line"><span>المجموع الفرعي</span><b dir="ltr">${fmt(invoice.subtotal)}</b></div>`;
  if (Number(invoice.discount)) {
    html += `<div class="tot-line disc"><span>الخصم</span><b dir="ltr">− ${fmt(invoice.discount)}</b></div>`;
  }
  html += `<div class="tot-grand"><span>الصافي</span><b dir="ltr">${fmt(invoice.total)}</b></div>`;
  if (Number(invoice.paidAmount)) {
    html += `<div class="tot-line paid"><span>المدفوع</span><b dir="ltr">${fmt(invoice.paidAmount)}</b></div>`;
  }
  if (Number(invoice.dueAmount)) {
    html += `<div class="tot-line due"><span>المتبقي</span><b dir="ltr">${fmt(invoice.dueAmount)}</b></div>`;
  }
  return html;
}

function buildA4InvoiceHtml(invoice, branchName, opts) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
  const accent = isReturn ? '#c62828' : '#1b7a4e';
  const accentLight = isReturn ? '#ffebee' : '#e8f5ee';
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Tahoma, Arial, sans-serif;
      font-size: 12px;
      color: #1a1a1a;
      background: #fff;
      line-height: 1.5;
      margin: 14mm 16mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .inv {
      width: 100%;
      max-width: 100%;
    }

    /* ── رأس أنيق وبسيط ── */
    .hdr {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 20px;
      padding-bottom: 14px;
      border-bottom: 3px solid ${accent};
      margin-bottom: 18px;
    }
    .hdr-store h1 {
      font-size: 24px;
      font-weight: 700;
      color: #111;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    .hdr-store p {
      font-size: 13px;
      color: #555;
      font-weight: 600;
    }
    .hdr-meta { text-align: left; flex-shrink: 0; }
    .hdr-type {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      color: ${accent};
      background: ${accentLight};
      padding: 4px 14px;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .hdr-no {
      display: block;
      font-family: Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #333;
      direction: ltr;
    }

    /* ── معلومات الفاتورة ── */
    .meta {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }
    .meta-item {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 10px 12px;
      background: #fafafa;
    }
    .meta-item .k {
      font-size: 10px;
      color: #888;
      font-weight: 700;
      margin-bottom: 3px;
    }
    .meta-item .v {
      font-size: 13px;
      font-weight: 700;
      color: #222;
    }
    .meta-item .v.ltr { direction: ltr; text-align: right; font-family: Consolas, monospace; font-size: 12px; }

    /* ── جدول المنتجات ── */
    .tbl {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-bottom: 20px;
      font-size: 11.5px;
    }
    .tbl thead { display: table-header-group; }
    .tbl th {
      background: ${accent};
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 9px 6px;
      text-align: center;
      border: 1px solid ${accent};
    }
    .tbl th.th-name { text-align: right; padding-right: 10px; }
    .tbl td {
      padding: 8px 6px;
      border: 1px solid #e0e0e0;
      text-align: center;
      vertical-align: middle;
      word-wrap: break-word;
    }
    .tbl tbody tr:nth-child(even) { background: #f9f9f9; }
    .tbl tbody tr { page-break-inside: avoid; }

    .t-idx { width: 28px; color: #999; font-weight: 700; }
    .t-name { text-align: right !important; padding-right: 10px !important; font-weight: 600; }
    .t-code { width: 90px; font-family: Consolas, monospace; font-size: 10px; color: #666; }
    .t-qty { width: 48px; font-weight: 700; font-size: 13px; }
    .t-gift { width: 48px; }
    .t-price { width: 72px; font-weight: 600; }
    .t-total { width: 80px; font-weight: 700; color: ${accent}; font-size: 12px; }

    .gift-val {
      display: inline-block;
      background: #fce4ec;
      color: #c2185b;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    .gift-zero { color: #ccc; }
    .tag-edit {
      display: inline-block;
      font-size: 9px;
      background: #fff8e1;
      color: #f57f17;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
      margin-right: 4px;
    }
    .was { font-size: 9px; color: #aaa; text-decoration: line-through; }

    /* ── أسفل الفاتورة ── */
    .footer-grid {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      page-break-inside: avoid;
    }
    .notes-box {
      flex: 1;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 12px 14px;
      min-height: 90px;
    }
    .notes-box .k { font-size: 10px; color: #888; font-weight: 700; margin-bottom: 6px; }
    .notes-box .v { font-size: 12px; color: #444; }
    .notes-box .empty { color: #bbb; font-style: italic; }

    .totals-box {
      width: 240px;
      flex-shrink: 0;
      border: 2px solid ${accent};
      border-radius: 6px;
      overflow: hidden;
    }
    .totals-box .tot-head {
      background: ${accent};
      color: #fff;
      text-align: center;
      padding: 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .totals-box .tot-body { padding: 10px 14px; }
    .tot-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      font-size: 12px;
      border-bottom: 1px dashed #e0e0e0;
    }
    .tot-line:last-child { border-bottom: none; }
    .tot-line.disc { color: #e65100; }
    .tot-line.paid { color: #2e7d32; }
    .tot-line.due { color: #c62828; font-weight: 700; }
    .tot-grand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
      padding: 10px 12px;
      background: ${accentLight};
      border-radius: 4px;
      font-size: 14px;
      font-weight: 700;
    }
    .tot-grand b { font-size: 18px; color: ${accent}; }

    .inv-foot {
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px solid #ddd;
      text-align: center;
    }
    .inv-foot .msg { font-size: 13px; font-weight: 700; color: ${accent}; margin-bottom: 4px; }
    .inv-foot .sub { font-size: 10px; color: #999; }

    @media print {
      body { background: #fff; }
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
        <div class="k">التاريخ والوقت</div>
        <div class="v ltr">${esc(dateTime)}</div>
      </div>
      <div class="meta-item">
        <div class="k">العميل</div>
        <div class="v">${esc(customer)}</div>
      </div>
      <div class="meta-item">
        <div class="k">طريقة الدفع</div>
        <div class="v">${payLabel(invoice.paymentMethod)}</div>
      </div>
      <div class="meta-item">
        <div class="k">العدد / الهدايا</div>
        <div class="v">${soldTotal} قطعة · ${giftTotal} هدية</div>
      </div>
    </div>

    <table class="tbl">
      <thead>
        <tr>
          <th class="t-idx">#</th>
          <th class="th-name">اسم المنتج</th>
          <th>الباركود</th>
          <th>العدد</th>
          <th>الهدايا</th>
          <th>السعر</th>
          <th>الإجمالي</th>
        </tr>
      </thead>
      <tbody>${a4LineItems(invoice)}</tbody>
    </table>

    <div class="footer-grid">
      <div class="notes-box">
        <div class="k">ملاحظات</div>
        <div class="v">${invoice.notes ? esc(invoice.notes) : '<span class="empty">—</span>'}</div>
      </div>
      <div class="totals-box">
        <div class="tot-head">ملخص المبالغ</div>
        <div class="tot-body">${a4TotalsPanel(invoice, accent)}</div>
      </div>
    </div>

    <footer class="inv-foot">
      <div class="msg">${esc(footer)}</div>
      <div class="sub">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''} · ${summary.lineCount} صنف · ${soldTotal} قطعة مباعة${giftTotal ? ` · ${giftTotal} هدية` : ''}</div>
    </footer>

  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
}

function totalsBlock(invoice, { compact = false } = {}) {
  const rows = [];
  rows.push(`<div class="total-row"><span>المجموع الفرعي</span><span dir="ltr">${fmt(invoice.subtotal)}</span></div>`);
  if (Number(invoice.discount)) {
    rows.push(`<div class="total-row discount"><span>الخصم</span><span dir="ltr">− ${fmt(invoice.discount)}</span></div>`);
  }
  rows.push(`<div class="total-row grand"><span>الصافي</span><span dir="ltr">${fmt(invoice.total)}</span></div>`);
  if (Number(invoice.paidAmount)) {
    rows.push(`<div class="total-row paid"><span>المبلغ المدفوع</span><span dir="ltr">${fmt(invoice.paidAmount)}</span></div>`);
  }
  if (Number(invoice.dueAmount)) {
    rows.push(`<div class="total-row due"><span>المتبقي على الحساب</span><span dir="ltr">${fmt(invoice.dueAmount)}</span></div>`);
  }
  return rows.join('');
}

function invoicePrintHtml(invoice, branchName = '', opts = {}) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const thermal = !!opts.thermal;
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
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
      body { width: 72mm; padding: 0; }
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
      ${totalsBlock(invoice)}
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

  return buildA4InvoiceHtml(invoice, branchName, { footer });
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
