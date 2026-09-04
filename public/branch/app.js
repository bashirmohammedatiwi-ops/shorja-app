const API = '/api';
const APP_VERSION = '42';
const STORAGE_KEY = 'shorja_branch';
const CACHE_KEY = 'shorja_products_cache';
const OUTBOX_KEY = 'shorja_outbox';
const HELD_KEY = 'shorja_held';
const PRICE_VER_KEY = 'shorja_price_version';
const DATA_REV_KEY = 'shorja_data_revision';
const LAST_INV_KEY = 'shorja_last_invoice';
const STOCK_RECENT_KEY = 'shorja_stock_recent';

const SETTINGS_KEY = 'shorja_branch_settings';

const DEFAULT_SETTINGS = {
  lowStockThreshold: 5,
  blockZeroStock: false,
  blockOverStock: true,
  allowPriceEdit: true,
  receiptFooter: 'شكراً لزيارتكم — ديما الحياة',
  thermalPrint: false,
  scanSound: true
};

const PAGE_TITLES = {
  pos: ['إنشاء فاتورة', 'مسح باركود · بحث · إتمام سريع'],
  dashboard: ['ملخص اليوم', 'أداء الفرع · طرق الدفع · الساعة'],
  invoices: ['الفواتير', 'بحث وفلاتر حسب النوع والدفع'],
  returns: ['مرتجع مبيعات', 'إرجاع كامل أو جزئي'],
  held: ['فواتير معلّقة', 'استئناف البيع على هذا الجهاز'],
  accounts: ['حسابات العملاء', 'الديون والأرصدة وكشف الحساب'],
  payments: ['تسديد الحسابات', 'تسجيل دفعات العملاء'],
  stock: ['استعلام باركود', 'امسح الباركود لعرض تفاصيل المنتج'],
  reports: ['التقارير', 'مبيعات وتحصيلات حسب الفترة'],
  settings: ['الإعدادات', 'سلوك نقطة البيع والطباعة والمزامنة']
};

const state = {
  token: null,
  user: null,
  products: [],
  productIndex: { byBarcode: new Map(), bySku: new Map(), list: [] },
  productsDirty: true,
  searchResults: [],
  searchHighlight: 0,
  searchAbort: null,
  cart: [],
  customer: null,
  discount: 0,
  checkoutMethod: 'cash',
  prepFromWarehouse: false,
  invoiceType: 'sale',
  returnParent: null,
  priceVersion: 0,
  online: navigator.onLine,
  activeInvoice: null,
  returnMode: false,
  activeAccount: null,
  lastInvoiceId: null,
  lastScan: null,
  pendingPayAccountId: null,
  lastInvoices: [],
  lastReport: null,
  settings: { ...DEFAULT_SETTINGS },
  viewCache: {},
  cartRenderQueued: false,
  posSession: null
};

const VIEW_CACHE_MS = 25000;

function newLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* HTTP / insecure context */ }
  }
  return `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ── Storage ──
function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.token = data.token;
    state.user = data.user;
    state.priceVersion = Number(localStorage.getItem(PRICE_VER_KEY) || 0);
    state.lastInvoiceId = Number(localStorage.getItem(LAST_INV_KEY) || 0) || null;
  } catch { /* */ }
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, user: state.user }));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  state.token = null;
  state.user = null;
}

function getOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
}

function saveOutbox(items) { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); }

function getHeld() {
  try { return JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); } catch { return []; }
}

function saveHeld(items) {
  localStorage.setItem(HELD_KEY, JSON.stringify(items));
  updateHeldBadge();
}

function cacheProducts(products) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), products }));
}

function loadLocalSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveLocalSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function getSettings() {
  return state.settings || DEFAULT_SETTINGS;
}

async function loadSettings() {
  try {
    const data = await api('/branch/settings');
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  } catch {
    state.settings = loadLocalSettings();
  }
  saveLocalSettings(state.settings);
}

async function validateSession() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
    saveSession();
    return true;
  } catch {
    clearSession();
    return false;
  }
}

function payLabel(method, inv = null) {
  if (method === 'issue') return 'إخراج';
  if (method === 'partial') return 'جزئي';
  if (method === 'credit') return 'آجل';
  if (inv && inv.paidAmount > 0 && inv.dueAmount > 0) return 'جزئي';
  return 'نقدي';
}

function kindLabel(kind) {
  if (kind === 'return') return 'مرتجع';
  if (kind === 'issue') return 'إخراج';
  return 'مبيعات';
}

function kindBadgeClass(kind) {
  if (kind === 'return') return 'return';
  if (kind === 'issue') return 'issue';
  return 'sale';
}

function invoiceTypeHeading(type) {
  if (type === 'return') return 'فاتورة مرتجع';
  if (type === 'issue') return 'إذن إخراج مخزون';
  return 'فاتورة مبيعات';
}

function checkoutButtonText(type) {
  if (type === 'return') return 'تأكيد المرتجع';
  if (type === 'issue') return 'تأكيد الإخراج';
  return 'إتمام الفاتورة';
}

function setInvoiceType(type, { force = false } = {}) {
  const next = ['sale', 'return', 'issue'].includes(type) ? type : 'sale';
  if (!force && next !== state.invoiceType && state.cart.length) {
    if (!confirm('تغيير نوع الفاتورة سيفرغ البنود الحالية — متابعة؟')) return;
  }
  state.invoiceType = next;
  state.cart = [];
  state.customer = null;
  state.discount = 0;
  state.returnParent = null;
  document.getElementById('discountInput').value = '0';
  applyCustomer(null);
  document.getElementById('issueReason') && (document.getElementById('issueReason').value = '');
  document.getElementById('lastScanPreview')?.classList.add('hidden');

  const viewPos = document.getElementById('viewPos');
  viewPos?.classList.remove('inv-type-sale', 'inv-type-return', 'inv-type-issue');
  viewPos?.classList.add(`inv-type-${next}`);

  document.querySelectorAll('.inv-type-tab').forEach((tab) => {
    const active = tab.dataset.invType === next;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const heading = document.getElementById('posInvoiceHeading');
  if (heading) heading.textContent = invoiceTypeHeading(next);
  const thQty = document.getElementById('thQty');
  if (thQty) thQty.textContent = 'الكمية';
  const dockGrandLbl = document.getElementById('dockGrandLbl');
  if (dockGrandLbl) dockGrandLbl.textContent = next === 'return' ? 'قيمة المرتجع' : 'الصافي';
  const btnText = document.getElementById('checkoutBtnText');
  if (btnText) btnText.textContent = checkoutButtonText(next);
  const emptyTitle = document.getElementById('cartEmptyTitle');
  const emptySub = document.getElementById('cartEmptySub');
  if (emptyTitle && emptySub) {
    if (next === 'return') {
      emptyTitle.textContent = 'ابدأ بمسح باركود المرتجع';
      emptySub.textContent = 'اختر عميلاً لخصم قيمة المرتجع من دينه';
    } else if (next === 'issue') {
      emptyTitle.textContent = 'امسح المنتجات للإخراج';
      emptySub.textContent = 'اكتب سبب الإخراج قبل التأكيد';
    } else {
      emptyTitle.textContent = 'ابدأ بمسح باركود';
      emptySub.textContent = 'أو ابحث عن منتج بالاسم';
    }
  }

  document.getElementById('viewPos')?.classList.toggle('show-return-link', false);
  document.getElementById('viewPos')?.classList.toggle('linked-return', false);
  document.getElementById('returnParentBanner')?.classList.add('hidden');
  document.getElementById('returnDebtHint')?.classList.add('hidden');
  if (next === 'return') focusBarcode();
  else focusBarcode();
  newPosSession();
  renderCart();
}

function invalidateProducts() {
  state.productsDirty = true;
}

function rebuildProductIndex() {
  const seen = new Set();
  const list = [];
  state.productIndex.byBarcode.clear();
  state.productIndex.bySku.clear();
  for (const p of [...state.products, ...loadCachedProducts()]) {
    if (!p?.barcode || seen.has(p.barcode)) continue;
    seen.add(p.barcode);
    list.push(p);
    state.productIndex.byBarcode.set(p.barcode, p);
    if (p.sku) state.productIndex.bySku.set(String(p.sku), p);
  }
  state.productIndex.list = list;
  state.productsDirty = false;
}

function debounce(fn, ms = 220) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function cachedView(key, loader, ttl = VIEW_CACHE_MS) {
  const hit = state.viewCache[key];
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  return loader().then((data) => {
    state.viewCache[key] = { at: Date.now(), data };
    return data;
  });
}

function loadCachedProducts() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}').products || []; } catch { return []; }
}

function bustViewCache(...keys) {
  if (!keys.length) state.viewCache = {};
  else keys.forEach((k) => delete state.viewCache[k]);
}

// ── Utils ──
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isoDay(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}

function localInvoiceStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    invoiceDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    createdAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

function withLocalStamp(payload) {
  return { ...localInvoiceStamp(), ...payload };
}

function rangeForPreset(key) {
  const today = isoDay();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const week = new Date(); week.setDate(week.getDate() - 6);
  const month = new Date(); month.setDate(1);
  if (key === 'yesterday') return [isoDay(y), isoDay(y)];
  if (key === 'week') return [isoDay(week), today];
  if (key === 'month') return [isoDay(month), today];
  return [today, today];
}

function emptyState(title, sub = '') {
  return `<div class="empty-block"><p class="empty-title">${esc(title)}</p>${sub ? `<p class="empty-sub">${esc(sub)}</p>` : ''}</div>`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function applyCustomer(account) {
  state.customer = account || null;
  const el = document.getElementById('customerLabel');
  if (!el) return;
  if (!account) {
    el.textContent = 'نقدي';
    return;
  }
  const debt = Number(account.balance || 0);
  el.textContent = debt > 0
    ? `${account.name} · دين ${fmt(debt)}`
    : `${account.name}${account.code ? ` (${account.code})` : ''}`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function updateOfflineBanner() {
  document.getElementById('offlineBanner')?.classList.toggle('hidden', !!state.online);
}

function updatePageMeta() {
  const el = document.getElementById('pageHeaderMeta');
  if (!el) return;
  const view = document.querySelector('.nav-item.active')?.dataset.view;
  if (view === 'pos' && state.cart.length) {
    const total = Math.max(0, state.cart.reduce((s, l) => s + l.lineTotal, 0) - state.discount);
    el.textContent = `${state.cart.length} بند · ${fmt(total)}`;
    return;
  }
  el.textContent = state.lastInvoiceId ? `آخر فاتورة #${state.lastInvoiceId}` : '';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const { signal, ...rest } = opts;
  try {
    const res = await fetch(`${API}${path}`, { ...rest, headers, signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'خطأ في الاتصال');
    state.online = true;
    updateSyncPill();
    return data;
  } catch (err) {
    if (!navigator.onLine) state.online = false;
    updateSyncPill();
    throw err;
  }
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type !== 'ok' ? ` toast-${type}` : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

function flashScan() {
  const el = document.getElementById('scanFlash');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 400);
  const bar = document.getElementById('scanBar');
  if (bar) {
    bar.classList.add('scan-success');
    setTimeout(() => bar.classList.remove('scan-success'), 350);
  }
  if (getSettings().scanSound === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); o.stop(ctx.currentTime + 0.07);
  } catch { /* */ }
}

function newPosSession() {
  state.posSession = String(Math.floor(1000 + Math.random() * 9000));
  const el = document.getElementById('posSessionId');
  if (el) el.textContent = `#${state.posSession}`;
}

function showLastScan(product, qty = 1) {
  const el = document.getElementById('lastScanPreview');
  if (!el || !product) return;
  state.lastScan = { barcode: product.barcode, name: product.name };
  el.innerHTML = `
    <span class="scan-check">✓</span>
    <div class="scan-info">
      <strong>${esc(product.name)}</strong>
      <span class="scan-barcode" dir="ltr">${esc(product.barcode)}</span>
      <span class="scan-meta">كمية ${qty}${product.stockQty != null ? ` · مخزون ${fmt(product.stockQty)}` : ''}</span>
    </div>
    <span class="scan-price" dir="ltr">${fmt(product.price)}</span>
    <button type="button" class="btn btn-sm btn-secondary" id="btnLastScanAgain" title="إضافة وحدة أخرى">+1</button>`;
  el.classList.remove('hidden');
  document.getElementById('btnLastScanAgain')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.lastScan?.barcode) addToCart(state.lastScan.barcode, 1);
  });
}

function setPosMode(active) {
  document.getElementById('app')?.classList.toggle('pos-mode', active);
}

function updateDayStatsDisplay(count, net) {
  const countStr = String(count ?? 0);
  const netStr = typeof net === 'number' ? fmt(net) : String(net ?? 0);
  const statCount = document.getElementById('statCount');
  const statNet = document.getElementById('statNet');
  const posCount = document.getElementById('posStatCount');
  const posNet = document.getElementById('posStatNet');
  if (statCount) statCount.textContent = countStr;
  if (statNet) statNet.textContent = netStr;
  if (posCount) posCount.textContent = countStr;
  if (posNet) posNet.textContent = netStr;
}

function updateSyncPill() {
  const el = document.getElementById('syncPill');
  if (!el) return;
  const pending = getOutbox().length;
  if (!state.online) {
    el.textContent = pending ? `غير متصل · ${pending} معلّق` : 'غير متصل';
    el.classList.add('offline');
  } else {
    el.textContent = pending ? `متصل · ${pending} قيد الرفع` : 'متصل';
    el.classList.remove('offline');
  }
  updateOfflineBanner();
}

