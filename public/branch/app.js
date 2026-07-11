const API = '/api';
const STORAGE_KEY = 'shorja_branch';
const CACHE_KEY = 'shorja_products_cache';
const OUTBOX_KEY = 'shorja_outbox';
const HELD_KEY = 'shorja_held';
const PRICE_VER_KEY = 'shorja_price_version';
const LAST_INV_KEY = 'shorja_last_invoice';

const SETTINGS_KEY = 'shorja_branch_settings';

const DEFAULT_SETTINGS = {
  lowStockThreshold: 5,
  blockZeroStock: false,
  blockOverStock: true,
  allowPriceEdit: true,
  receiptFooter: 'شكراً لزيارتكم — ديما الحياة',
  thermalPrint: false
};

const PAGE_TITLES = {
  pos: ['نقطة البيع', 'مسح · بحث · بيع سريع'],
  dashboard: ['ملخص اليوم', 'إحصائيات مبيعات الفرع'],
  invoices: ['الفواتير', 'سجل المبيعات والمرتجعات'],
  returns: ['مرتجع مبيعات', 'إرجاع كامل أو جزئي'],
  held: ['فواتير معلّقة', 'استئناف البيع المحفوظ'],
  accounts: ['حسابات العملاء', 'الديون والأرصدة'],
  payments: ['تسديد الحسابات', 'تسجيل دفعات العملاء'],
  stock: ['المخزون', 'كل المنتجات · فلاتر وبحث'],
  reports: ['التقارير', 'مبيعات وتحصيلات حسب الفترة'],
  settings: ['الإعدادات', 'تخصيص سلوك نقطة البيع والطباعة']
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
  priceVersion: 0,
  online: navigator.onLine,
  activeInvoice: null,
  returnMode: false,
  activeAccount: null,
  lastInvoiceId: null,
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
  if (method === 'partial') return 'جزئي';
  if (method === 'credit') return 'آجل';
  if (inv && inv.paidAmount > 0 && inv.dueAmount > 0) return 'جزئي';
  return 'نقدي';
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

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
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
  el.innerHTML = `
    <span class="scan-check">✓</span>
    <div class="scan-info">
      <strong>${esc(product.name)}</strong>
      <span>باركود: ${esc(product.barcode)} · كمية: ${qty}</span>
    </div>
    <span class="scan-price" dir="ltr">${fmt(product.price)}</span>`;
  el.classList.remove('hidden');
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
  focusBarcode();
}

