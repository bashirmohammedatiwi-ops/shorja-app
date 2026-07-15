/**
 * يرسل طلب تجهيز من مخزن فرع الشورجة إلى بوابة المندوبين (delegate-portal).
 */
async function submitWarehousePrepOrder(invoice, { branchName = '', edariSeq = '' } = {}) {
  const base = String(process.env.DELEGATE_PORTAL_URL || '').replace(/\/$/, '');
  const key = process.env.DELEGATE_INTEGRATION_KEY
    || process.env.SYNC_KEY
    || '';
  if (!base) {
    return { ok: false, skipped: true, error: 'DELEGATE_PORTAL_URL غير مضبوط' };
  }
  if (!key) {
    return { ok: false, skipped: true, error: 'DELEGATE_INTEGRATION_KEY غير مضبوط' };
  }

  const lines = (invoice.lines || []).map((line) => ({
    barcode: line.barcode || '',
    matName: line.name || '',
    quant: Number(line.qty || 0),
    bonus: Number(line.giftQty || 0),
    tester: 0,
    unitPrice: Number(line.unitPrice || 0),
    lineTotal: Number(line.lineTotal || 0),
    remarks: ''
  })).filter((l) => l.matName && (l.quant > 0 || l.bonus > 0));

  if (!lines.length) {
    return { ok: false, error: 'لا توجد بنود صالحة لطلب التجهيز' };
  }

  const body = {
    shorjaInvoiceId: invoice.id,
    shorjaInvoiceNo: invoice.invoiceNo,
    shorjaBranchName: branchName,
    customerName: invoice.customerName || '',
    customerAccSeq: edariSeq || '',
    notes: invoice.notes || '',
    lines
  };

  const res = await fetch(`${base}/api/integration/shorja/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-key': key
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return {
    ok: true,
    prepOrderId: data.order?.id,
    prepOrderNo: data.order?.orderNo || ''
  };
}

module.exports = {
  submitWarehousePrepOrder
};