function updateHeldBadge() {
  const el = document.getElementById('heldBadge');
  const n = getHeld().length;
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

function setPageTitle(view) {
  const [title, sub] = PAGE_TITLES[view] || ['', ''];
  const t = document.getElementById('pageTitle');
  const s = document.getElementById('pageSubtitle');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;
  updatePageMeta();
}

function tickClock() {
  const d = new Date();
  const time = d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' });
  const el = document.getElementById('clockNow');
  if (el) el.textContent = time;
  const posClock = document.getElementById('posClock');
  if (posClock) posClock.textContent = time;
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('branchBadge').textContent = state.user?.branchName || 'الفرع';
  const cashier = document.getElementById('cashierBadge');
  if (cashier) cashier.textContent = state.user?.fullName || state.user?.username || '';
  updateReprintHeader();
  focusBarcode();
}

function updateReprintHeader() {
  const btn = document.getElementById('btnReprintLastHeader');
  if (!btn) return;
  btn.classList.toggle('hidden', !state.lastInvoiceId);
}

function gotoView(view, invType = '') {
  const nav = invType
    ? document.querySelector(`.nav-item[data-view="${view}"][data-inv-type="${invType}"]`)
    : document.querySelector(`.nav-item[data-view="${view}"]:not([data-inv-type])`) || document.querySelector(`[data-view="${view}"]`);
  nav?.click();
}

const JUMP_ITEMS = [
  { label: 'البيع', view: 'pos', hint: 'فاتورة جديدة' },
  { label: 'مرتجع', view: 'pos', inv: 'return', hint: 'إرجاع مبيعات' },
  { label: 'إخراج', view: 'pos', inv: 'issue', hint: 'إذن مخزون' },
  { label: 'اليوم', view: 'dashboard', hint: 'ملخص الفرع' },
  { label: 'الفواتير', view: 'invoices', hint: 'بحث وطباعة' },
  { label: 'معلّق', view: 'held', hint: 'فواتير هذا الجهاز' },
  { label: 'الحسابات', view: 'accounts', hint: 'ديون العملاء' },
  { label: 'تسديد', view: 'payments', hint: 'تحصيل دين' },
  { label: 'استعلام', view: 'stock', hint: 'باركود ومخزون' },
  { label: 'تقارير', view: 'reports', hint: 'مبيعات الفترة' },
  { label: 'إعدادات', view: 'settings', hint: 'طباعة ومزامنة' }
];

function renderJumpList(q = '') {
  const needle = String(q || '').trim().toLowerCase();
  const items = JUMP_ITEMS.filter((i) => !needle || i.label.includes(q) || String(i.hint || '').includes(q) || i.view.includes(needle));
  const el = document.getElementById('jumpList');
  if (!el) return;
  el.innerHTML = items.map((i, idx) => `
    <button type="button" class="picker-item${idx === 0 ? ' active' : ''}" data-view="${i.view}" data-inv="${i.inv || ''}">
      <strong>${esc(i.label)}</strong>
      <span style="color:var(--text-muted);font-size:0.8rem"> — ${esc(i.hint)}</span>
    </button>
  `).join('') || '<p class="hint">لا توجد نتائج</p>';
}

function openJump() {
  renderJumpList();
  const modal = document.getElementById('jumpModal');
  modal?.showModal();
  setTimeout(() => {
    const inp = document.getElementById('jumpInput');
    if (inp) { inp.value = ''; inp.focus(); }
  }, 30);
}

document.getElementById('jumpInput')?.addEventListener('input', (e) => renderJumpList(e.target.value));
document.getElementById('jumpInput')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const first = document.querySelector('#jumpList .picker-item');
  first?.click();
});
document.getElementById('jumpList')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  document.getElementById('jumpModal')?.close();
  gotoView(btn.dataset.view, btn.dataset.inv || '');
});

function focusBarcode() {
  const el = document.getElementById('barcodeInput');
  if (el) {
    el.value = '';
    setTimeout(() => el.focus(), 50);
  }
}

function clearBarcodeField() {
  const el = document.getElementById('barcodeInput');
  if (el) el.value = '';
}

// ── Login ──
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginUser').value.trim(),
        password: document.getElementById('loginPass').value.trim()
      })
    });
    if (data.user.role !== 'branch' && data.user.role !== 'admin') {
      throw new Error('حساب الفرع فقط');
    }
    state.token = data.token;
    state.user = data.user;
    saveSession();
    showApp();
    await initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  if (state.cart.length && !confirm('يوجد منتجات في السلة — تسجيل الخروج؟')) return;
  clearSession();
  location.reload();
});