function focusBarcode() {
  setTimeout(() => document.getElementById('barcodeInput')?.focus(), 100);
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
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value
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
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const view = btn.dataset.view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const el = document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`);
  if (el) el.classList.remove('hidden');
  setPosMode(view === 'pos');
  setPageTitle(view);
  const loaders = {
    pos: () => focusBarcode(),
    dashboard: loadDashboard,
    invoices: loadInvoices,
    returns: loadReturnCandidates,
    held: loadHeldList,
    accounts: loadAccounts,
    payments: loadPaymentsView,
    stock: loadStockView,
    reports: () => { initReportDates(); loadReportsView(); },
    settings: loadSettingsView
  };
  loaders[view]?.();
});

document.getElementById('dashboardActions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (!btn) return;
  const nav = document.querySelector(`[data-view="${btn.dataset.goto}"]`);
  if (nav) nav.click();
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
  const newQty = (existing?.qty || 0) + qty;
  const totalPieces = newQty + (existing?.giftQty || 0);
  if (product.stockQty > 0 && totalPieces > product.stockQty) {
    if (getSettings().blockOverStock) {
      toast(`المخزون المتاح ${product.stockQty} قطعة فقط`, 'warn');
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
  document.getElementById('barcodeInput').value = '';
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
        if (line.stockQty > 0 && line.qty + 1 + (line.giftQty || 0) > line.stockQty) {
          toast('المخزون لا يكفي', 'warn');
          return;
        }
        line.qty += 1;
      } else if (action === 'dec') {
        line.qty = Math.max(0, line.qty - 1);
        if (!line.qty && !line.giftQty) {
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
  const n = state.cart.reduce((s, l) => s + l.qty, 0);
  const lines = state.cart.length;
  if (countEl) countEl.textContent = `${n} قطعة · ${lines} بند`;

  if (!state.cart.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    checkout.disabled = true;
    const btnAmt = document.getElementById('checkoutBtnAmt');
    if (btnAmt) btnAmt.textContent = fmt(0);
    updateCartTotals();
    return;
  }
  empty.classList.add('hidden');
  checkout.disabled = false;
  const allowPrice = getSettings().allowPriceEdit !== false;
  tbody.innerHTML = state.cart.map((l, i) => `
    <tr class="invoice-row${l.priceEdited ? ' row-edited' : ''}${l.giftQty ? ' row-gift' : ''}" data-idx="${i}">
      <td class="col-num">${i + 1}</td>
      <td class="col-name">
        <strong>${esc(l.name)}</strong>
        ${l.priceEdited ? '<span class="edited-tag">سعر معدّل</span>' : ''}
        ${l.giftQty ? `<span class="gift-tag">🎁 ${l.giftQty} هدية</span>` : ''}
      </td>
      <td class="col-barcode" dir="ltr">${esc(l.barcode)}</td>
      <td class="col-price">
        <div class="price-cell">
          <input type="number" class="cell-input price-input${l.priceEdited ? ' price-edited' : ''}"
            data-idx="${i}" value="${l.unitPrice}" min="0" step="1"
            title="السعر الأصلي: ${fmt(l.originalPrice)}" ${allowPrice ? '' : 'readonly'}>
          ${allowPrice ? `<button type="button" class="reset-price-btn${l.priceEdited ? '' : ' hidden'}" data-reset-price="${i}" title="إعادة السعر الأصلي">↺</button>` : ''}
        </div>
        ${l.priceEdited ? `<small class="orig-price" dir="ltr">كان: ${fmt(l.originalPrice)}</small>` : ''}
      </td>
      <td class="col-qty">
        <div class="qty-controls">
          <button type="button" class="qty-btn" data-action="dec" data-idx="${i}">−</button>
          <input type="number" class="cell-input qty-input" data-idx="${i}" value="${l.qty}" min="0" title="كمية البيع (مدفوعة)">
          <button type="button" class="qty-btn" data-action="inc" data-idx="${i}">+</button>
        </div>
      </td>
      <td class="col-gift">
        <div class="gift-controls">
          <button type="button" class="gift-btn" data-action="dec" data-idx="${i}" title="تقليل الهدايا">−</button>
          <input type="number" class="gift-input" data-idx="${i}" value="${l.giftQty || 0}" min="0" title="هدايا إضافية (مجانية)">
          <button type="button" class="gift-btn" data-action="inc" data-idx="${i}" title="زيادة الهدايا">+</button>
        </div>
      </td>
      <td class="col-total line-total-cell" dir="ltr"><strong>${fmt(l.lineTotal)}</strong></td>
      <td class="col-act">
        <button type="button" class="qty-btn del-btn" data-action="del" data-idx="${i}">×</button>
      </td>
    </tr>
  `).join('');
  updateCartTotals();
}

document.getElementById('discountInput').addEventListener('input', updateCartTotals);

document.getElementById('btnClearCart').addEventListener('click', () => {
  if (!state.cart.length || confirm('تفريغ الفاتورة الحالية؟')) {
    state.cart = [];
    state.customer = null;
    state.discount = 0;
    document.getElementById('customerLabel').textContent = 'نقدي — بدون حساب';
    document.getElementById('discountInput').value = '0';
    document.getElementById('lastScanPreview')?.classList.add('hidden');
    newPosSession();
    renderCart();
  }
});

// ── Hold / resume ──
document.getElementById('btnHold').addEventListener('click', () => {
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
  state.customer = null;
  state.discount = 0;
  document.getElementById('discountInput').value = '0';
  document.getElementById('customerLabel').textContent = 'نقدي — بدون حساب';
  renderCart();
  toast('تم تعليق الفاتورة');
});

function loadHeldList() {
  const held = getHeld();
  const el = document.getElementById('heldList');
  if (!held.length) {
    el.innerHTML = '<p class="hint">لا توجد فواتير معلّقة</p>';
    return;
  }
  el.innerHTML = held.map((h, i) => {
    const total = h.cart.reduce((s, l) => s + l.lineTotal, 0);
    const edited = h.cart.filter((l) => l.priceEdited).length;
    return `
    <div class="held-card" data-idx="${i}">
      <div>
        <strong>${esc(h.label)}</strong>
        <span class="held-meta">${h.cart.length} بند · ${h.cart.reduce((s, l) => s + l.qty, 0)} قطعة${edited ? ` · ${edited} سعر معدّل` : ''}</span>
        <div style="font-size:0.78rem;color:var(--text-muted)">${new Date(h.savedAt).toLocaleString('ar-IQ')}</div>
      </div>
      <div>
        <span dir="ltr" style="font-weight:800;color:var(--primary-dark)">${fmt(total)}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-del-held="${i}">حذف</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.held-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.dataset.delHeld != null) {
        e.stopPropagation();
        const idx = Number(e.target.dataset.delHeld);
        const list = getHeld();
        list.splice(idx, 1);
        saveHeld(list);
        loadHeldList();
        return;
      }
      if (state.cart.length && !confirm('استبدال السلة الحالية؟')) return;
      const idx = Number(card.dataset.idx);
      const h = getHeld()[idx];
      state.cart = h.cart.map((l) => ({
        ...l,
        originalPrice: l.originalPrice ?? l.unitPrice,
        priceEdited: l.priceEdited ?? false,
        giftQty: l.giftQty ?? 0
      }));
      state.customer = h.customer;
      state.discount = h.discount;
      document.getElementById('discountInput').value = h.discount || 0;
      document.getElementById('customerLabel').textContent = h.customer
        ? `${h.customer.name} (${h.customer.code})` : 'نقدي — بدون حساب';
      const list = getHeld();
      list.splice(idx, 1);
      saveHeld(list);
      renderCart();
      document.querySelector('[data-view="pos"]').click();
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
    if (code) addToCart(code);
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
  const posVisible = !document.getElementById('viewPos').classList.contains('hidden');
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
        barcodeInput.value = barcodeBuffer;
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
    state.customer = account;
    document.getElementById('customerLabel').textContent = `${account.name} (${account.code})`;
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

