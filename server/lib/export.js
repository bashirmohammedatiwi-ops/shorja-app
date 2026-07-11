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
    const qtyText = gift > 0 ? `${l.qty} <span class="gift-pill">+${gift} هدية</span>` : String(l.qty);
    return `
      <tr>
        <td class="c-idx">${i + 1}</td>
        <td class="c-barcode" dir="ltr">${esc(l.barcode)}</td>
        <td class="c-name">
          <span class="p-name">${esc(l.name)}</span>
          ${edited ? '<span class="tag tag-edit">سعر معدّل</span>' : ''}
          ${gift > 0 ? '<span class="tag tag-gift">يشمل هدية</span>' : ''}
        </td>
        <td class="c-qty" dir="ltr">${qtyText}</td>
        <td class="c-unit" dir="ltr">
          ${fmt(l.unitPrice)}
          ${edited ? `<div class="was-price">كان ${fmt(l.originalPrice)}</div>` : ''}
        </td>
        <td class="c-total" dir="ltr"><strong>${fmt(l.lineTotal)}</strong></td>
      </tr>`;
  }).join('');
}

function a4TotalsPanel(invoice, accent, accentSoft) {
  const rows = [];
  rows.push(`<div class="sum-row"><span>المجموع الفرعي</span><span dir="ltr">${fmt(invoice.subtotal)}</span></div>`);
  if (Number(invoice.discount)) {
    rows.push(`<div class="sum-row discount"><span>الخصم</span><span dir="ltr">− ${fmt(invoice.discount)}</span></div>`);
  }
  rows.push(`
    <div class="sum-grand">
      <div class="sum-grand-lbl">الصافي المستحق</div>
      <div class="sum-grand-val" dir="ltr">${fmt(invoice.total)}</div>
    </div>`);
  if (Number(invoice.paidAmount)) {
    rows.push(`<div class="sum-row paid"><span>المبلغ المدفوع</span><span dir="ltr">${fmt(invoice.paidAmount)}</span></div>`);
  }
  if (Number(invoice.dueAmount)) {
    rows.push(`<div class="sum-row due"><span>المتبقي على الحساب</span><span dir="ltr">${fmt(invoice.dueAmount)}</span></div>`);
  }
  return rows.join('');
}