// ── Navigation ──
document.getElementById('mainNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  const invType = btn.dataset.invType;
  const view = btn.dataset.view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const el = document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`);
  if (el) el.classList.remove('hidden');
  setPosMode(view === 'pos');
  setPageTitle(view);
  if (view === 'pos') {
    if (invType) setInvoiceType(invType, { force: true });
    else if (state.invoiceType !== 'sale') setInvoiceType('sale');
  }
  const loaders = {
    pos: () => focusBarcode(),
    dashboard: loadDashboard,
    invoices: loadInvoices,
    held: loadHeldList,
    accounts: loadAccounts,
    payments: loadPaymentsView,
    stock: loadStockView,
    reports: () => { initReportDates(); loadReportsView(); },
    settings: loadSettingsView
  };
  loaders[view]?.();
});

document.getElementById('invoiceTypeTabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.inv-type-tab');
  if (!tab) return;
  setInvoiceType(tab.dataset.invType);
});

document.getElementById('dashboardActions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (!btn) return;
  gotoView(btn.dataset.goto, btn.dataset.invType || '');
});

document.getElementById('headerStats')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (!btn) return;
  gotoView(btn.dataset.goto);
});

document.getElementById('dashboardKpis')?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-goto]');
  if (!card) return;
  gotoView(card.dataset.goto, card.dataset.invType || '');
});

document.getElementById('syncPill')?.addEventListener('click', async () => {
  if (!getOutbox().length) {
    toast(state.online ? 'لا توجد فواتير بانتظار الرفع' : 'الجهاز غير متصل');
    return;
  }
  await flushOutbox();
  toast('تم محاولة رفع الفواتير المعلّقة');
});

document.getElementById('btnReprintLastHeader')?.addEventListener('click', () => {
  if (state.lastInvoiceId) printInvoice(state.lastInvoiceId);
});

// ── Products (cache for barcode + search) ──
function mergeProductIntoState(product) {
  if (!product?.barcode) return false;
  const idx = state.products.findIndex((p) => p.barcode === product.barcode);
  const isNew = idx < 0;
  if (idx >= 0) state.products[idx] = product;
  else state.products.push(product);
  cacheProducts(state.products);
  invalidateProducts();
  return isNew;
}

function updateCachedProductCount() {
  const el = document.getElementById('cachedProductCount');
  if (el) el.textContent = String(allProducts().length);
}

async function fetchProductFromAdmin(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const data = await api(`/branch/products/barcode/${encodeURIComponent(c)}`);
  if (!data.product) return null;
  const isNew = mergeProductIntoState(data.product);
  return { product: data.product, isNew };
}

async function loadProducts() {
  try {
    const data = await api('/branch/products?limit=500');
    state.products = data.products || [];
    cacheProducts(state.products);
    invalidateProducts();
    updateCachedProductCount();
  } catch {
    state.products = loadCachedProducts();
    invalidateProducts();
    updateCachedProductCount();
    if (state.products.length) toast('منتجات محفوظة — وضع offline', 'warn');
  }
}

async function syncAllProductsFromAdmin() {
  if (!navigator.onLine) {
    toast('لا يوجد اتصال بالسيرفر', 'err');
    return;
  }
  const btn = document.getElementById('btnSyncProducts');
  const label = btn?.dataset.label || btn?.textContent || 'تحديث جميع المنتجات من الإدارة';
  if (btn) {
    btn.dataset.label = label;
    btn.disabled = true;
  }
  try {
    let offset = 0;
    const limit = 500;
    let total = Infinity;
    const merged = new Map();

    while (offset < total) {
      if (btn) btn.textContent = `جاري التحديث... ${offset || ''}`;
      const data = await api(`/branch/products?sync=1&limit=${limit}&offset=${offset}`);
      const batch = data.products || [];
      total = Number(data.total) || batch.length;
      for (const p of batch) merged.set(p.barcode, p);
      offset += batch.length;
      if (!batch.length) break;
    }

    state.products = [...merged.values()];
    cacheProducts(state.products);
    invalidateProducts();
    updateCachedProductCount();
    await checkPriceUpdate();
    toast(`تم تحديث ${state.products.length} منتج من الإدارة`);
  } catch (err) {
    toast(err.message || 'فشل تحديث المنتجات', 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || label;
    }
  }
}

async function fetchBarcodeFromAdmin() {
  const input = document.getElementById('barcodeInput');
  const code = input?.value.trim();
  if (!code) {
    toast('أدخل الباركود أولاً', 'warn');
    focusBarcode();
    return;
  }
  if (!navigator.onLine) {
    toast('لا يوجد اتصال — يُستخدم المخزون المحلي', 'warn');
    return;
  }
  const btn = document.getElementById('btnFetchBarcode');
  if (btn) btn.disabled = true;
  try {
    const result = await fetchProductFromAdmin(code);
    if (!result) {
      toast('المنتج غير موجود في قاعدة الإدارة', 'err');
      focusBarcode();
      return;
    }
    const line = state.cart.find((l) => l.barcode === result.product.barcode);
    if (line) {
      line.name = result.product.name;
      line.unitPrice = result.product.price;
      line.originalPrice = result.product.price;
      line.stockQty = result.product.stockQty;
      line.priceEdited = false;
      recalcLine(line);
      renderCart();
      toast('تم تحديث تفاصيل المنتج في الفاتورة من الإدارة');
    } else {
      toast(result.isNew ? 'تم جلب منتج جديد من الإدارة' : 'تم تحديث تفاصيل المنتج من الإدارة');
      await addToCart(result.product.barcode);
    }
  } catch (err) {
    toast(err.message || 'فشل جلب المنتج', 'err');
  } finally {
    if (btn) btn.disabled = false;
    focusBarcode();
  }
}

function allProducts() {
  if (state.productsDirty) rebuildProductIndex();
  return state.productIndex.list;
}

function findProductLocal(code) {
  if (state.productsDirty) rebuildProductIndex();
  const c = String(code || '').trim();
  if (!c) return null;
  const lower = c.toLowerCase();
  return state.productIndex.byBarcode.get(c)
    || state.productIndex.bySku.get(c)
    || state.productIndex.list.find((p) => p.name.toLowerCase() === lower)
    || null;
}

async function resolveProduct(code) {
  const c = String(code || '').trim();
  if (!c) return null;

  if (navigator.onLine) {
    try {
      const result = await fetchProductFromAdmin(c);
      if (result?.product) return result.product;
    } catch {
      /* fallback to local cache */
    }
  }

  return findProductLocal(c);
}

function filterProducts(q) {
  const term = String(q || '').trim().toLowerCase();
  if (!term) return [];
  return allProducts().filter((p) =>
    p.name.toLowerCase().includes(term)
    || p.barcode.includes(term)
    || (p.sku && p.sku.toLowerCase().includes(term))
  ).slice(0, 15);
}

async function searchProducts(q) {
  const term = String(q || '').trim();
  if (!term) return [];
  let results = filterProducts(term);
  if (results.length >= 8 || !navigator.onLine) return results;
  if (state.searchAbort) state.searchAbort.abort();
  state.searchAbort = new AbortController();
  try {
    const data = await api(`/branch/products?q=${encodeURIComponent(term)}&limit=15`, {
      signal: state.searchAbort.signal
    });
    results = data.products || [];
    for (const p of results) mergeProductIntoState(p);
    updateCachedProductCount();
  } catch (err) {
    if (err.name !== 'AbortError') { /* offline */ }
  }
  return results.length ? results : filterProducts(term);
}

function hideSearchDropdown() {
  const el = document.getElementById('searchDropdown');
  if (el) el.classList.add('hidden');
  state.searchResults = [];
  state.searchHighlight = 0;
}

function renderSearchDropdown(results) {
  const el = document.getElementById('searchDropdown');
  if (!el) return;
  state.searchResults = results;
  state.searchHighlight = 0;
  if (!results.length) {
    el.innerHTML = '<div class="search-empty">لا توجد نتائج</div>';
    el.classList.remove('hidden');
    return;
  }
  el.innerHTML = results.map((p, i) => {
    const low = Number(p.stockQty) <= 0;
    return `
    <button type="button" class="search-item${i === 0 ? ' active' : ''}" data-idx="${i}" data-barcode="${esc(p.barcode)}">
      <div class="search-item-name">${esc(p.name)}</div>
      <div class="search-item-meta">
        <span dir="ltr">${esc(p.barcode)}</span>
        <strong dir="ltr">${fmt(p.price)}</strong>
        <span class="${low ? 'out' : ''}">${low ? 'نفد' : `متوفر ${fmt(p.stockQty)}`}</span>
      </div>
    </button>`;
  }).join('');
  el.classList.remove('hidden');
}

function highlightSearchItem(idx) {
  const items = document.querySelectorAll('.search-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  items[idx]?.scrollIntoView({ block: 'nearest' });
}

function pickSearchResult(idx) {
  const p = state.searchResults[idx];
  if (!p) return;
  document.getElementById('productSearch').value = '';
  hideSearchDropdown();
  addToCart(p.barcode);
}

const onProductSearchInput = debounce(async () => {
  const q = document.getElementById('productSearch').value.trim();
  if (!q) { hideSearchDropdown(); return; }
  const results = await searchProducts(q);
  renderSearchDropdown(results);
}, 180);

// ── Cart ──
async function addToCart(barcode, qty = 1) {
  clearBarcodeField();
  if (state.invoiceType === 'return' && state.returnParent) {
    toast('فك الربط بفاتورة أصلية لإضافة منتجات يدوياً', 'warn');
    focusBarcode();
    return;
  }
  const product = await resolveProduct(barcode);
  if (!product) {
    toast('المنتج غير موجود — تحقق من الباركود أو الاسم', 'err');
    focusBarcode();
    return;
  }
  if (Number(product.stockQty) <= 0) {
    if (getSettings().blockZeroStock) {
      toast('المنتج غير متوفر في المخزون', 'err');
      focusBarcode();
      return;
    }
    toast('المنتج غير متوفر في المخزون', 'warn');
  }
  const existing = state.cart.find((l) => l.barcode === product.barcode);
  const addQty = state.invoiceType === 'issue' ? Math.max(1, qty) : qty;
  const newQty = (existing?.qty || 0) + addQty;
  const totalPieces = newQty + (existing?.giftQty || 0);
  if (product.stockQty > 0 && totalPieces > product.stockQty) {
    if (getSettings().blockOverStock) {
      toast(`المخزون المتاح ${product.stockQty} قطعة فقط`, 'warn');
      focusBarcode();
      return;
    }
  }
  if (existing) {
    existing.qty = newQty;
    recalcLine(existing);
  } else {
    state.cart.push({
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      unitPrice: product.price,
      originalPrice: product.price,
      priceEdited: false,
      giftQty: 0,
      stockQty: product.stockQty,
      qty,
      lineTotal: Math.round(qty * product.price)
    });
  }
  flashScan();
  showLastScan(product, existing ? existing.qty : qty);
  renderCart();
  hideSearchDropdown();
  focusBarcode();
}

function linePieces(line) {
  return (line.qty || 0) + (line.giftQty || 0);
}

function recalcLine(line) {
  line.qty = Math.max(0, Math.round(Number(line.qty) || 0));
  line.giftQty = Math.max(0, Math.round(Number(line.giftQty) || 0));
  line.lineTotal = Math.round(line.qty * line.unitPrice);
  line.priceEdited = Number(line.unitPrice) !== Number(line.originalPrice);
}

function updateCartTotals() {
  const subtotal = state.cart.reduce((s, l) => s + l.lineTotal, 0);
  const discount = Number(document.getElementById('discountInput').value || 0);
  state.discount = discount;
  const net = Math.max(0, subtotal - discount);
  document.getElementById('subtotalVal').textContent = fmt(subtotal);
  document.getElementById('grandTotal').textContent = fmt(net);
  const btnAmt = document.getElementById('checkoutBtnAmt');
  if (btnAmt) btnAmt.textContent = fmt(net);
  const edited = state.cart.filter((l) => l.priceEdited).length;
  const badge = document.getElementById('priceEditBadge');
  if (badge) {
    badge.textContent = `${edited} معدّل`;
    badge.classList.toggle('hidden', !edited);
  }
  const gifts = state.cart.reduce((s, l) => s + (l.giftQty || 0), 0);
  const giftBadge = document.getElementById('giftCountBadge');
  if (giftBadge) {
    giftBadge.textContent = `${gifts} هدية`;
    giftBadge.classList.toggle('hidden', !gifts);
  }
  updateCartMeta();
  updateReturnCustomerHint();
}

function updateReturnCustomerHint() {
  const el = document.getElementById('returnDebtHint');
  if (!el || state.invoiceType !== 'return') return;
  const subtotal = state.cart.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, subtotal - state.discount);
  if (!state.customer || !total) {
    el.classList.add('hidden');
    return;
  }
  const debt = Number(state.customer.balance || 0);
  const after = Math.max(0, debt - total);
  el.innerHTML = `سيُخصم <strong dir="ltr">${fmt(total)}</strong> من دين العميل `
    + `<strong>${esc(state.customer.name)}</strong> — الدين الحالي: <span dir="ltr">${fmt(debt)}</span>`
    + ` → بعد المرتجع: <span dir="ltr">${fmt(after)}</span>`;
  el.classList.remove('hidden');
}

function setLineGiftQty(idx, val) {
  const line = state.cart[idx];
  if (!line) return;
  let g = Math.max(0, Math.round(Number(val) || 0));
  if (line.stockQty > 0 && line.qty + g > line.stockQty) {
    toast(`المخزون لا يكفي (${line.stockQty} قطعة)`, 'warn');
    g = Math.max(0, line.stockQty - line.qty);
  }
  line.giftQty = g;
  recalcLine(line);
  if (!line.qty && !line.giftQty) {
    state.cart.splice(idx, 1);
    renderCart();
    return;
  }
  updateCartTotals();
  const row = document.querySelector(`tr.invoice-row[data-idx="${idx}"]`);
  if (row) {
    row.classList.toggle('row-gift', g > 0);
    row.querySelector('.line-total-cell strong').textContent = fmt(line.lineTotal);
    const inp = row.querySelector('.gift-input');
    if (inp) inp.value = g;
  }
}

function setLinePrice(idx, price) {
  const line = state.cart[idx];
  if (!line) return;
  const p = Math.max(0, Math.round(Number(price) || 0));
  line.unitPrice = p;
  recalcLine(line);
  updateCartTotals();
  const row = document.querySelector(`tr.invoice-row[data-idx="${idx}"]`);
  if (row) {
    row.classList.toggle('row-edited', line.priceEdited);
    row.querySelector('.line-total-cell').textContent = fmt(line.lineTotal);
    const inp = row.querySelector('.price-input');
    if (inp) {
      inp.value = line.unitPrice;
      inp.classList.toggle('price-edited', line.priceEdited);
    }
    row.querySelector('.reset-price-btn')?.classList.toggle('hidden', !line.priceEdited);
  }
}

function setLineQty(idx, val) {
  const line = state.cart[idx];
  if (!line) return;
  let q = Math.max(0, Math.round(Number(val) || 0));
  if (state.invoiceType === 'return') {
    const max = Number(line.maxQty ?? Infinity);
    q = Math.min(q, max);
    line.qty = q;
    recalcLine(line);
    updateCartRow(idx);
    renderCart();
    return;
  }
  if (state.invoiceType === 'issue') {
    q = Math.max(1, q);
    if (line.stockQty > 0 && q > line.stockQty) {
      toast(`المخزون لا يكفي (${line.stockQty} قطعة)`, 'warn');
      q = line.stockQty;
    }
    line.qty = q;
    if (!line.qty) {
      state.cart.splice(idx, 1);
      renderCart();
      return;
    }
    updateCartRow(idx);
    updateCartMeta();
    return;
  }
  if (line.stockQty > 0 && q + (line.giftQty || 0) > line.stockQty) {
    toast(`المخزون لا يكفي (${line.stockQty} قطعة)`, 'warn');
    q = Math.max(0, line.stockQty - (line.giftQty || 0));
  }
  line.qty = q;
  recalcLine(line);
  if (!line.qty && !line.giftQty) {
    state.cart.splice(idx, 1);
    renderCart();
    return;
  }
  updateCartRow(idx);
}

function resetLinePrice(idx) {
  const line = state.cart[idx];
  if (!line) return;
  line.unitPrice = line.originalPrice;
  recalcLine(line);
  renderCart();
  toast('تمت إعادة السعر الأصلي');
}

function bindCartTableEvents() {
  const wrap = document.querySelector('.invoice-table-wrap');
  if (!wrap || wrap._bound) return;
  wrap._bound = true;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (btn) {
      const idx = Number(btn.dataset.idx);
      const action = btn.dataset.action;
      const line = state.cart[idx];
      if (!line) return;
      if (action === 'inc') {
        if (state.invoiceType === 'return') {
          if (line.qty >= (line.maxQty ?? 0)) return;
        } else if (line.stockQty > 0 && line.qty + 1 + (line.giftQty || 0) > line.stockQty) {
          toast('المخزون لا يكفي', 'warn');
          return;
        }
        line.qty += 1;
      } else if (action === 'dec') {
        line.qty = Math.max(0, line.qty - 1);
        if (state.invoiceType === 'issue') {
          if (line.qty <= 0) {
            state.cart.splice(idx, 1);
            renderCart();
            return;
          }
        } else if (!line.qty && !line.giftQty) {
          state.cart.splice(idx, 1);
          renderCart();
          return;
        }
      } else if (action === 'del') {
        state.cart.splice(idx, 1);
        renderCart();
        return;
      }
      recalcLine(line);
      updateCartRow(idx);
      if (state.invoiceType === 'return') renderCart();
      return;
    }
    const resetBtn = e.target.closest('[data-reset-price]');
    if (resetBtn) resetLinePrice(Number(resetBtn.dataset.resetPrice));
    const giftBtn = e.target.closest('.gift-btn');
    if (giftBtn) {
      const idx = Number(giftBtn.dataset.idx);
      const line = state.cart[idx];
      if (!line) return;
      const action = giftBtn.dataset.action;
      if (action === 'inc') {
        if (line.stockQty > 0 && line.qty + (line.giftQty || 0) + 1 > line.stockQty) {
          toast('المخزون لا يكفي', 'warn');
          return;
        }
        setLineGiftQty(idx, (line.giftQty || 0) + 1);
      } else if (action === 'dec') {
        setLineGiftQty(idx, (line.giftQty || 0) - 1);
      }
    }
  });
  wrap.addEventListener('change', (e) => {
    if (e.target.classList.contains('price-input')) {
      setLinePrice(Number(e.target.dataset.idx), e.target.value);
    }
    if (e.target.classList.contains('qty-input')) {
      setLineQty(Number(e.target.dataset.idx), e.target.value);
    }
    if (e.target.classList.contains('gift-input')) {
      setLineGiftQty(Number(e.target.dataset.idx), e.target.value);
    }
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('price-input') && e.key === 'Enter') {
      e.preventDefault();
      setLinePrice(Number(e.target.dataset.idx), e.target.value);
      e.target.blur();
      focusBarcode();
    }
    if (e.target.classList.contains('qty-input') && e.key === 'Enter') {
      e.preventDefault();
      setLineQty(Number(e.target.dataset.idx), e.target.value);
      e.target.blur();
      focusBarcode();
    }
    if (e.target.classList.contains('gift-input') && e.key === 'Enter') {
      e.preventDefault();
      setLineGiftQty(Number(e.target.dataset.idx), e.target.value);
      e.target.blur();
      focusBarcode();
    }
  });
}

function updateCartMeta() {
  const countEl = document.getElementById('cartCount');
  const checkout = document.getElementById('btnCheckout');
  const saleQty = state.cart.reduce((s, l) => s + l.qty, 0);
  const giftQty = state.cart.reduce((s, l) => s + (l.giftQty || 0), 0);
  const totalPieces = saleQty + giftQty;
  const lines = state.cart.length;
  if (countEl) {
    countEl.textContent = giftQty
      ? `${saleQty} بيع + ${giftQty} هدية`
      : `${saleQty} قطعة · ${lines} بند`;
  }
  if (checkout) checkout.disabled = !lines || !totalPieces;
  const lineEl = document.getElementById('posLineCount');
  const itemEl = document.getElementById('posItemCount');
  if (lineEl) lineEl.textContent = lines;
  if (itemEl) itemEl.textContent = totalPieces;
}

function updateCartRow(idx) {
  const line = state.cart[idx];
  const row = document.querySelector(`tr.invoice-row[data-idx="${idx}"]`);
  if (!row || !line) { renderCart(); return; }
  row.classList.toggle('row-edited', line.priceEdited);
  row.classList.toggle('row-gift', (line.giftQty || 0) > 0);
  const qtyInp = row.querySelector('.qty-input');
  if (qtyInp) qtyInp.value = line.qty;
  const giftInp = row.querySelector('.gift-input');
  if (giftInp) giftInp.value = line.giftQty || 0;
  const totalCell = row.querySelector('.line-total-cell strong');
  if (totalCell) totalCell.textContent = fmt(line.lineTotal);
  updateCartTotals();
  updateCartMeta();
}

function renderCart() {
  if (state.cartRenderQueued) return;
  state.cartRenderQueued = true;
  requestAnimationFrame(() => {
    state.cartRenderQueued = false;
    renderCartNow();
  });
}

function renderCartNow() {
  const tbody = document.getElementById('cartLines');
  const empty = document.getElementById('cartEmpty');
  const countEl = document.getElementById('cartCount');
  const checkout = document.getElementById('btnCheckout');
  const type = state.invoiceType;
  const n = state.cart.reduce((s, l) => s + Number(l.qty || 0), 0);
  const lines = state.cart.length;
  if (countEl) countEl.textContent = `${n} قطعة · ${lines} بند`;

  if (!state.cart.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    checkout.disabled = true;
    const btnAmt = document.getElementById('checkoutBtnAmt');
    if (btnAmt) btnAmt.textContent = fmt(0);
    updateCartTotals();
    updatePageMeta();
    return;
  }
  empty.classList.add('hidden');

  if (type === 'issue') {
    checkout.disabled = false;
    tbody.innerHTML = state.cart.map((l, i) => `
      <tr class="invoice-row" data-idx="${i}">
        <td class="col-num">${i + 1}</td>
        <td class="col-name">
          <span class="line-name" title="${esc(l.name)}">${esc(l.name)}</span>
          <span class="line-barcode" dir="ltr">${esc(l.barcode)}</span>
        </td>
        <td class="col-qty">
          <div class="qty-controls">
            <button type="button" class="qty-btn" data-action="dec" data-idx="${i}">−</button>
            <input type="number" class="cell-input qty-input" data-idx="${i}" value="${l.qty}" min="1" title="كمية الإخراج">
            <button type="button" class="qty-btn" data-action="inc" data-idx="${i}">+</button>
          </div>
        </td>
        <td class="col-act">
          <button type="button" class="qty-btn del-btn" data-action="del" data-idx="${i}" title="حذف">×</button>
        </td>
      </tr>
    `).join('');
    updateCartTotals();
    updatePageMeta();
    return;
  }

  checkout.disabled = false;
  const allowPrice = getSettings().allowPriceEdit !== false;
  const isReturn = type === 'return';
  const linked = isReturn && !!state.returnParent;
  if (isReturn) {
    checkout.disabled = !lines || !n;
  }
  tbody.innerHTML = state.cart.map((l, i) => `
    <tr class="invoice-row${l.priceEdited ? ' row-edited' : ''}${l.giftQty ? ' row-gift' : ''}" data-idx="${i}">
      <td class="col-num">${i + 1}</td>
      <td class="col-name">
        <span class="line-name" title="${esc(l.name)}">${esc(l.name)}</span>
        <span class="line-barcode" dir="ltr">${esc(l.barcode)}</span>
        ${l.priceEdited || (!isReturn && l.giftQty) ? `<span class="line-tags">${l.priceEdited ? '<span class="edited-tag">معدّل</span>' : ''}${!isReturn && l.giftQty ? `<span class="gift-tag">هدية ${l.giftQty}</span>` : ''}</span>` : ''}
      </td>
      <td class="col-price">
        <div class="price-cell">
          <input type="number" class="cell-input price-input${l.priceEdited ? ' price-edited' : ''}"
            data-idx="${i}" value="${l.unitPrice}" min="0" step="1"
            title="السعر الأصلي: ${fmt(l.originalPrice)}" ${allowPrice ? '' : 'readonly'}>
          ${allowPrice ? `<button type="button" class="reset-price-btn${l.priceEdited ? '' : ' hidden'}" data-reset-price="${i}" title="إعادة السعر الأصلي">↺</button>` : ''}
        </div>
      </td>
      ${linked ? `<td class="col-stock inv-return-linked" dir="ltr">${l.maxQty ?? 0}</td>` : ''}
      <td class="col-qty">
        <div class="qty-controls">
          <button type="button" class="qty-btn" data-action="dec" data-idx="${i}">−</button>
          <input type="number" class="cell-input qty-input" data-idx="${i}" value="${l.qty}" min="${isReturn ? 0 : 0}"${linked ? ` max="${l.maxQty ?? 0}"` : ''} title="${isReturn ? 'كمية المرتجع' : 'الكمية المدفوعة'}">
          <button type="button" class="qty-btn" data-action="inc" data-idx="${i}">+</button>
        </div>
      </td>
      ${isReturn ? '' : `
      <td class="col-gift">
        <div class="gift-controls">
          <button type="button" class="gift-btn" data-action="dec" data-idx="${i}" title="تقليل الهدايا">−</button>
          <input type="number" class="gift-input" data-idx="${i}" value="${l.giftQty || 0}" min="0" title="هدايا">
          <button type="button" class="gift-btn" data-action="inc" data-idx="${i}" title="زيادة الهدايا">+</button>
        </div>
      </td>`}
      <td class="col-total line-total-cell" dir="ltr">${fmt(l.lineTotal)}</td>
      <td class="col-act">
        <button type="button" class="qty-btn del-btn" data-action="del" data-idx="${i}"${linked ? ' disabled' : ''} title="حذف">×</button>
      </td>
    </tr>
  `).join('');
  updateCartTotals();
  updatePageMeta();
}

document.getElementById('discountInput').addEventListener('input', updateCartTotals);

document.getElementById('btnClearCart').addEventListener('click', () => {
  if (!state.cart.length && !state.returnParent) return;
  if ((state.cart.length || state.returnParent) && !confirm('تفريغ الفاتورة الحالية؟')) return;
  if (state.invoiceType === 'return') {
    state.returnParent = null;
    document.getElementById('returnParentBanner')?.classList.add('hidden');
    document.getElementById('posReturnList')?.classList.remove('hidden');
    loadPosReturnCandidates();
  }
  state.cart = [];
  applyCustomer(null);
  state.discount = 0;
  document.getElementById('discountInput').value = '0';
  document.getElementById('issueReason') && (document.getElementById('issueReason').value = '');
  document.getElementById('lastScanPreview')?.classList.add('hidden');
  newPosSession();
  renderCart();
});

// ── Hold / resume ──
document.getElementById('btnHold').addEventListener('click', () => {
  if (state.invoiceType !== 'sale') { toast('التعليق متاح لمبيعات فقط', 'warn'); return; }
  if (!state.cart.length) { toast('السلة فارغة'); return; }
  const held = getHeld();
  held.push({
    id: newLocalId(),
    cart: [...state.cart],
    customer: state.customer,
    discount: state.discount,
    savedAt: new Date().toISOString(),
    label: state.cart[0]?.name || 'فاتورة'
  });
  saveHeld(held);
  state.cart = [];
  applyCustomer(null);
  state.discount = 0;
  document.getElementById('discountInput').value = '0';
  renderCart();
  toast('تم تعليق الفاتورة');
});

function loadHeldList() {
  const held = getHeld();
  const el = document.getElementById('heldList');
  const clearBtn = document.getElementById('btnClearHeld');
  if (clearBtn) clearBtn.hidden = !held.length;
  if (!held.length) {
    el.innerHTML = emptyState('لا توجد فواتير معلّقة', 'علّق الفاتورة من شاشة البيع بزر تعليق أو F6');
    return;
  }
  el.innerHTML = held.map((h, i) => {
    const total = h.cart.reduce((s, l) => s + l.lineTotal, 0);
    const edited = h.cart.filter((l) => l.priceEdited).length;
    const mins = Math.max(0, Math.round((Date.now() - new Date(h.savedAt).getTime()) / 60000));
    const age = mins < 60 ? `منذ ${mins} د` : `منذ ${Math.floor(mins / 60)} س`;
    return `
    <div class="held-card" data-idx="${i}">
      <div>
        <strong>${esc(h.label)}</strong>
        <span class="held-meta">${h.cart.length} بند · ${h.cart.reduce((s, l) => s + Number(l.qty || 0), 0)} قطعة${edited ? ` · ${edited} سعر معدّل` : ''}${h.customer ? ` · ${esc(h.customer.name)}` : ''}</span>
        <div class="held-time">${new Date(h.savedAt).toLocaleString('ar-IQ')} · ${age}</div>
      </div>
      <div class="held-actions">
        <span dir="ltr" class="held-amt">${fmt(total)}</span>
        <button type="button" class="btn btn-primary btn-sm" data-resume-held="${i}">استئناف</button>
        <button type="button" class="btn btn-sm btn-ghost" data-del-held="${i}">حذف</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.held-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.dataset.delHeld != null) {
        e.stopPropagation();
        const next = getHeld().filter((_, idx) => idx !== Number(e.target.dataset.delHeld));
        saveHeld(next);
        loadHeldList();
        return;
      }
      if (e.target.dataset.resumeHeld != null) e.stopPropagation();
      const idx = Number(card.dataset.idx);
      const item = getHeld()[idx];
      if (!item) return;
      if (state.cart.length && !confirm('استبدال الفاتورة الحالية بالمعلّقة؟')) return;
      state.cart = (item.cart || []).map((l) => ({
        ...l,
        originalPrice: l.originalPrice ?? l.unitPrice,
        priceEdited: l.priceEdited ?? false,
        giftQty: l.giftQty ?? 0
      }));
      applyCustomer(item.customer || null);
      state.discount = item.discount || 0;
      document.getElementById('discountInput').value = String(state.discount || 0);
      const rest = getHeld().filter((_, i) => i !== idx);
      saveHeld(rest);
      document.querySelector('.nav-item[data-view="pos"]:not([data-inv-type])')?.click();
      renderCart();
      toast('تم استئناف الفاتورة');
    });
  });
}

