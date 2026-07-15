/**
 * يرسل طلب تجهيز من مخزن فرع الشورجة إلى بوابة المندوبين (delegate-portal).
 */
function getDelegateConfig() {
  const base = String(process.env.DELEGATE_PORTAL_URL || '').replace(/\/$/, '');
  const key = String(process.env.DELEGATE_INTEGRATION_KEY || '').trim();
  return { base, key };
}

async function probeDelegateIntegration() {
  const { base, key } = getDelegateConfig();
  if (!base) {
    return { ok: false, configured: false, error: 'DELEGATE_PORTAL_URL غير مضبوط على السيرفر' };
  }
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: 'DELEGATE_INTEGRATION_KEY غير مضبوط — يجب أن يطابق SYNC_API_KEY في delegate-portal'
    };
  }
  try {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!health.ok) {
      return { ok: false, configured: true, portalReachable: false, error: `بوابة المندوبين لا تستجيب (${health.status})` };
    }
    const res = await fetch(`${base}/api/integration/shorja/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-key': key
      },
      body: JSON.stringify({ lines: [{ matName: 'ping', quant: 1 }] }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 403) {
      return {
        ok: false,
        configured: true,
        portalReachable: true,
        keyValid: false,
        error: 'مفتاح التكامل غير صحيح — طابق DELEGATE_INTEGRATION_KEY مع SYNC_API_KEY في delegate-portal'
      };
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 && data.error) {
      return { ok: true, configured: true, portalReachable: true, keyValid: true };
    }
    if (res.ok && data.ok) {
      return { ok: true, configured: true, portalReachable: true, keyValid: true, note: 'تم إنشاء طلب اختبار' };
    }
    return {
      ok: false,
      configured: true,
      portalReachable: true,
      keyValid: true,
      error: data.error || `استجابة غير متوقعة (${res.status})`
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err.message || 'تعذر الاتصال ببوابة المندوبين'
    };
  }
}

async function submitWarehousePrepOrder(invoice, { branchName = '', edariSeq = '' } = {}) {
  const { base, key } = getDelegateConfig();
  if (!base) {
    return { ok: false, skipped: true, error: 'DELEGATE_PORTAL_URL غير مضبوط على السيرفر' };
  }
  if (!key) {
    return {
      ok: false,
      skipped: true,
      error: 'DELEGATE_INTEGRATION_KEY غير مضبوط — يجب أن يطابق SYNC_API_KEY في delegate-portal'
    };
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
  if (res.status === 403) {
    const msg = 'مفتاح التكامل مرفوض — تأكد أن DELEGATE_INTEGRATION_KEY = SYNC_API_KEY في delegate-portal';
    console.error('[warehouse-prep]', msg, { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
    return { ok: false, error: msg };
  }
  if (!res.ok || !data.ok) {
    const err = data.error || `HTTP ${res.status}`;
    console.error('[warehouse-prep] فشل الإرسال:', err, { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
    return { ok: false, error: err };
  }
  console.log('[warehouse-prep] تم الإرسال:', data.order?.orderNo || data.order?.id, { invoiceId: invoice.id });
  return {
    ok: true,
    prepOrderId: data.order?.id,
    prepOrderNo: data.order?.orderNo || ''
  };
}

module.exports = {
  getDelegateConfig,
  probeDelegateIntegration,
  submitWarehousePrepOrder
};