function printHtml(html) {
  const clean = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
  let frame = document.getElementById('printFrame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'printFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
  }
  const win = frame.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(clean);
  doc.close();
  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      toast('تعذّر فتح نافذة الطباعة', 'err');
    }
  };
  if (doc.readyState === 'complete') setTimeout(runPrint, 300);
  else win.onload = () => setTimeout(runPrint, 300);
}

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

    const payload = {
      localId: newLocalId(),
      lines: state.cart.map((l) => ({
        productId: l.productId, barcode: l.barcode, name: l.name,
        qty: l.qty, giftQty: l.giftQty || 0, unitPrice: l.unitPrice, lineTotal: l.lineTotal,
        priceEdited: !!l.priceEdited, originalPrice: l.originalPrice
      })),
      discount: state.discount,
      paymentMethod, paidAmount, accountId,
      customerName: state.customer?.name || '',
      notes: document.getElementById('checkoutNotes').value || ''
    };

    const clearCart = () => {
      state.cart = [];
      state.customer = null;
      state.discount = 0;
      document.getElementById('discountInput').value = '0';
      document.getElementById('customerLabel').textContent = 'نقدي';
      document.getElementById('checkoutNotes').value = '';
      document.getElementById('lastScanPreview')?.classList.add('hidden');
      newPosSession();
      renderCart();
      focusBarcode();
    };

    try {
      const data = await api('/branch/invoices', { method: 'POST', body: JSON.stringify(payload) });
      if (!data.invoice?.id) throw new Error('لم يُرجع السيرفر رقم الفاتورة');
      toast(`✓ تم البيع — ${data.invoice.invoiceNo}`);
      state.lastInvoiceId = data.invoice.id;
      localStorage.setItem(LAST_INV_KEY, String(data.invoice.id));
      document.getElementById('checkoutModal').close();
      clearCart();
      printInvoice(data.invoice.id);
      loadTodaySummary();
      loadProducts();
      bustViewCache('dashboard', 'invoices', 'accounts');
    } catch (err) {
      if (navigator.onLine) throw err;
      const outbox = getOutbox();
      outbox.push({ ...payload, syncStatus: 'pending', createdAt: new Date().toISOString() });
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
async function loadDashboard() {
  try {
    const [sumData, invData] = await Promise.all([
      api('/branch/summary/today'),
      api(`/branch/invoices?from=${new Date().toISOString().slice(0, 10)}&limit=8`)
    ]);
    const s = sumData.summary;
    document.getElementById('dashboardKpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-lbl">فواتير البيع</div><div class="kpi-val">${s.salesCount}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">إجمالي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(s.salesAmount)}</div></div>
      <div class="kpi-card danger"><div class="kpi-lbl">المرتجعات</div><div class="kpi-val" dir="ltr">${fmt(s.returnsAmount)}</div></div>
      <div class="kpi-card highlight"><div class="kpi-lbl">صافي اليوم</div><div class="kpi-val" dir="ltr">${fmt(s.netSales)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">نقدي محصّل</div><div class="kpi-val" dir="ltr">${fmt(s.paidAmount)}</div></div>
      <div class="kpi-card"><div class="kpi-lbl">آجل / دين جديد</div><div class="kpi-val" dir="ltr">${fmt(s.dueAmount)}</div></div>
    `;
    document.getElementById('dashboardDetail').innerHTML = `
      <div class="dash-row"><span>تاريخ</span><strong>${esc(s.date)}</strong></div>
      <div class="dash-row"><span>عدد المرتجعات</span><strong>${s.returnsCount}</strong></div>
      <div class="dash-row"><span>فواتير معلّقة (جهاز)</span><strong>${getHeld().length}</strong></div>
      <div class="dash-row"><span>بانتظار الرفع</span><strong>${getOutbox().length}</strong></div>
      ${getOutbox().length ? `<div class="dash-row"><button type="button" class="btn btn-secondary btn-sm" id="btnFlushOutbox">رفع الفواتير المعلّقة الآن</button></div>` : ''}
      <div class="dash-row"><span>منتجات محمّلة</span><strong>${allProducts().length}</strong></div>
      <div class="dash-row"><span>نسخة الأسعار</span><strong>v${state.priceVersion}</strong></div>
      ${state.lastInvoiceId ? `<div class="dash-row"><button type="button" class="btn btn-secondary btn-sm" id="btnReprintLast">إعادة طباعة آخر فاتورة</button></div>` : ''}
    `;
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
              <span class="kind-badge ${i.kind === 'return' ? 'return' : 'sale'}">${i.kind === 'return' ? 'مرتجع' : 'بيع'}</span>
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

async function updateStockBadge() {
  try {
    const threshold = getSettings().lowStockThreshold || 5;
    const data = await api(`/branch/products?summary=1&limit=1&stock=low&threshold=${threshold}`);
    const summary = data.summary;
    const n = summary ? Number(summary.low) + Number(summary.out) : (data.products || []).length;
    const el = document.getElementById('stockBadge');
    if (el) {
      el.textContent = n;
      el.classList.toggle('hidden', !n);
    }
  } catch { /* */ }
}

const stockState = {
  q: '',
  category: '',
  status: 'all',
  sort: 'name',
  page: 0,
  pageSize: 50,
  total: 0,
  loading: false
};
let stockSearchTimer = null;
let stockCategoriesLoaded = false;

function stockStatusOf(qty, threshold) {
  const n = Number(qty) || 0;
  if (n <= 0) return { key: 'out', label: 'نافد', cls: 'st-out' };
  if (n <= threshold) return { key: 'low', label: 'منخفض', cls: 'st-low' };
  return { key: 'in', label: 'متوفر', cls: 'st-ok' };
}

function renderStockSummary(summary) {
  if (!summary) return;
  const map = {
    stockSumAll: summary.total,
    stockSumIn: summary.inStock,
    stockSumLow: summary.low,
    stockSumOut: summary.out
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val ?? 0);
  });
  document.querySelectorAll('.stock-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.stock === stockState.status);
  });
}

function renderStockPagination() {
  const el = document.getElementById('stockPagination');
  if (!el) return;
  const pages = Math.max(1, Math.ceil(stockState.total / stockState.pageSize));
  const page = stockState.page + 1;
  if (stockState.total <= stockState.pageSize) {
    el.innerHTML = stockState.total
      ? `<span class="stock-page-info">عرض ${stockState.total} منتج</span>`
      : '';
    return;
  }
  el.innerHTML = `
    <button type="button" class="btn btn-secondary btn-sm" id="stockPrev" ${stockState.page <= 0 ? 'disabled' : ''}>السابق</button>
    <span class="stock-page-info">صفحة ${page} من ${pages} · ${stockState.total} منتج</span>
    <button type="button" class="btn btn-secondary btn-sm" id="stockNext" ${page >= pages ? 'disabled' : ''}>التالي</button>
  `;
  document.getElementById('stockPrev')?.addEventListener('click', () => {
    if (stockState.page > 0) {
      stockState.page -= 1;
      loadStockView();
    }
  });
  document.getElementById('stockNext')?.addEventListener('click', () => {
    if (stockState.page < pages - 1) {
      stockState.page += 1;
      loadStockView();
    }
  });
}

function renderStockTable(products, threshold) {
  const tbody = document.getElementById('stockTableBody');
  const empty = document.getElementById('stockEmpty');
  if (!tbody) return;
  if (!products.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  const offset = stockState.page * stockState.pageSize;
  tbody.innerHTML = products.map((p, i) => {
    const st = stockStatusOf(p.stockQty, threshold);
    const rowCls = st.key === 'out' ? 'row-out' : st.key === 'low' ? 'row-low' : '';
    return `
      <tr class="${rowCls}">
        <td class="col-idx">${offset + i + 1}</td>
        <td class="col-name">
          <strong>${esc(p.name)}</strong>
          ${p.sku ? `<div class="sku-sub" dir="ltr">${esc(p.sku)}</div>` : ''}
        </td>
        <td class="col-cat">${esc(p.category || '—')}</td>
        <td class="col-code" dir="ltr">${esc(p.barcode)}</td>
        <td class="col-price" dir="ltr">${fmt(p.price)}</td>
        <td class="col-qty" dir="ltr"><strong>${fmt(p.stockQty)}</strong> <small>${esc(p.unit || 'قطعة')}</small></td>
        <td class="col-status"><span class="stock-status ${st.cls}">${st.label}</span></td>
      </tr>`;
  }).join('');
}

async function ensureStockCategories() {
  if (stockCategoriesLoaded) return;
  try {
    const data = await api('/branch/categories');
    const sel = document.getElementById('stockCategory');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">كل التصنيفات</option>' +
      (data.categories || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = current;
    stockCategoriesLoaded = true;
  } catch { /* */ }
}

async function loadStockView() {
  if (stockState.loading) return;
  stockState.loading = true;
  const meta = document.getElementById('stockMeta');
  if (meta) meta.textContent = 'جاري التحميل...';
  try {
    await ensureStockCategories();
    const threshold = getSettings().lowStockThreshold || 5;
    const params = new URLSearchParams({
      summary: '1',
      limit: String(stockState.pageSize),
      offset: String(stockState.page * stockState.pageSize),
      sort: stockState.sort,
      stock: stockState.status,
      threshold: String(threshold)
    });
    if (stockState.q) params.set('q', stockState.q);
    if (stockState.category) params.set('category', stockState.category);
    const data = await api(`/branch/products?${params}`);
    stockState.total = Number(data.total) || 0;
    renderStockSummary(data.summary);
    renderStockTable(data.products || [], threshold);
    renderStockPagination();
    const from = stockState.total ? stockState.page * stockState.pageSize + 1 : 0;
    const to = Math.min(stockState.total, (stockState.page + 1) * stockState.pageSize);
    if (meta) {
      meta.textContent = stockState.total
        ? `عرض ${from}–${to} من ${stockState.total} منتج`
        : 'لا توجد منتجات مطابقة';
    }
    updateStockBadge();
  } catch {
    if (meta) meta.textContent = '';
    toast('تعذّر تحميل المخزون', 'err');
  } finally {
    stockState.loading = false;
  }
}

function bindStockFilters() {
  document.getElementById('btnRefreshStock')?.addEventListener('click', () => {
    stockState.page = 0;
    loadStockView();
  });

  document.getElementById('stockSearch')?.addEventListener('input', (e) => {
    clearTimeout(stockSearchTimer);
    stockSearchTimer = setTimeout(() => {
      stockState.q = e.target.value.trim();
      stockState.page = 0;
      loadStockView();
    }, 320);
  });

  document.getElementById('stockCategory')?.addEventListener('change', (e) => {
    stockState.category = e.target.value;
    stockState.page = 0;
    loadStockView();
  });

  document.getElementById('stockSort')?.addEventListener('change', (e) => {
    stockState.sort = e.target.value;
    stockState.page = 0;
    loadStockView();
  });

  document.getElementById('stockSummaryBar')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.stock-chip');
    if (!chip) return;
    stockState.status = chip.dataset.stock || 'all';
    stockState.page = 0;
    loadStockView();
  });
}

bindStockFilters();

function initReportDates() {
  const today = new Date().toISOString().slice(0, 10);
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
    document.getElementById('reportBody').innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-lbl">فواتير البيع</div><div class="kpi-val">${r.salesCount}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">إجمالي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(r.salesAmount)}</div></div>
        <div class="kpi-card danger"><div class="kpi-lbl">المرتجعات</div><div class="kpi-val" dir="ltr">${fmt(r.returnsAmount)}</div></div>
        <div class="kpi-card highlight"><div class="kpi-lbl">صافي المبيعات</div><div class="kpi-val" dir="ltr">${fmt(r.netSales)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">تحصيلات</div><div class="kpi-val" dir="ltr">${fmt(r.collectionsTotal)}</div></div>
        <div class="kpi-card"><div class="kpi-lbl">ديون جديدة</div><div class="kpi-val" dir="ltr">${fmt(r.dueAmount)}</div></div>
      </div>
      <div class="report-panels">
        <div class="panel-card">
          <h3>حسب طريقة الدفع</h3>
          <table class="data-table">
            <thead><tr><th>الطريقة</th><th>عدد</th><th>المبلغ</th></tr></thead>
            <tbody>${r.byPayment.length ? r.byPayment.map((p) => `
              <tr><td>${payLabel(p.method)}</td><td>${p.count}</td><td dir="ltr">${fmt(p.amount)}</td></tr>
            `).join('') : '<tr><td colspan="3">لا توجد بيانات</td></tr>'}</tbody>
          </table>
        </div>
        <div class="panel-card">
          <h3>أكثر المنتجات مبيعاً</h3>
          <table class="data-table">
            <thead><tr><th>المنتج</th><th>كمية</th><th>مبيعات</th></tr></thead>
            <tbody>${r.topProducts.length ? r.topProducts.map((p) => `
              <tr><td>${esc(p.name)}</td><td>${p.qty}</td><td dir="ltr">${fmt(p.amount)}</td></tr>
            `).join('') : '<tr><td colspan="3">لا توجد بيانات</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  } catch { toast('تعذّر تحميل التقرير', 'err'); }
}

document.getElementById('btnLoadReport')?.addEventListener('click', loadReportsView);
document.getElementById('btnPrintReport')?.addEventListener('click', () => {
  const el = document.getElementById('reportBody');
  const w = window.open('', '_blank');
  w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>تقرير</title></head><body>${el.innerHTML}</body></html>`);
  w.document.close();
  w.print();
});

function loadSettingsView() {
  const s = getSettings();
  document.getElementById('setLowStock').value = s.lowStockThreshold ?? 5;
  document.getElementById('setBlockZero').checked = !!s.blockZeroStock;
  document.getElementById('setBlockOver').checked = s.blockOverStock !== false;
  document.getElementById('setAllowPrice').checked = s.allowPriceEdit !== false;
  document.getElementById('setThermal').checked = s.thermalPrint !== false;
  document.getElementById('setReceiptFooter').value = s.receiptFooter || '';
}

document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
  const patch = {
    lowStockThreshold: Number(document.getElementById('setLowStock').value || 5),
    blockZeroStock: document.getElementById('setBlockZero').checked,
    blockOverStock: document.getElementById('setBlockOver').checked,
    allowPriceEdit: document.getElementById('setAllowPrice').checked,
    thermalPrint: document.getElementById('setThermal').checked,
    receiptFooter: document.getElementById('setReceiptFooter').value || ''
  };
  try {
    const data = await api('/branch/settings', { method: 'PUT', body: JSON.stringify(patch) });
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    saveLocalSettings(state.settings);
    toast('تم حفظ الإعدادات');
    updateStockBadge();
  } catch (err) { toast(err.message, 'err'); }
});