// ── Barcode ──
const barcodeInput = document.getElementById('barcodeInput');
barcodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = barcodeInput.value.trim();
    barcodeInput.value = '';
    if (code) addToCart(code);
    else focusBarcode();
  }
});

const productSearch = document.getElementById('productSearch');
productSearch.addEventListener('input', onProductSearchInput);

productSearch.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!state.searchResults.length) return;
    state.searchHighlight = Math.min(state.searchHighlight + 1, state.searchResults.length - 1);
    highlightSearchItem(state.searchHighlight);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.searchHighlight = Math.max(state.searchHighlight - 1, 0);
    highlightSearchItem(state.searchHighlight);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.searchResults.length) {
      pickSearchResult(state.searchHighlight);
    } else {
      const q = productSearch.value.trim();
      if (!q) return;
      searchProducts(q).then((results) => {
        if (results.length === 1) pickSearchResult(0);
        else if (results.length > 1) renderSearchDropdown(results);
        else toast('لا توجد نتائج للبحث', 'err');
      });
    }
  } else if (e.key === 'Escape') {
    hideSearchDropdown();
    productSearch.blur();
    focusBarcode();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) hideSearchDropdown();
});

let barcodeBuffer = '';
let barcodeTimer = null;
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !typing) {
    e.preventDefault();
    document.getElementById('keyboardHelpModal')?.showModal();
    return;
  }
  if (e.key === 'F1') {
    e.preventDefault();
    gotoView('dashboard');
    return;
  }
  if (e.key === 'F4') {
    e.preventDefault();
    gotoView('invoices');
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    gotoView('stock');
    return;
  }
  if (e.key === 'F7') {
    e.preventDefault();
    gotoView('payments');
    return;
  }
  if (e.key === 'F10') {
    e.preventDefault();
    gotoView('reports');
    return;
  }
  if (e.key === 'F11') {
    e.preventDefault();
    if (state.lastInvoiceId) printInvoice(state.lastInvoiceId);
    else toast('لا توجد فاتورة أخيرة للطباعة', 'warn');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openJump();
    return;
  }
  const posVisible = !document.getElementById('viewPos').classList.contains('hidden');
  if (e.key === 'Escape' && posVisible) {
    e.preventDefault();
    focusBarcode();
    return;
  }
  if (e.key === 'F9' && posVisible) {
    e.preventDefault();
    document.getElementById('btnPickCustomer')?.click();
    return;
  }
  if (!posVisible) return;
  if (e.key === 'F2') { e.preventDefault(); productSearch.focus(); productSearch.select(); return; }
  if (e.key === 'F3') { e.preventDefault(); document.getElementById('discountInput').focus(); document.getElementById('discountInput').select(); return; }
  if (e.key === 'F6') { e.preventDefault(); document.getElementById('btnHold').click(); return; }
  if (e.key === 'F8') { e.preventDefault(); if (!document.getElementById('btnCheckout').disabled) document.getElementById('btnCheckout').click(); return; }
  if (e.target === barcodeInput || e.target === productSearch) return;
  if (e.target.classList?.contains('price-input') || e.target.classList?.contains('qty-input')) return;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    barcodeBuffer += e.key;
    clearTimeout(barcodeTimer);
    barcodeTimer = setTimeout(() => {
      if (barcodeBuffer.length >= 4) {
        barcodeInput.value = '';
        addToCart(barcodeBuffer);
      }
      barcodeBuffer = '';
    }, 80);
  }
});

document.getElementById('productSearch').addEventListener('focus', () => {
  const q = document.getElementById('productSearch').value.trim();
  if (q) onProductSearchInput();
});

// ── Customer ──
document.getElementById('btnPickCustomer').addEventListener('click', async () => {
  await renderCustomerList();
  document.getElementById('customerModal').showModal();
});

async function renderCustomerList(q = '') {
  let accounts = [];
  try {
    const data = await api(`/branch/accounts?q=${encodeURIComponent(q)}`);
    accounts = data.accounts || [];
  } catch { toast('تعذّر تحميل الحسابات', 'err'); }
  document.getElementById('customerList').innerHTML = `
    <button type="button" class="picker-item" data-id="">💵 نقدي — بدون حساب</button>
    ${accounts.map((a) => `
      <button type="button" class="picker-item" data-id="${a.id}">
        <strong>${esc(a.name)}</strong>
        <span style="color:var(--text-muted);font-size:0.8rem"> · ${esc(a.code)} · دين: ${fmt(a.balance)}${a.creditLimit ? ` · حد: ${fmt(a.creditLimit)}` : ''}</span>
      </button>
    `).join('')}
  `;
  if (window._setCustomerAccounts) window._setCustomerAccounts(accounts);
}

document.getElementById('customerSearch').addEventListener('input', debounce((e) => {
  renderCustomerList(e.target.value);
}, 200));

document.getElementById('btnNewCustomer')?.addEventListener('click', () => {
  document.getElementById('newCustomerForm').classList.toggle('hidden');
});

document.getElementById('btnCreateCustomer')?.addEventListener('click', async () => {
  const name = document.getElementById('newCustomerName').value.trim();
  const phone = document.getElementById('newCustomerPhone').value.trim();
  if (!name) { toast('أدخل اسم العميل', 'warn'); return; }
  try {
    const account = await createAccountApi({ name, phone });
    applyCustomer(account);
    document.getElementById('newCustomerForm').classList.add('hidden');
    document.getElementById('newCustomerName').value = '';
    document.getElementById('newCustomerPhone').value = '';
    document.getElementById('customerModal').close();
    toast('تم إنشاء العميل');
    loadAccounts();
  } catch (err) { toast(err.message, 'err'); }
});

// ── Checkout ──
document.getElementById('btnCheckout').addEventListener('click', () => {
  if (state.invoiceType === 'return') {
    submitReturnFromPos().catch((err) => toast(err.message || 'فشل المرتجع', 'err'));
    return;
  }
  if (state.invoiceType === 'issue') {
    submitIssue().catch((err) => toast(err.message || 'فشل الإخراج', 'err'));
    return;
  }
  const subtotal = state.cart.reduce((s, l) => s + l.lineTotal, 0);
  const total = Math.max(0, subtotal - state.discount);
  document.getElementById('checkoutTotal').textContent = fmt(total);
  const linesEl = document.getElementById('checkoutLines');
  if (linesEl) {
    let extra = '';
    if (state.customer) {
      const debt = Number(state.customer.balance || 0);
      const limit = Number(state.customer.creditLimit || 0);
      const avail = limit > 0 ? Math.max(0, limit - debt) : null;
      extra = `<div class="checkout-line credit-info">
        <span>العميل: ${esc(state.customer.name)}</span>
        <span>دين: ${fmt(debt)}${avail != null ? ` · متاح: ${fmt(avail)}` : ''}</span>
      </div>`;
    }
    linesEl.innerHTML = extra + state.cart.map((l) => `
      <div class="checkout-line${l.priceEdited ? ' edited' : ''}${l.giftQty ? ' gift' : ''}">
        <span>${esc(l.name)} <small>${l.qty} بيع${l.giftQty ? ` + ${l.giftQty} هدية` : ''}</small></span>
        <span dir="ltr">${fmt(l.lineTotal)}${l.priceEdited ? ` <em>(${fmt(l.unitPrice)})</em>` : ''}</span>
      </div>
    `).join('') + (state.discount > 0
      ? `<div class="checkout-line discount"><span>خصم</span><span dir="ltr">−${fmt(state.discount)}</span></div>`
      : '');
  }
  if (state.checkoutMethod === 'partial') {
    const paidEl = document.getElementById('paidNow');
    if (!paidEl.value || Number(paidEl.value) >= total) paidEl.value = Math.round(total / 2) || '';
  }
  document.getElementById('checkoutModal').showModal();
});

document.querySelectorAll('.pay-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pay-card').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.checkoutMethod = btn.dataset.method;
    document.getElementById('partialFields').classList.toggle('hidden', state.checkoutMethod !== 'partial');
    if (state.checkoutMethod === 'partial') {
      const total = Math.max(0, state.cart.reduce((s, l) => s + l.lineTotal, 0) - state.discount);
      document.getElementById('paidNow').value = Math.round(total / 2) || '';
    }
  });
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog')?.close());
});

document.getElementById('btnConfirmSale')?.addEventListener('click', () => {
  submitSale().catch((err) => toast(err.message || 'فشل إتمام البيع', 'err'));
});

function checkoutGrand() {
  return Math.max(0, state.cart.reduce((s, l) => s + l.lineTotal, 0) - state.discount);
}

document.getElementById('btnPaidHalf')?.addEventListener('click', () => {
  document.getElementById('paidNow').value = Math.round(checkoutGrand() / 2) || 0;
});
document.getElementById('btnPaidAll')?.addEventListener('click', () => {
  document.getElementById('paidNow').value = checkoutGrand();
});

document.getElementById('checkoutModal')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA') return;
  if (e.target.id === 'checkoutNotes') return;
  e.preventDefault();
  document.getElementById('btnConfirmSale')?.click();
});

function printHtml(html) {
  const clean = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, '<title> </title>');

  if (printHtml._blobUrl) {
    try { URL.revokeObjectURL(printHtml._blobUrl); } catch {}
    printHtml._blobUrl = null;
  }

  let frame = document.getElementById('printFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'printFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
  }

  const runPrint = () => {
    const win = frame.contentWindow;
    const doc = win?.document;
    if (!win || !doc) return;
    try {
      doc.title = ' ';
      win.focus();
      win.print();
    } catch {
      toast('تعذّر فتح نافذة الطباعة', 'err');
    }
  };

  frame.onload = () => setTimeout(runPrint, 400);
  frame.removeAttribute('srcdoc');
  printHtml._blobUrl = URL.createObjectURL(new Blob([clean], { type: 'text/html;charset=utf-8' }));
  frame.src = printHtml._blobUrl;
}

