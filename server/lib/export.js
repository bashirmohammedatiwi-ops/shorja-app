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
        <td class="col-idx">${i + 1}</td>
        <td class="col-product">
          <strong>${esc(l.name)}</strong>
          ${edited ? '<span class="tag-edit">سعر معدّل</span>' : ''}
          ${gift > 0 ? `<span class="tag-gift">هدية × ${gift}</span>` : ''}
          <div class="barcode-sub" dir="ltr">${esc(l.barcode)}</div>
        </td>
        <td class="col-qty" dir="ltr">${l.qty}${gift > 0 ? `<small>+${gift}</small>` : ''}</td>
        <td class="col-price" dir="ltr">
          ${fmt(l.unitPrice)}
          ${edited ? `<div class="was">كان ${fmt(l.originalPrice)}</div>` : ''}
        </td>
        <td class="col-total" dir="ltr"><strong>${fmt(l.lineTotal)}</strong></td>
      </tr>`;
  }).join('');
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
  <title>${esc(invoice.invoiceNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 3mm 4mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Tahoma, 'Segoe UI', Arial, sans-serif;
      width: 72mm;
      margin: 0 auto;
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

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(invoice.invoiceNo)} — ${esc(STORE_NAME)}</title>
  <style>
    @page { margin: 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Tahoma, 'Segoe UI', Arial, sans-serif;
      color: #0b1220;
      background: #f4f7fb;
      padding: 24px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 210mm;
      margin: 0 auto;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(11, 18, 32, 0.1);
      overflow: hidden;
    }

    .banner {
      background: linear-gradient(135deg, ${isReturn ? '#7f1d1d, #dc2626' : '#064e3b, #059669'});
      color: #fff;
      padding: 28px 32px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    .banner-right { display: flex; align-items: center; gap: 16px; }
    .banner-logo {
      width: 56px; height: 56px;
      border-radius: 14px;
      background: rgba(255,255,255,0.15);
      border: 2px solid rgba(255,255,255,0.35);
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 800;
    }
    .banner h1 { font-size: 1.5rem; font-weight: 800; margin-bottom: 4px; }
    .banner .sub { font-size: 0.88rem; opacity: 0.85; }
    .banner-left { text-align: left; }
    .doc-type {
      display: inline-block;
      font-size: 0.82rem;
      font-weight: 800;
      padding: 6px 16px;
      border-radius: 999px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.35);
      margin-bottom: 8px;
    }
    .inv-no {
      font-family: Consolas, monospace;
      font-size: 1.1rem;
      font-weight: 800;
      direction: ltr;
    }

    .content { padding: 24px 32px 32px; }

    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .meta-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .meta-card .lbl { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .meta-card .val { font-size: 0.95rem; font-weight: 800; }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.88rem;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }
    thead th {
      background: ${isReturn ? '#fef2f2' : '#ecfdf5'};
      color: ${accent};
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 12px 14px;
      text-align: right;
      border-bottom: 2px solid ${accent};
    }
    tbody td {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: #fafbfc; }
    .col-idx { width: 36px; text-align: center; color: #94a3b8; font-weight: 700; }
    .col-product strong { display: block; margin-bottom: 2px; }
    .barcode-sub { font-size: 0.72rem; color: #94a3b8; font-family: Consolas, monospace; margin-top: 2px; }
    .tag-edit, .tag-gift {
      display: inline-block;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      margin-inline-start: 4px;
    }
    .tag-edit { background: #fef3c7; color: #b45309; }
    .tag-gift { background: #fce7f3; color: #be185d; }
    .col-qty, .col-price, .col-total { text-align: center; white-space: nowrap; }
    .col-total strong { color: ${accent}; }
    .was { font-size: 0.72rem; color: #94a3b8; text-decoration: line-through; margin-top: 2px; }

    .bottom {
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 24px;
      margin-top: 24px;
      align-items: start;
    }
    .notes-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 0.85rem;
      color: #92400e;
    }
    .notes-box strong { display: block; margin-bottom: 4px; }

    .totals-panel {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
    }
    .totals-panel .total-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .totals-panel .total-row.discount { color: #b45309; }
    .totals-panel .total-row.grand {
      margin-top: 8px;
      padding: 12px 14px;
      background: ${accentSoft};
      border: 2px solid ${accent};
      border-radius: 10px;
      font-size: 1.1rem;
      font-weight: 800;
      color: ${accent};
    }
    .totals-panel .total-row.grand span:last-child { font-size: 1.25rem; }
    .totals-panel .total-row.paid { color: #047857; }
    .totals-panel .total-row.due { color: #dc2626; }

    .foot {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 2px dashed #e2e8f0;
      text-align: center;
    }
    .foot-msg { font-size: 0.95rem; font-weight: 700; color: #334155; margin-bottom: 4px; }
    .foot-sub { font-size: 0.8rem; color: #94a3b8; }
    .summary-badge {
      display: inline-block;
      margin-top: 12px;
      font-size: 0.78rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      padding: 4px 12px;
      border-radius: 999px;
    }

    @media print {
      body { background: #fff; padding: 0; }
      .page { box-shadow: none; border-radius: 0; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="banner">
      <div class="banner-right">
        <div class="banner-logo">د</div>
        <div>
          <h1>${esc(STORE_NAME)}</h1>
          <div class="sub">${esc(branchName || 'نقطة البيع')}</div>
        </div>
      </div>
      <div class="banner-left">
        <div class="doc-type">${title}</div>
        <div class="inv-no">${esc(invoice.invoiceNo)}</div>
      </div>
    </header>

    <div class="content">
      <div class="meta-grid">
        <div class="meta-card">
          <div class="lbl">التاريخ والوقت</div>
          <div class="val" dir="ltr">${esc(dateTime)}</div>
        </div>
        <div class="meta-card">
          <div class="lbl">العميل</div>
          <div class="val">${esc(customer)}</div>
        </div>
        <div class="meta-card">
          <div class="lbl">طريقة الدفع</div>
          <div class="val">${payIcon(invoice.paymentMethod)} ${payLabel(invoice.paymentMethod)}</div>
        </div>
        <div class="meta-card">
          <div class="lbl">عدد البنود</div>
          <div class="val">${summary.lineCount} بند · ${summary.itemQty} قطعة</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>المنتج</th>
            <th>الكمية</th>
            <th>السعر</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>${a4LineItems(invoice)}</tbody>
      </table>

      <div class="bottom">
        <div>
          ${invoice.notes ? `<div class="notes-box"><strong>ملاحظات</strong>${esc(invoice.notes)}</div>` : '<div></div>'}
        </div>
        <div class="totals-panel">
          ${totalsBlock(invoice)}
        </div>
      </div>

      <footer class="foot">
        <div class="foot-msg">${esc(footer)}</div>
        <div class="foot-sub">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''}</div>
        <div class="summary-badge">${summary.lineCount} بند · ${summary.itemQty} قطعة · ${payLabel(invoice.paymentMethod)}</div>
      </footer>
    </div>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
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