// ── Invoices ──
async function loadInvoices() {
  const q = document.getElementById('invoiceSearch').value || '';
  const date = document.getElementById('invoiceDate').value || new Date().toISOString().slice(0, 10);
  document.getElementById('invoiceDate').value = date;
  const kind = document.getElementById('invoiceKind')?.value || '';
  try {
    let url = `/branch/invoices?q=${encodeURIComponent(q)}&from=${date}&to=${date}`;
    if (kind) url += `&kind=${kind}`;
    const data = await api(url);
    renderInvoiceList(document.getElementById('invoiceList'), data.invoices || []);
  } catch { toast('تعذّر تحميل الفواتير', 'err'); }
}

function renderInvoiceList(el, invs, { returnMode = false } = {}) {
  if (!invs.length) {
    el.innerHTML = '<p class="hint">لا توجد فواتير</p>';
    return;
  }
  el.innerHTML = invs.map((i) => `
    <div class="invoice-card${i.kind === 'return' ? ' kind-return' : ''}" data-id="${i.id}">
      <div>
        <strong>${esc(i.invoiceNo)}</strong>
        <span class="kind-badge ${i.kind === 'return' ? 'return' : 'sale'}">${i.kind === 'return' ? 'مرتجع' : 'بيع'}</span>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">
          ${esc(i.customerName || 'نقدي')} · ${payLabel(i.paymentMethod)} · ${esc(i.invoiceDate)}
        </div>
      </div>
      <div dir="ltr" style="font-weight:800;font-size:1.05rem;color:${i.kind === 'return' ? 'var(--danger)' : 'var(--primary-dark)'}">${fmt(i.total)}</div>
    </div>
  `).join('');
  el.querySelectorAll('.invoice-card').forEach((card) => {
    card.addEventListener('click', () => openInvoiceModal(Number(card.dataset.id), returnMode));
  });
}