async function submitIssue() {
  const confirmBtn = document.getElementById('btnCheckout');
  const notes = document.getElementById('issueReason')?.value?.trim() || '';
  if (!notes) { toast('اكتب سبب الإخراج', 'err'); document.getElementById('issueReason')?.focus(); return; }
  if (!state.cart.length) { toast('أضف منتجاً واحداً على الأقل', 'err'); return; }

  try {
    if (confirmBtn) confirmBtn.disabled = true;
    const payload = withLocalStamp({
      kind: 'issue',
      localId: newLocalId(),
      lines: state.cart.map((l) => ({
        productId: l.productId, barcode: l.barcode, name: l.name,
        qty: l.qty, giftQty: 0, unitPrice: 0, lineTotal: 0
      })),
      discount: 0,
      paymentMethod: 'issue',
      paidAmount: 0,
      notes
    };
    const data = await api('/branch/invoices', { method: 'POST', body: JSON.stringify(payload) });
    toast(`✓ تم الإخراج — ${data.invoice.invoiceNo}`);
    state.lastInvoiceId = data.invoice.id;
    localStorage.setItem(LAST_INV_KEY, String(data.invoice.id));
    updateReprintHeader();
    state.cart = [];
    document.getElementById('issueReason').value = '';
    newPosSession();
    renderCart();
    printInvoice(data.invoice.id);
    loadTodaySummary();
    loadProducts();
    bustViewCache('dashboard', 'invoices', 'stock');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function submitReturnFromPos() {
  const confirmBtn = document.getElementById('btnCheckout');
  if (!state.cart.length) { toast('أضف منتجاً واحداً على الأقل', 'err'); return; }
  const lines = state.cart.filter((l) => Number(l.qty) > 0).map((l) => ({
    productId: l.productId,
    barcode: l.barcode,
    name: l.name,
    qty: Number(l.qty),
    giftQty: 0,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
    priceEdited: !!l.priceEdited,
    originalPrice: l.originalPrice
  }));
  if (!lines.length) { toast('حدد كميات المرتجع', 'err'); return; }

  const payload = withLocalStamp({
    accountId: state.customer?.id || null,
    customerName: state.customer?.name || '',
    discount: state.discount,
    notes: state.returnParent ? `مرتجع عن ${state.returnParent.invoiceNo}` : ''
  };

  try {
    if (confirmBtn) confirmBtn.disabled = true;
    let data;
    if (state.returnParent) {
      data = await api(`/branch/invoices/${state.returnParent.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          lines: lines.map((l) => ({ barcode: l.barcode, qty: l.qty })),
          ...payload
        })
      });
    } else {
      data = await api('/branch/invoices', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'return',
          localId: newLocalId(),
          lines,
          ...payload,
          paymentMethod: state.customer ? 'credit' : 'cash',
          paidAmount: 0
        })
      });
    }
    toast(`✓ تم المرتجع — ${data.invoice.invoiceNo}${state.customer ? ' · خُصم من الدين' : ''}`);
    state.lastInvoiceId = data.invoice.id;
    localStorage.setItem(LAST_INV_KEY, String(data.invoice.id));
    updateReprintHeader();
    setInvoiceType('return', { force: true });
    printInvoice(data.invoice.id);
    loadTodaySummary();
    loadProducts();
    loadAccounts();
    bustViewCache('dashboard', 'invoices', 'accounts');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function loadPosReturnCandidates() {
  const q = document.getElementById('posReturnSearch')?.value || '';
  const today = isoDay();
  const fromEl = document.getElementById('posReturnDateFrom');
  const toEl = document.getElementById('posReturnDateTo');
  if (fromEl && !fromEl.value) fromEl.value = today;
  if (toEl && !toEl.value) toEl.value = today;
  const from = fromEl?.value || today;
  const to = toEl?.value || today;
  const list = document.getElementById('posReturnList');
  if (!list) return;
  try {
    const data = await api(`/branch/invoices?kind=sale&from=${from}&to=${to}&q=${encodeURIComponent(q)}&limit=40`);
    const invs = data.invoices || [];
    if (!invs.length) {
      list.innerHTML = '<p class="hint">لا توجد فواتير مبيعات مطابقة</p>';
      return;
    }
    list.innerHTML = invs.map((i) => `
      <button type="button" class="return-picker-card" data-id="${i.id}">
        <div>
          <strong>${esc(i.invoiceNo)}</strong>
          <div style="font-size:0.78rem;color:var(--text-muted)">${esc(i.customerName || 'نقدي')} · ${esc(i.invoiceDate)}</div>
        </div>
        <span dir="ltr" style="font-weight:800;color:var(--primary-dark)">${fmt(i.total)}</span>
      </button>
    `).join('');
    list.querySelectorAll('.return-picker-card').forEach((card) => {
      card.addEventListener('click', () => selectReturnParent(Number(card.dataset.id)));
    });
  } catch {
    list.innerHTML = '<p class="hint">تعذّر تحميل الفواتير</p>';
  }
}

async function selectReturnParent(id) {
  try {
    const data = await api(`/branch/invoices/${id}`);
    const inv = data.invoice;
    if (!inv || inv.kind !== 'sale') { toast('فاتورة غير صالحة للمرتجع', 'err'); return; }
    state.returnParent = inv;
    if (inv.accountId && inv.accountName) {
      applyCustomer({ id: inv.accountId, name: inv.accountName, code: '', balance: 0 });
      api(`/branch/accounts/${inv.accountId}`).then((d) => {
        if (d.account) {
          applyCustomer(d.account);
          updateReturnCustomerHint();
        }
      }).catch(() => {});
    }
    state.cart = inv.lines.map((l) => ({
      productId: l.productId,
      barcode: l.barcode,
      name: l.name,
      qty: 0,
      soldQty: l.qty,
      giftQty: 0,
      maxQty: Number(l.qty || 0) + Number(l.giftQty || 0),
      unitPrice: l.unitPrice,
      originalPrice: l.originalPrice ?? l.unitPrice,
      priceEdited: false,
      stockQty: 0,
      lineTotal: 0
    }));
    document.getElementById('viewPos')?.classList.add('linked-return');
    document.getElementById('viewPos')?.classList.remove('show-return-link');
    const banner = document.getElementById('returnParentBanner');
    const label = document.getElementById('returnParentLabel');
    if (label) label.textContent = `${inv.invoiceNo} — ${inv.customerName || 'نقدي'} — ${fmt(inv.total)}`;
    banner?.classList.remove('hidden');
    document.getElementById('posReturnPanel')?.classList.add('hidden');
    renderCart();
    toast('حدّد كميات المرتجع — يمكنك اختيار عميل لخصم الدين');
  } catch (err) { toast(err.message || 'تعذّر تحميل الفاتورة', 'err'); }
}

document.getElementById('btnClearReturnParent')?.addEventListener('click', () => {
  state.returnParent = null;
  state.cart = [];
  document.getElementById('returnParentBanner')?.classList.add('hidden');
  document.getElementById('viewPos')?.classList.remove('linked-return');
  renderCart();
});

document.getElementById('btnShowReturnLink')?.addEventListener('click', () => {
  document.getElementById('viewPos')?.classList.add('show-return-link');
  loadPosReturnCandidates();
});

document.getElementById('btnHideReturnLink')?.addEventListener('click', () => {
  document.getElementById('viewPos')?.classList.remove('show-return-link');
});

document.getElementById('posReturnSearch')?.addEventListener('input', debounce(loadPosReturnCandidates, 300));
document.getElementById('posReturnDateFrom')?.addEventListener('change', loadPosReturnCandidates);
document.getElementById('posReturnDateTo')?.addEventListener('change', loadPosReturnCandidates);

async function submitSale() {
  const confirmBtn = document.getElementById('btnConfirmSale');
  if (confirmBtn?.disabled) return;

  try {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'جاري الحفظ...';
    }

    const subtotal = state.cart.reduce((s, l) => s + l.lineTotal, 0);
    const total = Math.max(0, subtotal - state.discount);
    let paymentMethod = 'cash';
    let paidAmount = total;
    let accountId = null;

    if (state.checkoutMethod === 'credit') {
      if (!state.customer) { toast('اختر حساباً للبيع الآجل', 'err'); return; }
      paymentMethod = 'credit';
      paidAmount = 0;
      accountId = state.customer.id;
    } else if (state.checkoutMethod === 'partial') {
      if (!state.customer) { toast('اختر حساباً للبيع الجزئي', 'err'); return; }
      paymentMethod = 'partial';
      paidAmount = Number(document.getElementById('paidNow').value || 0);
      accountId = state.customer.id;
    }

    const payload = withLocalStamp({
      localId: newLocalId(),
      lines: state.cart.map((l) => ({
        productId: l.productId, barcode: l.barcode, name: l.name,
        qty: l.qty, giftQty: l.giftQty || 0, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
        priceEdited: !!l.priceEdited, originalPrice: l.originalPrice
      })),
      discount: state.discount,
      paymentMethod, paidAmount, accountId,
      customerName: state.customer?.name || '',
      notes: document.getElementById('checkoutNotes').value || '',
      prepFromWarehouse: !!document.getElementById('prepFromWarehouse')?.checked
    };

    const clearCart = () => {
      state.cart = [];
      applyCustomer(null);
      state.discount = 0;
      document.getElementById('discountInput').value = '0';
      document.getElementById('checkoutNotes').value = '';
      const prepBox = document.getElementById('prepFromWarehouse');
      if (prepBox) prepBox.checked = false;
      document.getElementById('lastScanPreview')?.classList.add('hidden');
      newPosSession();
      renderCart();
      focusBarcode();
    };

    try {
      const data = await api('/branch/invoices', { method: 'POST', body: JSON.stringify(payload) });
      if (!data.invoice?.id) throw new Error('لم يُرجع السيرفر رقم الفاتورة');
      const prepNote = data.invoice.prepMode === 'warehouse'
        ? (data.invoice.prepOrderNo ? ` · تجهيز ${data.invoice.prepOrderNo}` : ' · طلب تجهيز')
        : '';
      toast(`✓ تم البيع — ${data.invoice.invoiceNo}${prepNote}`);
      if (data.invoice.prepMode === 'warehouse' && data.invoice.prepStatus && data.invoice.prepStatus !== 'submitted') {
        toast(`تحذير: لم يصل طلب التجهيز لموظف المخزن — ${data.invoice.prepError || data.invoice.prepStatus}`, 'warn');
      }
      state.lastInvoiceId = data.invoice.id;
      localStorage.setItem(LAST_INV_KEY, String(data.invoice.id));
      updateReprintHeader();
      document.getElementById('checkoutModal').close();
      clearCart();
      printInvoice(data.invoice.id);
      loadTodaySummary();
      loadProducts();
      bustViewCache('dashboard', 'invoices', 'accounts');
    } catch (err) {
      if (navigator.onLine) throw err;
      const outbox = getOutbox();
      outbox.push({ ...payload, syncStatus: 'pending' });
      saveOutbox(outbox);
      updateSyncPill();
      toast('حُفظت محلياً — ستُرفع عند الاتصال', 'warn');
      document.getElementById('checkoutModal').close();
      clearCart();
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'تأكيد وطباعة';
    }
  }
}

async function flushOutbox() {
  const outbox = getOutbox();
  if (!outbox.length || !navigator.onLine) return;
  const remaining = [];
  for (const inv of outbox) {
    try {
      const data = await api('/branch/invoices', { method: 'POST', body: JSON.stringify(inv) });
      if (data.invoice?.id) printInvoice(data.invoice.id);
    } catch { remaining.push(inv); }
  }
  saveOutbox(remaining);
  updateSyncPill();
  if (outbox.length && !remaining.length) toast('تم رفع الفواتير المعلّقة');
}

// ── Dashboard ──
function renderBranchHourlyChart(el, invoices) {
  if (!el) return;
  const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, amount: 0, count: 0 }));
  (invoices || []).forEach((inv) => {
    if (inv.kind !== 'sale') return;
    const h = Number(String(inv.createdAt || '').slice(11, 13));
    if (!Number.isNaN(h) && hours[h]) {
      hours[h].amount += Number(inv.total || 0);
      hours[h].count += 1;
    }
  });
  const maxAmt = Math.max(...hours.map((h) => h.amount), 1);
  el.innerHTML = `<div class="hourly-bars">${hours.map((h) => `
    <div class="hourly-bar-col" title="${h.hour}:00 — ${h.count} · ${fmt(h.amount)}">
      <i style="height:${Math.max(4, Math.round(h.amount / maxAmt * 100))}%"></i>
      <span class="hour-lbl">${h.hour}</span>
    </div>`).join('')}</div>`;
}

function renderBranchPaymentBars(el, byPayment) {
  if (!el) return;
  const maxAmt = Math.max(...(byPayment || []).map((p) => p.amount), 1);
  el.innerHTML = (byPayment || []).length
    ? (byPayment || []).map((p) => `
      <div class="pay-bar-item">
        <i style="height:${Math.max(8, Math.round(p.amount / maxAmt * 100))}%"></i>
        <b dir="ltr">${fmt(p.amount)}</b>
        <span>${payLabel(p.method)}</span>
      </div>`).join('')
    : '<p class="hint">لا توجد مبيعات اليوم</p>';
}

async function loadDashboard() {
  const today = isoDay();
  try {
    const [sumData, invData, repData, allInvData] = await Promise.all([
      api('/branch/summary/today'),
      api(`/branch/invoices?from=${today}&limit=8`),
      api(`/branch/reports/sales?from=${today}&to=${today}`),
      api(`/branch/invoices?from=${today}&limit=300`)
    ]);
    const s = sumData.summary;
    const r = repData.report || {};
    document.getElementById('dashboardKpis').innerHTML = `
      <div class="kpi-card clickable" data-goto="invoices"><div class="kpi-lbl">فواتير البيع</div><div class="kpi-val">${s.salesCount}</div></div>
      <div class="kpi-card clickable" data-goto="invoices"><div class="kpi-lbl">إجمالي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(s.salesAmount)}</div></div>
      <div class="kpi-card danger clickable" data-goto="pos" data-inv-type="return"><div class="kpi-lbl">المرتجعات</div><div class="kpi-val" dir="ltr">${fmt(s.returnsAmount)}</div></div>
      <div class="kpi-card highlight clickable" data-goto="reports"><div class="kpi-lbl">صافي اليوم</div><div class="kpi-val" dir="ltr">${fmt(s.netSales)}</div></div>
      <div class="kpi-card clickable" data-goto="payments"><div class="kpi-lbl">نقدي محصّل</div><div class="kpi-val" dir="ltr">${fmt(s.paidAmount)}</div></div>
      <div class="kpi-card clickable" data-goto="accounts"><div class="kpi-lbl">آجل / دين جديد</div><div class="kpi-val" dir="ltr">${fmt(s.dueAmount)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">متوسط الفاتورة</div><div class="kpi-val" dir="ltr">${fmt(s.salesCount ? s.salesAmount / s.salesCount : 0)}</div></div>
      <div class="kpi-card clickable" data-goto="held"><div class="kpi-lbl">فواتير معلّقة</div><div class="kpi-val">${getHeld().length}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">بانتظار الرفع</div><div class="kpi-val">${getOutbox().length}</div></div>`;
    const stamp = document.getElementById('dashUpdated');
    if (stamp) stamp.textContent = `آخر تحديث ${new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById('dashboardDetail').innerHTML = `
      <div class="dash-row"><span>تاريخ</span><strong>${esc(s.date)}</strong></div>
      <div class="dash-row"><span>عدد المرتجعات</span><strong>${s.returnsCount}</strong></div>
      <div class="dash-row"><span>بانتظار الرفع</span><strong>${getOutbox().length}</strong></div>
      ${getOutbox().length ? `<div class="dash-row"><button type="button" class="btn btn-secondary btn-sm" id="btnFlushOutbox">رفع الفواتير المعلّقة الآن</button></div>` : ''}
      <div class="dash-row"><span>منتجات محمّلة</span><strong>${allProducts().length}</strong></div>
      <div class="dash-row"><span>نسخة الأسعار</span><strong>v${state.priceVersion}</strong></div>
      <div class="dash-row"><span>إصدار التطبيق</span><strong>v${APP_VERSION}</strong></div>
      ${state.lastInvoiceId ? `<div class="dash-row"><button type="button" class="btn btn-secondary btn-sm" id="btnReprintLast">إعادة طباعة آخر فاتورة</button></div>` : ''}
    `;
    renderBranchPaymentBars(document.getElementById('dashboardPayments'), r.byPayment);
    renderBranchHourlyChart(document.getElementById('dashboardHourly'), allInvData.invoices || []);
    document.getElementById('btnReprintLast')?.addEventListener('click', () => printInvoice(state.lastInvoiceId));
    document.getElementById('btnFlushOutbox')?.addEventListener('click', async () => {
      await flushOutbox();
      loadDashboard();
    });
    const recent = invData.invoices || [];
    const recentEl = document.getElementById('dashboardRecent');
    if (recentEl) {
      recentEl.innerHTML = recent.length
        ? recent.map((i) => `
          <div class="invoice-card mini" data-id="${i.id}">
            <div>
              <strong>${esc(i.invoiceNo)}</strong>
              <span class="kind-badge ${kindBadgeClass(i.kind)}">${kindLabel(i.kind)}</span>
              <div class="inv-meta">${esc(i.customerName || 'نقدي')} · ${payLabel(i.paymentMethod)}</div>
            </div>
            <div dir="ltr" class="inv-amt">${fmt(i.total)}</div>
          </div>`).join('')
        : '<p class="hint">لا توجد فواتير اليوم بعد</p>';
      recentEl.querySelectorAll('.invoice-card[data-id]').forEach((card) => {
        card.addEventListener('click', () => openInvoiceModal(Number(card.dataset.id)));
      });
    }
    updateDayStatsDisplay(s.salesCount, s.netSales);
  } catch { toast('تعذّر تحميل الملخص', 'err'); }
}

async function loadTodaySummary() {
  try {
    const data = await api('/branch/summary/today');
    const s = data.summary;
    updateDayStatsDisplay(s.salesCount, s.netSales);
  } catch { /* */ }
}

const stockState = { loading: false, lastProduct: null };

function getStockRecent() {
  try { return JSON.parse(localStorage.getItem(STOCK_RECENT_KEY) || '[]'); } catch { return []; }
}

function pushStockRecent(product) {
  if (!product?.barcode) return;
  const list = getStockRecent().filter((p) => p.barcode !== product.barcode);
  list.unshift({
    barcode: product.barcode,
    name: product.name,
    stockQty: product.stockQty,
    price: product.price,
    at: Date.now()
  });
  localStorage.setItem(STOCK_RECENT_KEY, JSON.stringify(list.slice(0, 12)));
  renderStockRecentList();
}

function renderStockRecentList() {
  const el = document.getElementById('stockRecentList');
  if (!el) return;
  const list = getStockRecent();
  el.innerHTML = list.length
    ? list.map((p) => `
      <button type="button" class="stock-recent-item" data-barcode="${esc(p.barcode)}">
        <strong>${esc(p.name)}</strong>
        <small dir="ltr">${esc(p.barcode)} · ${fmt(p.stockQty)} · ${fmt(p.price)}</small>
      </button>`).join('')
    : '<p class="hint">لا توجد استعلامات سابقة</p>';
  el.querySelectorAll('[data-barcode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('stockBarcodeInput');
      if (input) input.value = btn.dataset.barcode;
      lookupStockProduct(btn.dataset.barcode);
    });
  });
}

async function loadLowStockList() {
  const el = document.getElementById('stockLowList');
  if (!el) return;
  try {
    const threshold = getSettings().lowStockThreshold || 5;
    const data = await api(`/branch/products/low-stock?threshold=${threshold}`);
    const products = data.products || [];
    el.innerHTML = products.length
      ? products.slice(0, 20).map((p) => {
        const st = stockStatusOf(p.stockQty, threshold);
        return `<button type="button" class="stock-low-item ${st.cls}" data-barcode="${esc(p.barcode)}">
          <span class="stock-status ${st.cls}">${st.label}</span>
          <strong>${esc(p.name)}</strong>
          <small dir="ltr">${esc(p.barcode)} · ${fmt(p.stockQty)}</small>
        </button>`;
      }).join('')
      : '<p class="hint">لا يوجد مخزون منخفض</p>';
    el.querySelectorAll('[data-barcode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('stockBarcodeInput');
        if (input) input.value = btn.dataset.barcode;
        lookupStockProduct(btn.dataset.barcode);
      });
    });
  } catch {
    el.innerHTML = '<p class="hint">تعذّر تحميل القائمة</p>';
  }
}

function stockStatusOf(qty, threshold) {
  const n = Number(qty) || 0;
  if (n <= 0) return { key: 'out', label: 'نافد', cls: 'st-out' };
  if (n <= threshold) return { key: 'low', label: 'منخفض', cls: 'st-low' };
  return { key: 'in', label: 'متوفر', cls: 'st-ok' };
}

function renderStockProductDetail(product) {
  const wrap = document.getElementById('stockProductDetail');
  if (!wrap) return;
  if (!product) {
    wrap.innerHTML = `
      <div class="stock-lookup-empty" id="stockLookupEmpty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <p>امسح باركود المنتج لعرض التفاصيل</p>
      </div>`;
    return;
  }
  const threshold = getSettings().lowStockThreshold || 5;
  const st = stockStatusOf(product.stockQty, threshold);
  wrap.innerHTML = `
    <article class="stock-detail-card">
      <header class="stock-detail-head">
        <div>
          <span class="stock-status ${st.cls}">${st.label}</span>
          ${product.category ? `<span class="stock-detail-cat">${esc(product.category)}</span>` : ''}
        </div>
        <span class="stock-detail-price" dir="ltr">${fmt(product.price)}</span>
      </header>
      <h3 class="stock-detail-name">${esc(product.name)}</h3>
      <div class="stock-detail-grid">
        <div class="stock-detail-item">
          <span class="lbl">الباركود</span>
          <strong dir="ltr">${esc(product.barcode)}</strong>
        </div>
        ${product.sku ? `<div class="stock-detail-item"><span class="lbl">SKU</span><strong dir="ltr">${esc(product.sku)}</strong></div>` : ''}
        <div class="stock-detail-item">
          <span class="lbl">المخزون</span>
          <strong dir="ltr" class="stock-qty-val">${fmt(product.stockQty)} ${esc(product.unit || 'قطعة')}</strong>
        </div>
        <div class="stock-detail-item">
          <span class="lbl">سعر التكلفة</span>
          <strong dir="ltr">${fmt(product.costPrice || 0)}</strong>
        </div>
        <div class="stock-detail-item">
          <span class="lbl">الوحدة</span>
          <strong>${esc(product.unit || 'قطعة')}</strong>
        </div>
        <div class="stock-detail-item">
          <span class="lbl">آخر تحديث</span>
          <strong>${product.updatedAt ? new Date(product.updatedAt).toLocaleString('ar-IQ') : '—'}</strong>
        </div>
      </div>
      ${product.hasOffer ? `<div class="stock-detail-offer">عرض: ${esc(product.offerName || 'خاص')} — كان <span dir="ltr">${fmt(product.originalPrice)}</span></div>` : ''}
      <div class="stock-detail-actions">
        <button type="button" class="btn btn-primary btn-sm" id="btnStockAddToCart">إضافة للفاتورة</button>
        <button type="button" class="btn btn-secondary btn-sm" id="btnStockRefresh">تحديث من السيرفر</button>
      </div>
    </article>`;
  document.getElementById('btnStockAddToCart')?.addEventListener('click', async () => {
    await addToCart(product.barcode, 1);
    gotoView('pos');
  });
  document.getElementById('btnStockRefresh')?.addEventListener('click', () => lookupStockProduct(product.barcode, true));
}

async function lookupStockProduct(code, force = false) {
  const c = String(code || '').trim();
  if (!c) {
    renderStockProductDetail(null);
    return;
  }
  if (stockState.loading && !force) return;
  stockState.loading = true;
  try {
    let product = null;
    try {
      const data = await api(`/branch/products/barcode/${encodeURIComponent(c)}`);
      product = data.product;
    } catch {
      product = await fetchProductFromAdmin(c);
    }
    if (!product) {
      renderStockProductDetail(null);
      toast('المنتج غير موجود', 'warn');
      return;
    }
    stockState.lastProduct = product;
    mergeProductIntoState(product);
    renderStockProductDetail(product);
  } catch {
    toast('تعذّر جلب المنتج', 'err');
  } finally {
    stockState.loading = false;
  }
}

function loadStockView() {
  if (stockState.lastProduct) renderStockProductDetail(stockState.lastProduct);
  else renderStockProductDetail(null);
  setTimeout(() => document.getElementById('stockBarcodeInput')?.focus(), 80);
}

function bindStockFilters() {
  const input = document.getElementById('stockBarcodeInput');
  const lookup = () => lookupStockProduct(input?.value);

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      lookup();
    }
  });

  document.getElementById('btnStockLookup')?.addEventListener('click', lookup);
  document.getElementById('btnStockClear')?.addEventListener('click', () => {
    stockState.lastProduct = null;
    if (input) input.value = '';
    renderStockProductDetail(null);
    input?.focus();
  });
}

bindStockFilters();

async function checkDataRevision() {
  try {
    const data = await api('/branch/data-revision');
    const rev = Number(data.revision || 0);
    const stored = Number(localStorage.getItem(DATA_REV_KEY) || 0);
    if (rev > stored) {
      localStorage.setItem(DATA_REV_KEY, String(rev));
      bustViewCache('dashboard', 'invoices', 'accounts', 'payments', 'stock');
      state.productsDirty = true;
      await loadProducts();
      if (stockState.lastProduct?.barcode) {
        lookupStockProduct(stockState.lastProduct.barcode, true);
      }
      const active = document.querySelector('.nav-item.active')?.dataset.view;
      if (active === 'invoices') loadInvoices();
      if (active === 'accounts') loadAccounts();
      if (active === 'payments') loadPaymentsView();
      if (active === 'dashboard') loadDashboard();
      if (active === 'stock') loadStockView();
    } else if (!stored && rev) {
      localStorage.setItem(DATA_REV_KEY, String(rev));
    }
  } catch { /* */ }
}

function initReportDates() {
  const today = isoDay();
  const from = document.getElementById('reportFrom');
  const to = document.getElementById('reportTo');
  if (from && !from.value) from.value = today;
  if (to && !to.value) to.value = today;
}

async function loadReportsView() {
  initReportDates();
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  try {
    const data = await api(`/branch/reports/sales?from=${from}&to=${to}`);
    const r = data.report;
    state.lastReport = r;
    document.getElementById('reportBody').innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-lbl">فواتير البيع</div><div class="kpi-val">${r.salesCount}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">إجمالي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(r.salesAmount)}</div></div>
        <div class="kpi-card danger"><div class="kpi-lbl">المرتجعات (${r.returnsCount || 0})</div><div class="kpi-val" dir="ltr">${fmt(r.returnsAmount)}</div></div>
        <div class="kpi-card highlight"><div class="kpi-lbl">صافي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(r.netSales)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">المحصّل نقداً</div><div class="kpi-val" dir="ltr">${fmt(r.paidAmount)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">تحصيلات حسابات</div><div class="kpi-val" dir="ltr">${fmt(r.collectionsTotal)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">ديون جديدة</div><div class="kpi-val" dir="ltr">${fmt(r.dueAmount)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">متوسط الفاتورة</div><div class="kpi-val" dir="ltr">${fmt(r.salesCount ? r.salesAmount / r.salesCount : 0)}</div></div>
      </div>
      <div class="report-panels">
        <div class="panel-card">
          <h3>حسب طريقة الدفع</h3>
          <table class="data-table">
            <thead><tr><th>الطريقة</th><th>عدد</th><th>المبلغ</th></tr></thead>
            <tbody>${(r.byPayment || []).length ? r.byPayment.map((p) => `
              <tr><td>${payLabel(p.method)}</td><td>${p.count}</td><td dir="ltr">${fmt(p.amount)}</td></tr>
            `).join('') : '<tr><td colspan="3">لا توجد بيانات</td></tr>'}</tbody>
          </table>
        </div>
        <div class="panel-card">
          <h3>أكثر المنتجات مبيعاً</h3>
          <table class="data-table">
            <thead><tr><th>المنتج</th><th>كمية</th><th>مبيعات</th></tr></thead>
            <tbody>${(r.topProducts || []).length ? r.topProducts.map((p) => `
              <tr><td>${esc(p.name)}</td><td>${p.qty}</td><td dir="ltr">${fmt(p.amount)}</td></tr>
            `).join('') : '<tr><td colspan="3">لا توجد بيانات</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  } catch { toast('تعذّر تحميل التقرير', 'err'); }
}

document.getElementById('btnLoadReport')?.addEventListener('click', loadReportsView);
document.getElementById('reportPresetChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-report-range]');
  if (!chip) return;
  const [from, to] = rangeForPreset(chip.dataset.reportRange);
  if (document.getElementById('reportFrom')) document.getElementById('reportFrom').value = from;
  if (document.getElementById('reportTo')) document.getElementById('reportTo').value = to;
  document.getElementById('reportPresetChips').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
  loadReportsView();
});
document.getElementById('btnExportReport')?.addEventListener('click', () => {
  const r = state.lastReport;
  if (!r) { toast('اعرض التقرير أولاً', 'warn'); return; }
  downloadCsv(`تقرير-${r.dateFrom}-${r.dateTo}.csv`, [
    ['من', r.dateFrom, 'إلى', r.dateTo],
    ['فواتير البيع', r.salesCount, 'إجمالي', r.salesAmount],
    ['مرتجعات', r.returnsCount, 'قيمة', r.returnsAmount],
    ['صافي', r.netSales, 'محصّل', r.paidAmount],
    ['تحصيلات', r.collectionsTotal, 'ديون جديدة', r.dueAmount],
    [],
    ['المنتج', 'كمية', 'مبيعات'],
    ...(r.topProducts || []).map((p) => [p.name, p.qty, p.amount])
  ]);
});
document.getElementById('btnPrintReport')?.addEventListener('click', () => {
  const el = document.getElementById('reportBody');
  const from = document.getElementById('reportFrom')?.value || '';
  const to = document.getElementById('reportTo')?.value || '';
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير الفرع</title>
    <style>
      body{font-family:Tahoma,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:1.1rem} table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ddd;padding:6px 8px;text-align:right;font-size:0.85rem}
      .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
      .kpi-card{border:1px solid #ddd;padding:10px;border-radius:8px}
      .kpi-val{font-size:1.2rem;font-weight:800}
    </style></head><body>
    <h1>ديما الحياة — تقرير الفرع</h1>
    <p>${esc(from)} إلى ${esc(to)}</p>
    ${el.innerHTML}</body></html>`);
  w.document.close();
  w.print();
});

function loadSettingsView() {
  const s = getSettings();
  document.getElementById('setLowStock').value = s.lowStockThreshold ?? 5;
  document.getElementById('setBlockZero').checked = !!s.blockZeroStock;
  document.getElementById('setBlockOver').checked = s.blockOverStock !== false;
  document.getElementById('setAllowPrice').checked = s.allowPriceEdit !== false;
  document.getElementById('setScanSound') && (document.getElementById('setScanSound').checked = s.scanSound !== false);
  document.getElementById('setThermal').checked = !!s.thermalPrint;
  document.getElementById('setReceiptFooter').value = s.receiptFooter || '';
  const verEl = document.getElementById('setAppVersion');
  const priceEl = document.getElementById('setPriceVersion');
  const revEl = document.getElementById('setDataRevision');
  const connEl = document.getElementById('setConnStatus');
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
  if (priceEl) priceEl.textContent = `v${state.priceVersion}`;
  if (revEl) revEl.textContent = localStorage.getItem(DATA_REV_KEY) || '—';
  if (connEl) connEl.textContent = navigator.onLine ? 'متصل' : 'غير متصل';
  renderOutboxList();
}

function renderOutboxList() {
  const el = document.getElementById('outboxList');
  if (!el) return;
  const items = getOutbox();
  el.innerHTML = items.length
    ? items.map((inv, i) => `<div class="outbox-item">${i + 1}. ${esc(inv.customerName || 'نقدي')} · ${fmt((inv.lines || []).reduce((s, l) => s + Number(l.lineTotal || 0), 0))} · ${esc((inv.createdAt || '').slice(0, 16))}</div>`).join('')
    : '<p class="hint">لا توجد فواتير معلّقة للرفع</p>';
}

document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
  const patch = {
    lowStockThreshold: Number(document.getElementById('setLowStock').value || 5),
    blockZeroStock: document.getElementById('setBlockZero').checked,
    blockOverStock: document.getElementById('setBlockOver').checked,
    allowPriceEdit: document.getElementById('setAllowPrice').checked,
    scanSound: document.getElementById('setScanSound')?.checked !== false,
    thermalPrint: document.getElementById('setThermal').checked,
    receiptFooter: document.getElementById('setReceiptFooter').value || ''
  };
  try {
    const data = await api('/branch/settings', { method: 'PUT', body: JSON.stringify(patch) });
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    saveLocalSettings(state.settings);
    toast('تم حفظ الإعدادات');
  } catch (err) { toast(err.message, 'err'); }
});

// ── Invoices ──
async function loadInvoices() {
  const q = document.getElementById('invoiceSearch')?.value || '';
  const today = isoDay();
  const from = document.getElementById('invoiceFrom')?.value || document.getElementById('invoiceDate')?.value || today;
  const to = document.getElementById('invoiceTo')?.value || from;
  if (document.getElementById('invoiceFrom') && !document.getElementById('invoiceFrom').value) {
    document.getElementById('invoiceFrom').value = from;
    document.getElementById('invoiceTo').value = to;
  }
  if (document.getElementById('invoiceDate')) document.getElementById('invoiceDate').value = from;
  const kind = document.getElementById('invoiceKind')?.value || '';
  const payment = document.getElementById('invoicePayment')?.value || '';
  try {
    const params = new URLSearchParams({ q, from, to, limit: '200' });
    if (kind) params.set('kind', kind);
    if (payment) params.set('payment', payment);
    const data = await api(`/branch/invoices?${params}`);
    state.lastInvoices = data.invoices || [];
    const countEl = document.getElementById('invoiceResultCount');
    if (countEl) countEl.textContent = `${data.total ?? state.lastInvoices.length} فاتورة`;
    renderInvoiceList(document.getElementById('invoiceList'), state.lastInvoices);
  } catch { toast('تعذّر تحميل الفواتير', 'err'); }
}

function renderInvoiceList(el, invs, { returnMode = false } = {}) {
  if (!invs.length) {
    el.innerHTML = emptyState('لا توجد فواتير', 'جرّب تغيير التاريخ أو البحث');
    return;
  }
  el.innerHTML = `
    <table class="data-table invoices-table">
      <thead><tr>
        <th>الوقت</th><th>الرقم</th><th>النوع</th><th>العميل</th><th>الدفع</th><th>المدفوع</th><th>الإجمالي</th>
      </tr></thead>
      <tbody>${invs.map((i) => `
        <tr class="click-row${i.kind === 'return' ? ' kind-return' : i.kind === 'issue' ? ' kind-issue' : ''}" data-id="${i.id}">
          <td>${esc((i.createdAt || '').slice(11, 16) || i.invoiceDate)}</td>
          <td><strong>${esc(i.invoiceNo)}</strong></td>
          <td><span class="kind-badge ${kindBadgeClass(i.kind)}">${kindLabel(i.kind)}</span></td>
          <td>${esc(i.customerName || (i.kind === 'issue' ? '—' : 'نقدي'))}</td>
          <td>${payLabel(i.paymentMethod, i)}</td>
          <td dir="ltr">${i.kind === 'issue' ? '—' : fmt(i.paidAmount)}</td>
          <td dir="ltr" class="inv-amt ${i.kind === 'return' ? 'neg' : ''}">${i.kind === 'issue' ? '—' : fmt(i.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-id]').forEach((row) => {
    row.addEventListener('click', () => openInvoiceModal(Number(row.dataset.id), returnMode));
  });
}

async function loadReturnCandidates() {
  const q = document.getElementById('returnSearch')?.value || '';
  const today = isoDay();
  const from = document.getElementById('returnDateFrom')?.value || today;
  const to = document.getElementById('returnDateTo')?.value || today;
  if (document.getElementById('returnDateFrom') && !document.getElementById('returnDateFrom').value) {
    document.getElementById('returnDateFrom').value = today;
    document.getElementById('returnDateTo').value = today;
  }
  try {
    const data = await api(`/branch/invoices?kind=sale&from=${from}&to=${to}&q=${encodeURIComponent(q)}&limit=80`);
    renderInvoiceList(document.getElementById('returnList'), data.invoices || [], { returnMode: true });
  } catch { toast('تعذّر التحميل', 'err'); }
}

document.getElementById('returnDateFrom')?.addEventListener('change', loadReturnCandidates);
document.getElementById('returnDateTo')?.addEventListener('change', loadReturnCandidates);

document.getElementById('returnSearch')?.addEventListener('input', () => {
  clearTimeout(document.getElementById('returnSearch')._t);
  document.getElementById('returnSearch')._t = setTimeout(loadReturnCandidates, 300);
});

document.getElementById('invoiceSearch').addEventListener('input', () => {
  clearTimeout(document.getElementById('invoiceSearch')._t);
  document.getElementById('invoiceSearch')._t = setTimeout(loadInvoices, 300);
});
document.getElementById('invoiceDate')?.addEventListener('change', loadInvoices);
document.getElementById('invoiceFrom')?.addEventListener('change', loadInvoices);
document.getElementById('invoiceTo')?.addEventListener('change', loadInvoices);
document.getElementById('invoiceKind')?.addEventListener('change', loadInvoices);
document.getElementById('invoicePayment')?.addEventListener('change', loadInvoices);
document.getElementById('btnResetInvFilters')?.addEventListener('click', () => {
  const [from, to] = rangeForPreset('today');
  const search = document.getElementById('invoiceSearch');
  if (search) search.value = '';
  if (document.getElementById('invoiceFrom')) document.getElementById('invoiceFrom').value = from;
  if (document.getElementById('invoiceTo')) document.getElementById('invoiceTo').value = to;
  if (document.getElementById('invoiceKind')) document.getElementById('invoiceKind').value = '';
  if (document.getElementById('invoicePayment')) document.getElementById('invoicePayment').value = '';
  document.getElementById('invPresetChips')?.querySelectorAll('.filter-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.invRange === 'today');
  });
  loadInvoices();
});
document.getElementById('btnExportInvoices')?.addEventListener('click', () => {
  const invs = state.lastInvoices || [];
  if (!invs.length) { toast('لا توجد فواتير للتصدير', 'warn'); return; }
  downloadCsv(`فواتير-${isoDay()}.csv`, [
    ['الرقم', 'التاريخ', 'الوقت', 'النوع', 'العميل', 'الدفع', 'المدفوع', 'الإجمالي'],
    ...invs.map((i) => [
      i.invoiceNo, i.invoiceDate, (i.createdAt || '').slice(11, 16),
      kindLabel(i.kind), i.customerName || '', payLabel(i.paymentMethod, i),
      i.paidAmount, i.kind === 'issue' ? '' : i.total
    ])
  ]);
});
document.getElementById('invPresetChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-inv-range]');
  if (!chip) return;
  const [from, to] = rangeForPreset(chip.dataset.invRange);
  if (document.getElementById('invoiceFrom')) document.getElementById('invoiceFrom').value = from;
  if (document.getElementById('invoiceTo')) document.getElementById('invoiceTo').value = to;
  document.getElementById('invPresetChips').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
  loadInvoices();
});