function buildA4InvoiceHtml(invoice, branchName, opts) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const titleEn = isReturn ? 'RETURN NOTE' : 'TAX INVOICE';
  const footer = opts.footer || `شكراً لزيارتكم — ${STORE_NAME}`;
  const accent = isReturn ? '#b91c1c' : '#047857';
  const accentDark = isReturn ? '#7f1d1d' : '#064e3b';
  const accentSoft = isReturn ? '#fef2f2' : '#ecfdf5';
  const accentMid = isReturn ? '#fecaca' : '#a7f3d0';
  const summary = receiptSummary(invoice);
  const dateTime = formatReceiptDateTime(invoice);
  const customer = invoice.customerName || invoice.accountName || 'عميل نقدي';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(invoice.invoiceNo)} — ${esc(STORE_NAME)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 210mm;
      min-height: 297mm;
      font-family: Tahoma, 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { margin: 0 auto; }

    .sheet {
      width: 210mm;
      min-height: 277mm;
      padding: 0;
      position: relative;
      overflow: hidden;
      background: #fff;
    }

    .watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 72px;
      font-weight: 900;
      color: ${accent};
      opacity: 0.03;
      transform: rotate(-24deg);
      pointer-events: none;
      user-select: none;
      letter-spacing: 0.08em;
    }

    .top-band {
      background: linear-gradient(135deg, ${accentDark} 0%, ${accent} 55%, ${isReturn ? '#ef4444' : '#10b981'} 100%);
      color: #fff;
      padding: 22px 28px 20px;
      position: relative;
    }
    .top-band::after {
      content: '';
      position: absolute;
      inset: auto 0 0;
      height: 4px;
      background: linear-gradient(90deg, transparent, ${accentMid}, transparent);
    }

    .head-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 20px;
      align-items: start;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-logo {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: rgba(255,255,255,0.14);
      border: 2px solid rgba(255,255,255,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 30px;
      font-weight: 900;
      flex-shrink: 0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    .brand h1 {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.03em;
      margin-bottom: 4px;
      line-height: 1.2;
    }
    .brand .branch {
      font-size: 13px;
      opacity: 0.9;
      font-weight: 700;
    }
    .brand .tagline {
      font-size: 11px;
      opacity: 0.75;
      margin-top: 4px;
    }

    .inv-box {
      text-align: left;
      min-width: 200px;
    }
    .inv-box .doc-type {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      padding: 5px 14px;
      border-radius: 999px;
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.35);
      margin-bottom: 8px;
    }
    .inv-box .doc-type-en {
      display: block;
      font-size: 9px;
      opacity: 0.7;
      letter-spacing: 0.2em;
      margin-bottom: 6px;
    }
    .inv-box .inv-no {
      font-family: Consolas, 'Courier New', monospace;
      font-size: 15px;
      font-weight: 800;
      direction: ltr;
      background: rgba(0,0,0,0.2);
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.2);
    }

    .info-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0;
      border-bottom: 2px solid ${accent};
      background: #f8fafc;
    }
    .info-cell {
      padding: 14px 18px;
      border-left: 1px solid #e2e8f0;
    }
    .info-cell:last-child { border-left: none; }
    .info-cell .lbl {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 5px;
    }
    .info-cell .val {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.35;
    }
    .info-cell .val.mono {
      font-family: Consolas, monospace;
      font-size: 12px;
      direction: ltr;
      text-align: right;
    }

    .body-pad { padding: 20px 24px 16px; }

    .customer-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      margin-bottom: 18px;
      background: ${accentSoft};
      border: 1.5px solid ${accentMid};
      border-radius: 12px;
    }
    .customer-bar .cust-lbl {
      font-size: 11px;
      font-weight: 800;
      color: ${accent};
      margin-bottom: 3px;
    }
    .customer-bar .cust-name {
      font-size: 17px;
      font-weight: 900;
      color: #0f172a;
    }
    .customer-bar .pay-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 999px;
      background: #fff;
      border: 1.5px solid ${accentMid};
      font-weight: 800;
      font-size: 13px;
      color: ${accent};
      white-space: nowrap;
    }

    .lines-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .lines-table thead { display: table-header-group; }
    .lines-table th {
      background: linear-gradient(180deg, ${accentSoft}, #f1f5f9);
      color: ${accent};
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 10px;
      text-align: right;
      border-bottom: 2px solid ${accent};
    }
    .lines-table td {
      padding: 11px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .lines-table tbody tr:nth-child(even) { background: #fafbfc; }
    .lines-table tbody tr:last-child td { border-bottom: none; }
    .lines-table tbody tr { page-break-inside: avoid; }

    .c-idx { width: 36px; text-align: center; color: #94a3b8; font-weight: 800; }
    .c-barcode { width: 108px; font-family: Consolas, monospace; font-size: 10px; color: #64748b; }
    .c-name .p-name { font-weight: 800; font-size: 12.5px; display: block; margin-bottom: 3px; }
    .c-qty { width: 72px; text-align: center; font-weight: 800; }
    .c-unit { width: 90px; text-align: center; font-weight: 700; }
    .c-total { width: 100px; text-align: center; }
    .c-total strong { color: ${accent}; font-size: 13px; }
    .was-price { font-size: 9px; color: #94a3b8; text-decoration: line-through; margin-top: 2px; }
    .gift-pill {
      display: inline-block;
      font-size: 9px;
      font-weight: 800;
      background: #fce7f3;
      color: #be185d;
      padding: 1px 6px;
      border-radius: 999px;
      margin-top: 2px;
    }
    .tag {
      display: inline-block;
      font-size: 9px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 999px;
      margin-inline-start: 4px;
    }
    .tag-edit { background: #fef3c7; color: #b45309; }
    .tag-gift { background: #fce7f3; color: #be185d; }

    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 20px;
      align-items: start;
      margin-bottom: 18px;
    }

    .notes-panel {
      border: 1.5px dashed #cbd5e1;
      border-radius: 12px;
      padding: 16px 18px;
      min-height: 120px;
      background: #fafbfc;
    }
    .notes-panel .np-title {
      font-size: 11px;
      font-weight: 900;
      color: #64748b;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .notes-panel .np-body {
      font-size: 12px;
      line-height: 1.7;
      color: #334155;
      font-weight: 600;
    }
    .notes-panel .np-empty {
      color: #94a3b8;
      font-style: italic;
    }

    .totals-panel {
      border: 2px solid ${accent};
      border-radius: 14px;
      overflow: hidden;
      background: #fff;
    }
    .totals-head {
      background: ${accent};
      color: #fff;
      padding: 10px 16px;
      font-size: 12px;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.06em;
    }
    .totals-body { padding: 14px 16px; }
    .sum-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      font-size: 12px;
      font-weight: 700;
      border-bottom: 1px dashed #e2e8f0;
    }
    .sum-row:last-of-type { border-bottom: none; }
    .sum-row.discount { color: #b45309; }
    .sum-row.paid { color: #047857; }
    .sum-row.due { color: #dc2626; font-weight: 900; }

    .sum-grand {
      margin-top: 12px;
      padding: 16px;
      background: ${accentSoft};
      border: 2px solid ${accentMid};
      border-radius: 10px;
      text-align: center;
    }
    .sum-grand-lbl {
      font-size: 11px;
      font-weight: 800;
      color: ${accent};
      margin-bottom: 4px;
      letter-spacing: 0.04em;
    }
    .sum-grand-val {
      font-size: 28px;
      font-weight: 900;
      color: ${accentDark};
      letter-spacing: -0.02em;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .stat-box {
      text-align: center;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #f8fafc;
    }
    .stat-box .sb-lbl { font-size: 10px; color: #64748b; font-weight: 800; margin-bottom: 4px; }
    .stat-box .sb-val { font-size: 16px; font-weight: 900; color: ${accent}; }

    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
      padding-top: 8px;
    }
    .sig-box {
      text-align: center;
      padding-top: 36px;
      border-top: 1.5px solid #cbd5e1;
      font-size: 11px;
      font-weight: 800;
      color: #64748b;
    }

    .sheet-foot {
      border-top: 3px double ${accent};
      padding: 16px 24px 20px;
      text-align: center;
      background: linear-gradient(180deg, #f8fafc, #fff);
    }
    .foot-msg {
      font-size: 14px;
      font-weight: 900;
      color: ${accentDark};
      margin-bottom: 6px;
    }
    .foot-sub {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      line-height: 1.6;
    }
    .foot-code {
      margin-top: 10px;
      font-family: Consolas, monospace;
      font-size: 10px;
      letter-spacing: 0.15em;
      color: #94a3b8;
      direction: ltr;
    }

    @media print {
      html, body { width: 210mm; background: #fff; }
      .sheet { min-height: auto; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="watermark">${esc(STORE_NAME)}</div>

    <header class="top-band">
      <div class="head-grid">
        <div class="brand">
          <div class="brand-logo">د</div>
          <div>
            <h1>${esc(STORE_NAME)}</h1>
            <div class="branch">${esc(branchName || 'نقطة البيع')}</div>
            <div class="tagline">فاتورة رسمية · ${title}</div>
          </div>
        </div>
        <div class="inv-box">
          <div class="doc-type">${title}</div>
          <div class="doc-type-en">${titleEn}</div>
          <div class="inv-no">${esc(invoice.invoiceNo)}</div>
        </div>
      </div>
    </header>

    <div class="info-strip">
      <div class="info-cell">
        <div class="lbl">التاريخ والوقت</div>
        <div class="val mono">${esc(dateTime)}</div>
      </div>
      <div class="info-cell">
        <div class="lbl">رقم الفاتورة</div>
        <div class="val mono">${esc(invoice.invoiceNo)}</div>
      </div>
      <div class="info-cell">
        <div class="lbl">عدد البنود / القطع</div>
        <div class="val">${summary.lineCount} بند · ${summary.itemQty} قطعة</div>
      </div>
      <div class="info-cell">
        <div class="lbl">حالة المستند</div>
        <div class="val">${isReturn ? 'مرتجع معتمد' : 'بيع معتمد'}</div>
      </div>
    </div>

    <div class="body-pad">
      <div class="customer-bar">
        <div>
          <div class="cust-lbl">العميل / الحساب</div>
          <div class="cust-name">${esc(customer)}</div>
        </div>
        <div class="pay-badge">
          <span>${payIcon(invoice.paymentMethod)}</span>
          <span>${payLabel(invoice.paymentMethod)}</span>
          <span>·</span>
          <span dir="ltr">${fmt(invoice.total)}</span>
        </div>
      </div>

      <table class="lines-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الباركود</th>
            <th>اسم المنتج</th>
            <th>الكمية</th>
            <th>سعر الوحدة</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>${a4LineItems(invoice)}</tbody>
      </table>

      <div class="stats-row">
        <div class="stat-box">
          <div class="sb-lbl">عدد الأصناف</div>
          <div class="sb-val">${summary.lineCount}</div>
        </div>
        <div class="stat-box">
          <div class="sb-lbl">إجمالي القطع</div>
          <div class="sb-val">${summary.itemQty}</div>
        </div>
        <div class="stat-box">
          <div class="sb-lbl">طريقة الدفع</div>
          <div class="sb-val" style="font-size:13px">${payLabel(invoice.paymentMethod)}</div>
        </div>
      </div>

      <div class="bottom-grid">
        <div class="notes-panel">
          <div class="np-title">ملاحظات</div>
          <div class="np-body">${invoice.notes ? esc(invoice.notes) : '<span class="np-empty">لا توجد ملاحظات</span>'}</div>
        </div>
        <div class="totals-panel">
          <div class="totals-head">ملخص المبالغ</div>
          <div class="totals-body">
            ${a4TotalsPanel(invoice, accent, accentSoft)}
          </div>
        </div>
      </div>

      <div class="signatures">
        <div class="sig-box">توقيع البائع</div>
        <div class="sig-box">توقيع العميل</div>
        <div class="sig-box">ختم المحل</div>
      </div>
    </div>

    <footer class="sheet-foot">
      <div class="foot-msg">${esc(footer)}</div>
      <div class="foot-sub">${esc(STORE_NAME)}${branchName ? ` — ${esc(branchName)}` : ''} · هذه الفاتورة صادرة إلكترونياً من نظام نقطة البيع</div>
      <div class="foot-code">${esc(invoice.invoiceNo)}</div>
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