async function loadReturnCandidates() {
  const q = document.getElementById('returnSearch')?.value || '';
  const today = new Date().toISOString().slice(0, 10);
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
document.getElementById('invoiceDate').addEventListener('change', loadInvoices);
document.getElementById('invoiceKind')?.addEventListener('change', loadInvoices);

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
      <div class="inv-detail-meta">
        <div><b>العميل:</b> ${esc(inv.customerName || 'نقدي')}</div>
        <div><b>التاريخ:</b> ${esc(inv.invoiceDate)} · <b>النوع:</b> ${inv.kind === 'return' ? 'مرتجع' : 'بيع'}</div>
        <div><b>طريقة الدفع:</b> ${payLabel(inv.paymentMethod, inv)}</div>
        <div><b>الصافي:</b> <strong dir="ltr">${fmt(inv.total)}</strong></div>
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
      method: 'POST', body: JSON.stringify({ lines })
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
      method: 'POST', body: JSON.stringify({ lines })
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
    const grid = document.getElementById('accountGrid');
    grid.innerHTML = (data.accounts || []).map((a) => `
      <div class="account-card" data-id="${a.id}">
        <div class="name">${esc(a.name)}</div>
        <div class="code">${esc(a.code)}${a.phone ? ` · ${esc(a.phone)}` : ''}</div>
        <div class="debt" dir="ltr">${fmt(a.balance)}</div>
      </div>
    `).join('') || '<p class="hint">لا توجد حسابات</p>';
    grid.querySelectorAll('.account-card').forEach((card) => {
      card.addEventListener('click', () => openAccountModal(Number(card.dataset.id)));
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
  document.querySelector('[data-view="payments"]').click();
  setTimeout(() => {
    document.getElementById('payAccount').value = state.activeAccount.id;
    document.getElementById('payAmount').focus();
  }, 200);
});

document.getElementById('accountSearch').addEventListener('input', () => {
  clearTimeout(document.getElementById('accountSearch')._t);
  document.getElementById('accountSearch')._t = setTimeout(loadAccounts, 300);
});
document.getElementById('debtOnly').addEventListener('change', loadAccounts);

// ── Payments ──
async function loadPaymentsView() {
  try {
    const [accData, payData] = await Promise.all([
      api('/branch/accounts'),
      api('/branch/payments')
    ]);
    const sel = document.getElementById('payAccount');
    const accounts = (accData.accounts || []).sort((a, b) => b.balance - a.balance);
    sel.innerHTML = accounts.map((a) =>
      `<option value="${a.id}">${esc(a.name)} — دين: ${fmt(a.balance)}</option>`
    ).join('');
    const pays = payData.payments || [];
    const todayTotal = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
    document.getElementById('paymentsList').innerHTML = `
      <div class="pay-summary">إجمالي تسديدات اليوم: <strong dir="ltr">${fmt(todayTotal)}</strong> (${pays.length})</div>
      ${pays.length ? `
      <table class="data-table">
        <thead><tr><th>الرقم</th><th>الحساب</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
        <tbody>${pays.map((p) => `
          <tr>
            <td>${esc(p.paymentNo)}</td>
            <td>${esc(p.accountName)}</td>
            <td dir="ltr">${fmt(p.amount)}</td>
            <td>${esc(p.paymentDate)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="hint">لا توجد تسديدات اليوم</p>'}`;
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

document.getElementById('btnSyncProducts')?.addEventListener('click', syncAllProductsFromAdmin);
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
    if (!id) {
      state.customer = null;
      document.getElementById('customerLabel').textContent = 'نقدي — بدون حساب';
    } else {
      const acc = customerAccounts.find((a) => a.id === id);
      state.customer = acc;
      document.getElementById('customerLabel').textContent = `${acc.name} (${acc.code})`;
    }
    document.getElementById('customerModal').close();
  });
  window._setCustomerAccounts = (list) => { customerAccounts = list; };
  await loadSettings();
  await loadProducts();
  updateCachedProductCount();
  renderCart();
  loadTodaySummary();
  updateStockBadge();
  checkPriceUpdate();
  flushOutbox();
  setInterval(flushOutbox, 30000);
  setInterval(checkPriceUpdate, 60000);
  setInterval(updateStockBadge, 120000);
  try { await api('/branch/heartbeat', { method: 'POST' }); } catch { /* */ }
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