// ── Invoice modal ──
async function openInvoiceModal(id, returnMode = false) {
  try {
    const data = await api(`/branch/invoices/${id}`);
    state.activeInvoice = data.invoice;
    state.returnMode = returnMode;
    const inv = data.invoice;
    document.getElementById('invoiceModalTitle').textContent =
      returnMode ? `مرتجع — ${inv.invoiceNo}` : inv.invoiceNo;
    document.getElementById('invoiceModalBody').innerHTML = `
      <div class="inv-detail-meta inv-meta-grid">
        <div><b>العميل:</b> ${esc(inv.customerName || 'نقدي')}</div>
        <div><b>التاريخ:</b> ${esc(inv.invoiceDate)} · <b>الوقت:</b> ${esc((inv.createdAt || '').slice(11, 16) || '—')}</div>
        <div><b>النوع:</b> ${kindLabel(inv.kind)} · <b>الدفع:</b> ${payLabel(inv.paymentMethod, inv)}</div>
        <div><b>الصافي:</b> <strong dir="ltr">${fmt(inv.total)}</strong>${inv.kind !== 'issue' ? ` · <b>مدفوع:</b> <span dir="ltr">${fmt(inv.paidAmount)}</span> · <b>متبقي:</b> <span dir="ltr">${fmt(inv.dueAmount)}</span>` : ''}</div>
        ${inv.cashierName || inv.createdByName ? `<div><b>الكاشير:</b> ${esc(inv.cashierName || inv.createdByName)}</div>` : ''}
        ${inv.notes ? `<div><b>ملاحظات:</b> ${esc(inv.notes)}</div>` : ''}
      </div>
      <table class="inv-detail-table">
        <thead><tr><th>المنتج</th><th>بيع</th><th>هدايا</th><th>${returnMode ? 'مرتجع' : 'الإجمالي'}</th></tr></thead>
        <tbody>${inv.lines.map((l) => `
          <tr>
            <td>${esc(l.name)}<br><small dir="ltr" style="color:var(--text-muted)">${esc(l.barcode)}</small></td>
            <td dir="ltr">${l.qty}</td>
            <td dir="ltr">${l.giftQty || 0}</td>
            <td>${returnMode
    ? `<input type="number" class="return-qty" min="0" max="${l.qty + (l.giftQty || 0)}" value="0" data-barcode="${esc(l.barcode)}">`
    : `<span dir="ltr">${fmt(l.lineTotal)}</span>`}</td>
          </tr>`).join('')}</tbody>
      </table>
    `;
    const isSale = inv.kind === 'sale';
    document.getElementById('btnReturnAll').classList.toggle('hidden', returnMode || !isSale);
    document.getElementById('btnStartReturn').classList.toggle('hidden', returnMode || !isSale);
    document.getElementById('btnConfirmReturn').classList.toggle('hidden', !returnMode);
    document.getElementById('btnFillReturnQty')?.classList.toggle('hidden', !returnMode);
    document.getElementById('btnRepeatInvoice')?.classList.toggle('hidden', returnMode || !isSale);
    document.getElementById('invoiceModal').showModal();
  } catch (err) { toast(err.message, 'err'); }
}

