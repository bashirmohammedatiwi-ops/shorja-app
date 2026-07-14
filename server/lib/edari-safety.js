/**
 * حماية Edari الأصلي — الكتابة المباشرة عبر SQL تتجاوز منطق الإداري وقد تُفسد العدادات.
 * الافتراضي: قراءة فقط. تفعيل الكتابة يتطلب موافقة صريحة في .env
 */

function isEnabled(flag, defaultOn = false) {
  const v = process.env[flag];
  if (v === undefined || v === '') return defaultOn;
  return v !== '0' && v !== 'false' && v !== 'no';
}

function canWriteEdariMaster() {
  return isEnabled('EDARI_WRITE_ENABLED', false);
}

function canWriteEdariAccounts() {
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_ACCOUNTS', false);
}

function canWriteEdariInvoices() {
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_INVOICES', false);
}

function canWriteEdariStock() {
  return canWriteEdariInvoices() && isEnabled('EDARI_WRITE_STOCK', false);
}

function shorjaBillNumFloor() {
  return Number(process.env.EDARI_SHORJA_BILL_NUM_START || 9000000);
}

function isIsolatedShorjaBillNum(num) {
  return Number(num) >= shorjaBillNumFloor();
}

function shorjaRemarksTag() {
  return String(process.env.EDARI_SHORJA_REMARKS || 'شورجة SHORJA');
}

module.exports = {
  isEnabled,
  canWriteEdariMaster,
  canWriteEdariAccounts,
  canWriteEdariInvoices,
  canWriteEdariStock,
  shorjaBillNumFloor,
  isIsolatedShorjaBillNum,
  shorjaRemarksTag
};
