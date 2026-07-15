/**
 * حماية Edari الأصلي — الكتابة المباشرة عبر SQL تتجاوز منطق الإداري وقد تُفسد العدادات.
 * الافتراضي: قراءة فقط. الكتابة مسموحة فقط أثناء جلسة مزامنة يدوية أو EDARI_WRITE_ENABLED=1.
 */

const SESSION_STORE_KEY = '__shorjaEdariManualSyncSession';

function sessionStore() {
  if (!global[SESSION_STORE_KEY]) {
    global[SESSION_STORE_KEY] = { manualSyncSession: null };
  }
  return global[SESSION_STORE_KEY];
}

function getManualSyncSession() {
  return sessionStore().manualSyncSession;
}

function beginManualEdariSyncSession({ accounts = false, invoices = false, payments = false } = {}) {
  sessionStore().manualSyncSession = {
    accounts: !!accounts,
    invoices: !!invoices,
    payments: !!payments,
    startedAt: Date.now()
  };
  return sessionStore().manualSyncSession;
}

function endManualEdariSyncSession() {
  sessionStore().manualSyncSession = null;
}

function canWriteEdariMaster() {
  if (sessionStore().manualSyncSession) return true;
  return isEnabled('EDARI_WRITE_ENABLED', false);
}

function canWriteEdariAccounts() {
  const session = sessionStore().manualSyncSession;
  if (session?.accounts) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_ACCOUNTS', false);
}

function canWriteEdariInvoices() {
  const session = sessionStore().manualSyncSession;
  if (session?.invoices) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_INVOICES', false);
}

function canWriteEdariPayments() {
  const session = sessionStore().manualSyncSession;
  if (session?.payments) return true;
  return canWriteEdariMaster() && isEnabled('EDARI_WRITE_INVOICES', false);
}

function canWriteEdariStock() {
  const session = sessionStore().manualSyncSession;
  if (session?.invoices) return isEnabled('EDARI_WRITE_STOCK', false);
  return canWriteEdariInvoices() && isEnabled('EDARI_WRITE_STOCK', false);
}

function isEnabled(flag, defaultOn = false) {
  const v = process.env[flag];
  if (v === undefined || v === '') return defaultOn;
  return v !== '0' && v !== 'false' && v !== 'no';
}

function isManualSyncOnlyMode() {
  return isEnabled('EDARI_MANUAL_SYNC_ONLY', true);
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