function printInvoice(id) {
  if (!id) {
    toast('لا توجد فاتورة للطباعة', 'err');
    return;
  }
  const thermal = getSettings().thermalPrint ? '?thermal=1' : '';
  fetch(`/api/branch/invoices/${id}/print${thermal}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  })
    .then(async (r) => {
      if (!r.ok) {
        const msg = await r.text().catch(() => '');
        throw new Error(msg || 'فشل جلب الفاتورة للطباعة');
      }
      return r.text();
    })
    .then((html) => printHtml(html))
    .catch((err) => toast(err.message || 'تعذّر الطباعة', 'err'));
}

document.getElementById('btnPrintInvoice').addEventListener('click', () => {
  if (state.activeInvoice) printInvoice(state.activeInvoice.id);
});

document.getElementById('btnFillReturnQty')?.addEventListener('click', () => {
  document.querySelectorAll('.return-qty').forEach((inp) => {
    inp.value = inp.max || inp.value;
  });
});

document.getElementById('btnRepeatInvoice')?.addEventListener('click', () => {
  const inv = state.activeInvoice;
  if (!inv || inv.kind !== 'sale') return;
  if (state.cart.length && !confirm('استبدال الفاتورة الحالية بهذه البنود؟')) return;
  document.getElementById('invoiceModal').close();
  const lines = (inv.lines || []).map((l) => {
    const qty = Number(l.qty || 0);
    const price = Number(l.unitPrice || 0);
    return {
      productId: l.productId,
      barcode: l.barcode,
      name: l.name,
      qty,
      giftQty: Number(l.giftQty || 0),
      unitPrice: price,
      originalPrice: Number(l.originalPrice ?? price),
      priceEdited: !!l.priceEdited,
      stockQty: 0,
      lineTotal: qty * price
    };
  });
  const discount = Number(inv.discount || 0);
  const accountId = inv.accountId;
  const customerName = inv.customerName;
  gotoView('pos');
  setInvoiceType('sale', { force: true });
  state.cart = lines;
  state.discount = discount;
  document.getElementById('discountInput').value = String(discount || 0);
  if (accountId) {
    api(`/branch/accounts/${accountId}`).then((d) => applyCustomer(d.account)).catch(() => {
      applyCustomer({ id: accountId, name: customerName, code: '', balance: 0 });
    });
  } else {
    applyCustomer(null);
  }
  renderCart();
  toast('تم تحميل بنود الفاتورة — راجع ثم أتمم البيع');
});

document.getElementById('btnStartReturn').addEventListener('click', () => {
  if (!state.activeInvoice) return;
  document.getElementById('invoiceModal').close();
  openInvoiceModal(state.activeInvoice.id, true);
});

document.getElementById('btnReturnAll').addEventListener('click', async () => {
  if (!state.activeInvoice) return;
  if (!confirm('مرتجع كامل لكل بنود الفاتورة؟')) return;
  const lines = state.activeInvoice.lines.map((l) => ({ barcode: l.barcode, qty: l.qty }));
  try {
    const data = await api(`/branch/invoices/${state.activeInvoice.id}/return`, {
      body: JSON.stringify(withLocalStamp({ lines }))
    });
    toast(`تم المرتجع — ${data.invoice.invoiceNo}`);
    document.getElementById('invoiceModal').close();
    printInvoice(data.invoice.id);
    loadTodaySummary();
    loadProducts();
  } catch (err) { toast(err.message, 'err'); }
});

document.getElementById('btnConfirmReturn').addEventListener('click', async () => {
  if (!state.activeInvoice) return;
  const lines = [...document.querySelectorAll('.return-qty')]
    .map((inp) => ({ barcode: inp.dataset.barcode, qty: Number(inp.value || 0) }))
    .filter((l) => l.qty > 0);
  if (!lines.length) { toast('حدد كمية المرتجع', 'warn'); return; }
  try {
    const data = await api(`/branch/invoices/${state.activeInvoice.id}/return`, {
      body: JSON.stringify(withLocalStamp({ lines }))
    });
    toast(`تم المرتجع — ${data.invoice.invoiceNo}`);
    document.getElementById('invoiceModal').close();
    printInvoice(data.invoice.id);
    loadTodaySummary();
    loadProducts();
  } catch (err) { toast(err.message, 'err'); }
});

// ── Accounts ──
async function createAccountApi(payload) {
  const data = await api('/branch/accounts', { method: 'POST', body: JSON.stringify(payload) });
  return data.account;
}

function clearAddAccountForm() {
  document.getElementById('accNewName').value = '';
  document.getElementById('accNewPhone').value = '';
  document.getElementById('accNewAddress').value = '';
  document.getElementById('accNewCredit').value = '0';
  document.getElementById('accNewNotes').value = '';
}

document.getElementById('btnAddAccount')?.addEventListener('click', async () => {
  const name = document.getElementById('accNewName').value.trim();
  const result = document.getElementById('addAccountResult');
  if (!name) { toast('أدخل اسم الحساب', 'warn'); return; }
  try {
    const account = await createAccountApi({
      name,
      phone: document.getElementById('accNewPhone').value.trim(),
      address: document.getElementById('accNewAddress').value.trim(),
      creditLimit: Number(document.getElementById('accNewCredit').value || 0),
      notes: document.getElementById('accNewNotes').value.trim()
    });
    result.textContent = `تم الإنشاء — الرمز: ${account.code}`;
    result.classList.remove('hidden');
    clearAddAccountForm();
    toast(`تم إنشاء الحساب ${account.name}`);
    loadAccounts();
  } catch (err) {
    toast(err.message, 'err');
  }
});

async function loadAccounts() {
  const q = document.getElementById('accountSearch').value || '';
  const debt = document.getElementById('debtOnly').checked;
  try {
    const data = await api(`/branch/accounts?q=${encodeURIComponent(q)}${debt ? '&debt=1' : ''}`);
    const list = data.accounts || [];
    const debtSum = list.reduce((s, a) => s + Number(a.balance || 0), 0);
    const countEl = document.getElementById('accountResultCount');
    if (countEl) countEl.textContent = `${list.length} حساب · دين ${fmt(debtSum)}`;
    const grid = document.getElementById('accountGrid');
    grid.innerHTML = list.length ? list.map((a) => `
      <div class="account-card${Number(a.balance) > 0 ? ' has-debt' : ''}" data-id="${a.id}">
        <div class="name">${esc(a.name)}</div>
        <div class="code">${esc(a.code)}${a.phone ? ` · ${esc(a.phone)}` : ''}</div>
        <div class="debt" dir="ltr">${fmt(a.balance)}</div>
        ${Number(a.balance) > 0 ? `<button type="button" class="btn btn-sm btn-secondary acc-pay-btn" data-pay="${a.id}">تسديد</button>` : ''}
      </div>
    `).join('') : emptyState('لا توجد حسابات', 'أضف حساباً من النموذج أو ألغِ فلتر المدينين');
    grid.querySelectorAll('.account-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const payBtn = e.target.closest('[data-pay]');
        if (payBtn) {
          e.stopPropagation();
          state.pendingPayAccountId = Number(payBtn.dataset.pay);
          gotoView('payments');
          return;
        }
        openAccountModal(Number(card.dataset.id));
      });
    });
  } catch { toast('تعذّر تحميل الحسابات', 'err'); }
}

async function openAccountModal(id) {
  try {
    const data = await api(`/branch/accounts/${id}/ledger`);
    state.activeAccount = data.account;
    document.getElementById('accountModalTitle').textContent = `كشف — ${data.account.name}`;
    const journal = data.journal || [];
    const payments = data.payments || [];
    document.getElementById('accountModalBody').innerHTML = `
      <div class="inv-detail-meta">
        <div><b>الرمز:</b> ${esc(data.account.code)} · <b>الهاتف:</b> ${esc(data.account.phone || '—')}</div>
        <div><b>الرصيد / الدين:</b> <strong dir="ltr" style="color:var(--danger)">${fmt(data.account.balance)}</strong></div>
      </div>
      <h4 style="margin:14px 0 8px;font-size:0.9rem">آخر الحركات</h4>
      <table class="data-table">
        <thead><tr><th>الوصف</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
        <tbody>${journal.length ? journal.map((j) => `
          <tr>
            <td>${esc(j.description)}</td>
            <td dir="ltr" style="color:${j.amount < 0 ? 'var(--success)' : 'var(--danger)'}">${fmt(j.amount)}</td>
            <td>${esc(j.entryDate)}</td>
          </tr>`).join('') : '<tr><td colspan="3">لا توجد حركات</td></tr>'}
        </tbody>
      </table>
      <h4 style="margin:14px 0 8px;font-size:0.9rem">التسديدات</h4>
      <table class="data-table">
        <thead><tr><th>الرقم</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
        <tbody>${payments.length ? payments.map((p) => `
          <tr><td>${esc(p.paymentNo)}</td><td dir="ltr">${fmt(p.amount)}</td><td>${esc(p.paymentDate)}</td></tr>
        `).join('') : '<tr><td colspan="3">لا توجد تسديدات</td></tr>'}
        </tbody>
      </table>
    `;
    document.getElementById('accountModal').showModal();
  } catch (err) { toast(err.message, 'err'); }
}

document.getElementById('btnPayFromAccount').addEventListener('click', () => {
  if (!state.activeAccount) return;
  document.getElementById('accountModal').close();
  state.pendingPayAccountId = state.activeAccount.id;
  gotoView('payments');
});

document.getElementById('btnPrintLedger')?.addEventListener('click', () => {
  const body = document.getElementById('accountModalBody');
  if (!body) return;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب</title>
    <style>body{font-family:Tahoma,sans-serif;padding:24px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}</style>
    </head><body><h1>${esc(document.getElementById('accountModalTitle')?.textContent || 'كشف حساب')}</h1>${body.innerHTML}</body></html>`);
  w.document.close();
  w.print();
});

