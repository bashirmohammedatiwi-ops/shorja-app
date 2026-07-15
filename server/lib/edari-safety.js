/**
 * حماية Edari الأصلي — الكتابة المباشرة عبر SQL تتجاوز منطق الإداري وقد تُفسد العدادات.
 * الافتراضي: قراءة فقط. الكتابة مسموحة فقط أثناء جلسة مزامنة يدوية أو EDARI_WRITE_ENABLED=1.
 */

let manualSyncSession = null;

function isEnabled(flag, defaultOn = false) {
  const v = process.env[flag];
  if (v === undefined || v === '') return defaultOn;
  return v !== '0' && v !== 'false' && v !== 'no';
}

function isManualSyncOnlyMode() {
  return isEnabled('EDARI_MANUAL_SYNC_ONLY', true);
}

function getManualSyncSession() {
  return manualSyncSession;
}

function beginManualEdariSyncSession({ accounts = false, invoices = false, payments = false } = {}) {
  manualSyncSession = {
    accounts: !!accounts,
    invoices: !!invoices,
    payments: !!payments,
    startedAt: Date.now()
  };
  return manualSyncSession;
}

function endManualEdariSyncSession() {
  manualSyncSession = null;
}

function canWriteEdariMaster() {
  if (manualSyncSession) return true;
  return isEnabled('EDARI_WRITE_ENABLED', false);
}

function canWriteEdariAccounts() {
  if (manualSyncSession?.accounts) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_ACCOUNTS', false);
}

function canWriteEdariInvoices() {
  if (manualSyncSession?.invoices) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_INVOICES', false);
}

function canWriteEdariPayments() {
  if (manualSyncSession?.payments) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_INVOICES', false);
}

function canWriteEdariStock() {
  if (manualSyncSession?.invoices) return isEnabled('EDARI_WRITE_STOCK', false);
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
  isManualSyncOnlyMode,
  getManualSyncSession,
  beginManualEdariSyncSession,
  endManualEdariSyncSession,
  canWriteEdariMaster,
  canWriteEdariAccounts,
  canWriteEdariInvoices,
  canWriteEdariPayments,
  canWriteEdariStock,
  shorjaBillNumFloor,
  isIsolatedShorjaBillNum,
  shorjaRemarksTag
};
