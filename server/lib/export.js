const { STORE_NAME } = require('./config');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function payLabel(method) {
  if (method === 'credit') return 'آجل';
  if (method === 'partial') return 'جزئي';
  return 'نقدي';
}

function invoicePrintHtml(invoice, branchName = '', opts = {}) {
  const isReturn = invoice.kind === 'return';
  const title = isReturn ? 'إشعار مرتجع' : 'فاتورة مبيعات';
  const thermal = !!opts.thermal;
  const footer = opts.footer || 'شكراً لزيارتكم';

  const lines = (invoice.lines || []).map((l) => {
    const edited = l.priceEdited && l.originalPrice != null && l.originalPrice !== l.unitPrice;
    const gift = Number(l.giftQty || 0);
    const giftNote = gift > 0 ? ` <small>(🎁 ${gift})</small>` : '';
    return thermal
      ? `<tr>
          <td>${esc(l.name)}${edited ? ' *' : ''}${giftNote}<br><small dir="ltr">${esc(l.barcode)}</small></td>
          <td dir="ltr">${l.qty}</td>
          <td dir="ltr">${fmt(l.unitPrice)}</td>
          <td dir="ltr">${fmt(l.lineTotal)}</td>
        </tr>`
      : `<tr>
          <td>${esc(l.name)}${edited ? ' <small>(معدّل)</small>' : ''}${giftNote}</td>
          <td dir="ltr">${esc(l.barcode)}</td>
          <td dir="ltr">${l.qty}${gift > 0 ? ` + ${gift} هدية` : ''}</td>
          <td dir="ltr">${fmt(l.unitPrice)}${edited ? `<br><small>كان ${fmt(l.originalPrice)}</small>` : ''}</td>
          <td dir="ltr">${fmt(l.lineTotal)}</td>
        </tr>`;
  }).join('');

  if (thermal) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(invoice.invoiceNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font-family: Tahoma, Arial, sans-serif; margin: 0; padding: 8px; width: 72mm; font-size: 11px; color: #111; }
    .center { text-align: center; }
    h1 { font-size: 14px; margin: 0 0 4px; }
    .sub { font-size: 10px; color: #444; margin-bottom: 8px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { padding: 3px 2px; text-align: right; vertical-align: top; border-bottom: 1px dashed #ccc; }
    th { font-size: 9px; color: #555; }
    .totals { margin-top: 8px; font-size: 11px; }
    .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
    .grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; }
    .foot { text-align: center; margin-top: 10px; font-size: 9px; color: #555; }
    @media print { body { width: 72mm; } }
  </style>
</head>
<body>
  <div class="center">
    <h1>${esc(STORE_NAME)}</h1>
    <div class="sub">${title}<br>${esc(branchName)}</div>
  </div>
  <div class="sub">
    <div>رقم: <b dir="ltr">${esc(invoice.invoiceNo)}</b></div>
    <div>تاريخ: ${esc(invoice.invoiceDate)}</div>
    <div>عميل: ${esc(invoice.customerName || 'نقدي')}</div>
    <div>دفع: ${payLabel(invoice.paymentMethod)}</div>
  </div>
  <table>
    <thead><tr><th>المنتج</th><th>ك</th><th>سعر</th><th>مجموع</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    <div><span>المجموع</span><span dir="ltr">${fmt(invoice.subtotal)}</span></div>
    ${invoice.discount ? `<div><span>خصم</span><span dir="ltr">${fmt(invoice.discount)}</span></div>` : ''}
    <div class="grand"><span>الصافي</span><span dir="ltr">${fmt(invoice.total)}</span></div>
    ${invoice.paidAmount ? `<div><span>مدفوع</span><span dir="ltr">${fmt(invoice.paidAmount)}</span></div>` : ''}
    ${invoice.dueAmount ? `<div><span>متبقي</span><span dir="ltr">${fmt(invoice.dueAmount)}</span></div>` : ''}
  </div>
  ${invoice.notes ? `<div class="sub">ملاحظات: ${esc(invoice.notes)}</div>` : ''}
  <div class="foot">${esc(footer)}</div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${esc(invoice.invoiceNo)}</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 1.2rem; margin: 0 0 4px; }
    .meta { font-size: 0.85rem; color: #555; margin-bottom: 16px; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: right; }
    th { background: #f1f5f9; }
    .totals { margin-top: 16px; text-align: left; font-size: 1rem; }
    .grand { font-size: 1.2rem; font-weight: bold; color: ${isReturn ? '#dc2626' : '#0d9488'}; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${esc(STORE_NAME)} — ${title}</h1>
  <div class="meta">
    <div>الرقم: <strong dir="ltr">${esc(invoice.invoiceNo)}</strong></div>
    <div>التاريخ: ${esc(invoice.invoiceDate)}</div>
    <div>الفرع: ${esc(branchName)}</div>
    <div>العميل: ${esc(invoice.customerName || 'نقدي')}</div>
    <div>طريقة الدفع: ${payLabel(invoice.paymentMethod)}</div>
    ${invoice.notes ? `<div>ملاحظات: ${esc(invoice.notes)}</div>` : ''}
  </div>
  <table>
    <thead>
      <tr><th>المنتج</th><th>باركود</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    <div>المجموع: <span dir="ltr">${fmt(invoice.subtotal)}</span></div>
    ${invoice.discount ? `<div>خصم: <span dir="ltr">${fmt(invoice.discount)}</span></div>` : ''}
    <div class="grand">الصافي: <span dir="ltr">${fmt(invoice.total)}</span></div>
    ${invoice.paidAmount ? `<div>مدفوع: <span dir="ltr">${fmt(invoice.paidAmount)}</span></div>` : ''}
    ${invoice.dueAmount ? `<div>متبقي على الحساب: <span dir="ltr">${fmt(invoice.dueAmount)}</span></div>` : ''}
  </div>
  <div class="foot" style="margin-top:20px;text-align:center;color:#666">${esc(footer)}</div>
  <script>window.onload = () => { window.print(); }</script>
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