document.getElementById('accountSearch').addEventListener('input', () => {
  clearTimeout(document.getElementById('accountSearch')._t);
  document.getElementById('accountSearch')._t = setTimeout(loadAccounts, 300);
});
document.getElementById('debtOnly').addEventListener('change', loadAccounts);
document.getElementById('paySearch')?.addEventListener('input', () => {
  clearTimeout(document.getElementById('paySearch')._t);
  document.getElementById('paySearch')._t = setTimeout(loadPaymentsView, 250);
});
document.getElementById('payFrom')?.addEventListener('change', loadPaymentsView);
document.getElementById('payTo')?.addEventListener('change', loadPaymentsView);
document.getElementById('btnClearHeld')?.addEventListener('click', () => {
  if (!getHeld().length) return;
  if (!confirm('حذف كل الفواتير المعلّقة من هذا الجهاز؟')) return;
  saveHeld([]);
  loadHeldList();
  toast('تم تفريغ المعلّق');
});

function updatePayBalanceHint() {
  const sel = document.getElementById('payAccount');
  const hint = document.getElementById('payBalanceHint');
  if (!sel || !hint) return;
  const opt = sel.selectedOptions[0];
  const bal = Number(opt?.dataset.balance || 0);
  hint.textContent = opt ? `الدين الحالي: ${fmt(bal)}` : 'اختر حساباً لعرض الدين';
}

function fillPayDebt() {
  const sel = document.getElementById('payAccount');
  const opt = sel?.selectedOptions[0];
  const bal = Number(opt?.dataset.balance || 0);
  if (bal <= 0) { toast('لا يوجد دين على هذا الحساب', 'warn'); return; }
  document.getElementById('payAmount').value = bal;
}

document.getElementById('payAccount')?.addEventListener('change', updatePayBalanceHint);
document.getElementById('btnPayFillDebt')?.addEventListener('click', fillPayDebt);

// ── Payments ──
async function loadPaymentsView() {
  try {
    const today = isoDay();
    const fromEl = document.getElementById('payFrom');
    const toEl = document.getElementById('payTo');
    if (fromEl && !fromEl.value) fromEl.value = today;
    if (toEl && !toEl.value) toEl.value = today;
    const from = fromEl?.value || today;
    const to = toEl?.value || today;
    const [accData, payData] = await Promise.all([
      api('/branch/accounts'),
      api(`/branch/payments?from=${from}&to=${to}&limit=200`)
    ]);
    const sel = document.getElementById('payAccount');
    const accounts = (accData.accounts || []).sort((a, b) => b.balance - a.balance);
    sel.innerHTML = accounts.map((a) =>
      `<option value="${a.id}" data-balance="${Number(a.balance) || 0}">${esc(a.name)} — دين: ${fmt(a.balance)}</option>`
    ).join('');
    if (state.pendingPayAccountId) {
      sel.value = String(state.pendingPayAccountId);
      state.pendingPayAccountId = null;
      updatePayBalanceHint();
      fillPayDebt();
      document.getElementById('payAmount')?.focus();
    } else {
      updatePayBalanceHint();
    }
    const pays = payData.payments || [];
    const q = (document.getElementById('paySearch')?.value || '').trim().toLowerCase();
    const filtered = q
      ? pays.filter((p) => String(p.paymentNo || '').toLowerCase().includes(q) || String(p.accountName || '').toLowerCase().includes(q))
      : pays;
    const todayTotal = filtered.reduce((s, p) => s + Number(p.amount || 0), 0);
    document.getElementById('paymentsList').innerHTML = `
      <div class="pay-summary">إجمالي المعروض: <strong dir="ltr">${fmt(todayTotal)}</strong> (${filtered.length})</div>
      ${filtered.length ? `
      <table class="data-table">
        <thead><tr><th>الرقم</th><th>الحساب</th><th>الطريقة</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
        <tbody>${filtered.map((p) => `
          <tr>
            <td>${esc(p.paymentNo)}</td>
            <td>${esc(p.accountName)}</td>
            <td>${esc(p.method === 'transfer' ? 'تحويل' : p.method === 'check' ? 'شيك' : 'نقدي')}</td>
            <td dir="ltr">${fmt(p.amount)}</td>
            <td>${esc(p.paymentDate)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : emptyState('لا توجد تسديدات', 'سجّل دفعة من النموذج أو غيّر البحث')}`;
  } catch { /* */ }
}

document.getElementById('btnSubmitPayment').addEventListener('click', async () => {
  const accountId = Number(document.getElementById('payAccount').value);
  const amount = Number(document.getElementById('payAmount').value);
  const result = document.getElementById('payResult');
  if (!amount || amount <= 0) { toast('أدخل مبلغاً صحيحاً', 'warn'); return; }
  try {
    const data = await api('/branch/payments', {
      method: 'POST',
      body: JSON.stringify({
        accountId, amount,
        method: document.getElementById('payMethod').value,
        notes: document.getElementById('payNotes').value
      })
    });
    result.textContent = `تم التسديد — الرصيد المتبقي: ${fmt(data.payment.balanceAfter)}`;
    result.classList.remove('hidden');
    document.getElementById('payAmount').value = '';
    document.getElementById('payNotes').value = '';
    toast('تم تسجيل التسديد');
    loadPaymentsView();
    loadTodaySummary();
  } catch (err) { toast(err.message, 'err'); }
});

// ── Price updates ──
async function checkPriceUpdate() {
  try {
    const data = await api(`/branch/price-update?version=${state.priceVersion}`);
    if (data.hasUpdate) {
      document.getElementById('priceBanner').classList.remove('hidden');
      document.getElementById('priceBanner').dataset.version = data.version;
    }
  } catch { /* */ }
}

document.getElementById('btnApplyPrices').addEventListener('click', async () => {
  const ver = Number(document.getElementById('priceBanner').dataset.version);
  try {
    await api('/branch/prices/apply', { method: 'POST', body: JSON.stringify({ version: ver }) });
    state.priceVersion = ver;
    localStorage.setItem(PRICE_VER_KEY, String(ver));
    document.getElementById('priceBanner').classList.add('hidden');
    await loadProducts();
    toast('تم تطبيق تحديث الأسعار');
  } catch (err) { toast(err.message, 'err'); }
});

document.getElementById('btnDismissPrices').addEventListener('click', () => {
  document.getElementById('priceBanner').classList.add('hidden');
});

document.getElementById('btnKeyboardHelp')?.addEventListener('click', () => {
  document.getElementById('keyboardHelpModal')?.showModal();
});

document.getElementById('btnSyncProducts')?.addEventListener('click', syncAllProductsFromAdmin);
document.getElementById('btnFlushOutboxSettings')?.addEventListener('click', async () => {
  await flushOutbox();
  renderOutboxList();
});
document.getElementById('btnFetchBarcode')?.addEventListener('click', fetchBarcodeFromAdmin);

// ── Init ──
async function initApp() {
  setPageTitle('pos');
  setPosMode(true);
  newPosSession();
  tickClock();
  setInterval(tickClock, 30000);
  updateHeldBadge();
  bindCartTableEvents();
  document.getElementById('searchDropdown')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.search-item');
    if (btn) pickSearchResult(Number(btn.dataset.idx));
  });
  let customerAccounts = [];
  document.getElementById('customerList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.picker-item');
    if (!btn) return;
    const id = btn.dataset.id ? Number(btn.dataset.id) : null;
    if (!id) applyCustomer(null);
    else applyCustomer(customerAccounts.find((a) => a.id === id) || null);
    document.getElementById('customerModal').close();
    updateReturnCustomerHint();
  });
  window._setCustomerAccounts = (list) => { customerAccounts = list; };
  updateReprintHeader();
  await loadSettings();
  await loadProducts();
  updateCachedProductCount();
  renderCart();
  loadTodaySummary();
  checkPriceUpdate();
  flushOutbox();
  setInterval(flushOutbox, 30000);
  setInterval(checkPriceUpdate, 60000);
  setInterval(checkDataRevision, 30000);
  try {
    const hb = await api('/branch/heartbeat', { method: 'POST' });
    if (hb.revision != null) {
      const rev = Number(hb.revision);
      const stored = Number(localStorage.getItem(DATA_REV_KEY) || 0);
      if (!stored) localStorage.setItem(DATA_REV_KEY, String(rev));
    }
    checkDataRevision();
  } catch { /* */ }
}

window.addEventListener('online', () => {
  state.online = true;
  updateSyncPill();
  flushOutbox();
  loadProducts();
});

window.addEventListener('offline', () => {
  state.online = false;
  updateSyncPill();
});

loadSession();
if (state.token) {
  validateSession().then((ok) => {
    if (ok) {
      showApp();
      initApp();
    }
  });
}
