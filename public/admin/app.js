const API = '/api';
const KEY = 'shorja_admin';
const APP_KEY = 'shorja_admin_app';
let token = null;
let activeInvoiceId = null;
let activeAccountId = null;
let editingProduct = null;
const priceSelection = new Map();
let productViewMode = 'grid';
let allProductsCache = [];
let categoryCatalog = [];
let prodActiveCategory = '';
let prodStockFilter = '';
let priceBrowseActiveCategory = '';
let priceSheetRows = [];
let priceSheetDirty = new Map();
let priceSheetSelected = new Set();
let priceSheetFilter = '';
let extraCategories = new Set();
let viewingProduct = null;
let priceSheetSaving = false;
let lastSheetNavEl = null;

const CATEGORY_ICONS = {
  'عناية': '✨',
  'عطور': '🌸',
  'مكياج': '💄',
  'default': '📦'
};

const PAGE_TITLES = {
  dashboard: ['لوحة اليوم', 'ملخص مبيعات الفروع والحسابات'],
  posMonitor: ['مراقبة نقاط البيع', 'متابعة حية لفروع الشورجة ونقاط البيع'],
  reports: ['التقارير', 'تحليل المبيعات والمنتجات الأكثر مبيعاً'],
  invoices: ['فواتير الشورجة', 'مبيعات فروع الشورجة فقط — بدون المندوبين'],
  warehousePrep: ['تجهيز الشورجة', 'فواتير فروع الشورجة الجاهزة للترحيل بعد التجهيز'],
  delegates: ['المندوبين', 'طلبات المندوبين الجاهزة للترحيل — منفصلة عن الشورجة'],
  products: ['المنتجات', 'استعراض وإدارة مخزون المنتجات'],
  prices: ['أسعار المواد', 'جدول تسعير سريع داخل التطبيق — اكتب السعر ثم Enter'],
  accounts: ['حسابات العملاء', 'الديون وحدود الائتمان'],
  payments: ['التسديدات', 'تسجيل دفعات العملاء'],
  journal: ['سجل القيود', 'الحركات والتسويات اليدوية'],
  edariSync: ['مزامنة الإداري', 'قاعدة السنة · مراجعة الطابور وترحيل انتقائي']
};

const EDARI_KIND_LABELS = { account: 'حساب', invoice: 'فاتورة', payment: 'تسديد' };
let edariSyncItems = [];
let edariSyncSelected = new Set();

function adminAppScope() {
  return window.getAdminAppScope?.() || localStorage.getItem(APP_KEY) || 'warehouse';
}

window.viewAllowed = (view) => {
  const fn = window.getAdminAppScope;
  if (!fn) return true;
  const map = {
    posMonitor: 'warehouse', reports: 'warehouse', invoices: 'warehouse',
    warehousePrep: 'warehouse', products: 'warehouse', prices: 'warehouse',
    journal: 'warehouse', delegates: 'delegate'
  };
  const scope = map[view];
  if (!scope) return true;
  return scope === fn();
};
window.edariStatusFilter = '';

function scopeQuery() {
  const s = adminAppScope();
  return s === 'warehouse' || s === 'delegate' ? `&scope=${s}` : '';
}

function syncItemScope(item) {
  return item.queueScope || item.queue_scope || inferSyncItemScope(item);
}

function inferSyncItemScope(item) {
  const qs = item.queueScope || item.queue_scope;
  if (qs === 'delegate' || qs === 'warehouse') return qs;
  const blob = [
    item.title, item.subtitle, item.refLabel,
    item.payload?.invoiceNo, item.payload?.notes, item.payload?.customerName
  ].join(' ');
  if (/MND|مندوب/i.test(blob)) return 'delegate';
  return '';
}

function filterSyncItemsByApp(items) {
  const scope = adminAppScope();
  if (scope !== 'warehouse' && scope !== 'delegate') return items || [];
  return (items || []).filter((item) => {
    const itemScope = inferSyncItemScope(item);
    if (!itemScope) return true;
    return itemScope === scope;
  });
}

function debounce(fn, ms = 220) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setPageTitle(view) {
  const [title, sub] = PAGE_TITLES[view] || ['', ''];
  const t = document.getElementById('pageTitle');
  const s = document.getElementById('pageSubtitle');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;
}

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function fmt(n) { return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0}); }
function formatInvoiceDate(d) {
  const s = String(d || '').trim();
  if (!s) return '';
  const day = s.slice(0, 10);
  const time = s.length > 10 ? s.slice(11, 16) : '';
  if (time && time !== '00:00') return `${day}  ${time}`;
  return day;
}
function invoiceTitleHtml(no, date) {
  const d = formatInvoiceDate(date);
  return `<span class="inv-title-cell"><strong class="inv-no">${esc(no || '—')}</strong>${d ? `<span class="inv-date-chip" dir="ltr">${esc(d)}</span>` : ''}</span>`;
}
window.formatInvoiceDate = formatInvoiceDate;
window.invoiceTitleHtml = invoiceTitleHtml;
function currencyLabel(c) { return String(c || '').toLowerCase() === 'usd' ? 'دولار' : 'دينار'; }
function fmtPrice(n, currency) {
  const usd = String(currency || '').toLowerCase() === 'usd';
  const num = Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: usd ? 2 : 0,
    maximumFractionDigits: usd ? 2 : 0
  });
  return usd ? `$${num}` : `${num} د.ع`;
}
function fmtMoneySplit(byCurrency, field, fallback = 0) {
  if (!byCurrency) return fmtPrice(fallback, 'iqd');
  const iqd = Number(byCurrency.iqd?.[field] ?? 0);
  const usd = Number(byCurrency.usd?.[field] ?? 0);
  const parts = [];
  if (iqd) parts.push(fmtPrice(iqd, 'iqd'));
  if (usd) parts.push(fmtPrice(usd, 'usd'));
  return parts.length ? parts.join(' · ') : fmtPrice(0, 'iqd');
}
function fmtAvgTicket(byCurrency, count, amount) {
  if (byCurrency) {
    const parts = [];
    for (const k of ['iqd', 'usd']) {
      const c = Number(byCurrency[k]?.salesCount || 0);
      const amt = Number(byCurrency[k]?.salesAmount || 0);
      if (c > 0) parts.push(fmtPrice(amt / c, k));
    }
    if (parts.length) return parts.join(' · ');
  }
  const c = Number(count || 0);
  return c ? fmtPrice(Number(amount || 0) / c, 'iqd') : fmtPrice(0, 'iqd');
}
function fmtPaySplit(pays) {
  const iqd = (pays || []).filter((p) => (p.currency || 'iqd') !== 'usd').reduce((s, p) => s + Number(p.amount || 0), 0);
  const usd = (pays || []).filter((p) => p.currency === 'usd').reduce((s, p) => s + Number(p.amount || 0), 0);
  return fmtMoneySplit({ iqd: { amount: iqd }, usd: { amount: usd } }, 'amount');
}
function fmtDebtSplit(stats) {
  const iqd = Number(stats?.debtByCurrency?.iqd ?? stats?.totalDebt ?? 0);
  const usd = Number(stats?.debtByCurrency?.usd ?? stats?.totalDebtUsd ?? 0);
  return fmtMoneySplit({ iqd: { amount: iqd }, usd: { amount: usd } }, 'amount');
}
function productPriceLabel(p) {
  if (!p?.priced || !(Number(p.price) > 0)) return 'بدون سعر';
  return fmtPrice(p.price, p.priceCurrency);
}

function branchOnline(lastSeen) {
  if (!lastSeen) return false;
  const t = new Date(lastSeen.replace(' ', 'T')).getTime();
  return Date.now() - t < 5 * 60 * 1000;
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers||{}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem(KEY);
    token = null;
    document.getElementById('loginScreen')?.classList.remove('hidden');
    document.getElementById('app')?.classList.add('hidden');
    throw new Error('انتهت الجلسة — سجّل الدخول مجدداً');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطأ');
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('dialog')?.close());
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('loginError');
  err.classList.add('hidden');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value
      })
    });
    if (data.user.role !== 'admin') {
      throw new Error('هذا حساب نقطة البيع. أغلق الإدارة وافتح تطبيق «نقطة البيع»');
    }
    token = data.token;
    localStorage.setItem(KEY, token);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    setPageTitle('dashboard');
    loadDashboard();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  location.reload();
});

document.querySelectorAll('.nav').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const view = btn.dataset.view;
    if (window.viewAllowed && !window.viewAllowed(view)) {
      toast('هذا القسم غير متاح في التطبيق الحالي');
      return;
    }
    if (view !== 'prices' && priceSheetDirty.size) {
      if (!confirm(`لديك ${priceSheetDirty.size} تعديل سعر غير محفوظ. مغادرة الصفحة بدون حفظ؟`)) return;
    }
    document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`).classList.remove('hidden');
    setPageTitle(view);
    const loaders = {
      dashboard: () => (window.loadDashboard || loadDashboard)(),
      posMonitor: () => (window.loadPosMonitor || (() => {}))(),
      reports: () => (window.loadReports || (() => {}))(),
      invoices: () => (window.loadInvoices || loadInvoices)(),
      warehousePrep: () => (window.loadWarehousePrep || loadWarehousePrep)(),
      delegates: () => (window.loadDelegates || loadDelegates)(),
      products: loadProducts,
      prices: loadPrices,
      accounts: () => (window.loadAccounts || loadAccounts)(),
      payments: loadPayments,
      journal: loadJournal,
      edariSync: () => (window.loadEdariSync || loadEdariSync)()
    };
    loaders[btn.dataset.view]?.();
  });
});

async function loadDashboard() {
  const data = await api('/admin/dashboard');
  const fxInput = document.getElementById('usdToIqdInput');
  if (fxInput && data.appSettings && !fxInput.matches(':focus')) {
    fxInput.value = data.appSettings.usdToIqd || '';
  }
  fillEdariDbSettings(data.appSettings);
  const t = data.today;
  const pending = data.pendingSync || 0;
  const edari = data.edariSync || {};
  const edariPending = Number(edari.total || 0);
  const invPending = Number(edari.invoicesPending || 0);
  const payPending = Number(edari.paymentsPending || 0);
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi"><div class="lbl">فواتير اليوم</div><div class="val">${t.salesCount}</div></div>
    <div class="kpi"><div class="lbl">مبيعات اليوم</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'salesAmount', t.salesAmount)}</div></div>
    <div class="kpi"><div class="lbl">مرتجعات</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'returnsAmount', t.returnsAmount)}</div></div>
    <div class="kpi"><div class="lbl">صافي اليوم</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'netSales', t.netSales)}</div></div>
    <div class="kpi"><div class="lbl">منتجات</div><div class="val">${data.products.total}</div></div>
    <div class="kpi"><div class="lbl">إجمالي الديون</div><div class="val" dir="ltr">${fmtDebtSplit(data.accounts)}</div></div>
    <div class="kpi${pending ? ' warn' : ''}"><div class="lbl">فواتير بانتظار المزامنة</div><div class="val">${pending}</div></div>
    <div class="kpi${edariPending ? ' warn' : ''}" id="edariSyncKpi"><div class="lbl">طابور مزامنة الإداري</div><div class="val">${edariPending}</div></div>
    <div class="kpi${invPending ? ' warn' : ''}"><div class="lbl">فواتير بانتظار الإداري</div><div class="val">${invPending}</div></div>
    <div class="kpi${payPending ? ' warn' : ''}"><div class="lbl">تسديدات بانتظار الإداري</div><div class="val">${payPending}</div></div>
    <div class="kpi"><div class="lbl">إصدار الأسعار</div><div class="val">v${data.priceVersion || 0}</div></div>
  `;
  const syncBar = document.getElementById('edariSyncBar');
  if (syncBar) {
    if (edariPending > 0) {
      syncBar.hidden = false;
      syncBar.innerHTML = `
        <span>${edariPending} عنصر بانتظار الترحيل إلى الإداري (حسابات / فواتير / تسديدات)</span>
        <button type="button" class="btn btn-sm" id="btnEdariSyncReview">مراجعة وترحيل</button>
      `;
      document.getElementById('btnEdariSyncReview')?.addEventListener('click', () => openEdariSyncView());
    } else {
      syncBar.hidden = true;
      syncBar.innerHTML = '';
    }
  }
  document.getElementById('branchesList').innerHTML = (data.branches || []).map((b) => {
    const online = branchOnline(b.last_seen_at);
    return `
    <div class="branch-row">
      <span>
        <span class="status-dot ${online ? 'online' : 'offline'}"></span>
        <strong>${esc(b.name)}</strong> (${esc(b.code)})
      </span>
      <span style="color:var(--muted);font-size:0.85rem">
        ${online ? 'متصل الآن' : `آخر اتصال: ${esc(b.last_seen_at || '—')}`}
        · أسعار v${b.price_version}
      </span>
    </div>`;
  }).join('') || '<p style="color:var(--muted)">لا توجد فروع</p>';
}

function openEdariSyncView() {
  const btn = document.querySelector('.nav[data-view="edariSync"]');
  if (btn) btn.click();
  else loadEdariSync();
}

function edariKindBadge(kind) {
  const lbl = EDARI_KIND_LABELS[kind] || kind;
  const cls = kind === 'account' ? 'kind-account' : kind === 'invoice' ? 'kind-invoice' : 'kind-payment';
  return `<span class="edari-kind-badge ${cls}">${esc(lbl)}</span>`;
}

function updateEdariSyncToolbar() {
  const desktop = !!window.edariDesktop?.processEdariSync;
  const hint = document.getElementById('edariSyncHint');
  const conn = window.lastEdariConn || {};
  if (hint) {
    if (conn.alias) {
      hint.textContent = desktop
        ? `الترحيل من هذا الجهاز إلى قاعدة الإداري ${conn.alias} — ${conn.databasePath || ''}`.trim()
        : `قاعدة الإداري المحفوظة: ${conn.alias}`;
    } else {
      hint.textContent = desktop
        ? 'الترحيل يتم من هذا الجهاز عبر اتصال EdariNX المحلي — القاعدة المطلوبة 2026.'
        : 'افتح تطبيق الإدارة على Windows لتمكين الترحيل إلى قاعدة الإداري 2026.';
    }
  }
  const selected = [...edariSyncSelected];
  const hasKind = (k) => edariSyncItems.some((i) => i.kind === k);
  const selectedOf = (k) => selected.filter((id) => edariSyncItems.find((i) => i.id === id && i.kind === k)).length;
  const setBtn = (id, enabled) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !desktop || !enabled;
  };
  setBtn('btnEdariSyncSelected', selected.length > 0);
  setBtn('btnEdariSyncAccounts', hasKind('account') && (selected.length === 0 || selectedOf('account') > 0));
  setBtn('btnEdariSyncInvoices', hasKind('invoice') && (selected.length === 0 || selectedOf('invoice') > 0));
  setBtn('btnEdariSyncPayments', hasKind('payment') && (selected.length === 0 || selectedOf('payment') > 0));
  const archBtn = document.getElementById('btnEdariArchiveSelected');
  const unarchBtn = document.getElementById('btnEdariUnarchiveSelected');
  if (archBtn) archBtn.disabled = selected.length === 0;
  if (unarchBtn) unarchBtn.disabled = selected.length === 0;
}

function renderEdariSyncTable() {
  const wrap = document.getElementById('edariSyncTable');
  if (!wrap) return;
  let items = filterSyncItemsByApp(edariSyncItems);
  const q = (document.getElementById('edariSyncSearch')?.value || '').trim().toLowerCase();
  if (q) {
    items = items.filter((i) =>
      String(i.title || '').toLowerCase().includes(q) ||
      String(i.subtitle || '').toLowerCase().includes(q) ||
      String(i.refLabel || '').toLowerCase().includes(q) ||
      String(i.invoiceDate || '').toLowerCase().includes(q) ||
      String(i.error || '').toLowerCase().includes(q)
    );
  }
  if (!items.length) {
    const scopeLabel = adminAppScope() === 'delegate' ? 'المندوبين' : 'الشورجة';
    const st = window.edariStatusFilter || '';
    const emptyMsg = st === 'archived'
      ? `لا توجد عناصر مؤرشفة في طابور ${scopeLabel}.`
      : st === 'all'
        ? `لا توجد عناصر في طابور مزامنة ${scopeLabel}.`
        : `لا توجد عناصر معلّقة في طابور مزامنة ${scopeLabel}.`;
    wrap.innerHTML = `<p style="color:var(--muted);padding:16px">${emptyMsg}</p>`;
    updateEdariSyncToolbar();
    return;
  }
  wrap.innerHTML = `
    <table class="edari-sync-table">
      <thead>
        <tr>
          <th><input type="checkbox" id="edariSyncSelectAll" title="تحديد الكل"></th>
          <th>النوع</th>
          <th>العنوان</th>
          <th>التفاصيل</th>
          <th>التاريخ</th>
          <th>المبلغ</th>
          <th>الحالة</th>
          <th>المحاولات</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr class="${item.status === 'error' ? 'row-error' : item.status === 'archived' ? 'row-archived' : ''}">
            <td><input type="checkbox" class="edari-sync-check" data-id="${item.id}" ${edariSyncSelected.has(item.id) ? 'checked' : ''}></td>
            <td>${edariKindBadge(item.kind)}</td>
            <td>${item.kind === 'invoice'
              ? `<button type="button" class="linkish inv-open-btn" data-invoice-id="${item.refId || ''}">${invoiceTitleHtml(item.title, item.invoiceDate || item.createdAt)}</button>`
              : `<strong>${esc(item.title)}</strong><div class="sub">${esc(item.refLabel)}</div>`}</td>
            <td>${esc(item.subtitle)}</td>
            <td dir="ltr">${esc(formatInvoiceDate(item.invoiceDate || item.createdAt) || '—')}</td>
            <td dir="ltr">${item.amount != null ? fmtPrice(item.amount, item.currency) : '—'}</td>
            <td>${edariSyncLabel(item.status, item.error)}${item.error ? `<div class="sync-err-msg">${esc(item.error)}</div>` : ''}</td>
            <td>${item.attempts || 0}</td>
            <td class="row-actions">${item.status === 'archived'
              ? `<button type="button" class="btn btn-ghost btn-sm" data-unarchive-id="${item.id}">استعادة</button>`
              : `<button type="button" class="btn btn-ghost btn-sm" data-archive-id="${item.id}">أرشفة</button>`}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  const allCb = document.getElementById('edariSyncSelectAll');
  const checks = wrap.querySelectorAll('.edari-sync-check');
  allCb?.addEventListener('change', () => {
    if (allCb.checked) items.forEach((i) => edariSyncSelected.add(i.id));
    else items.forEach((i) => edariSyncSelected.delete(i.id));
    checks.forEach((c) => { c.checked = allCb.checked; });
    updateEdariSyncToolbar();
  });
  checks.forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) edariSyncSelected.add(id);
      else edariSyncSelected.delete(id);
      if (allCb) allCb.checked = checks.length > 0 && [...checks].every((c) => c.checked);
      updateEdariSyncToolbar();
    });
  });
  wrap.querySelectorAll('[data-archive-id]').forEach((btn) => {
    btn.addEventListener('click', () => archiveEdariItems([Number(btn.dataset.archiveId)]));
  });
  wrap.querySelectorAll('[data-unarchive-id]').forEach((btn) => {
    btn.addEventListener('click', () => unarchiveEdariItems([Number(btn.dataset.unarchiveId)]));
  });
  wrap.querySelectorAll('[data-invoice-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = Number(btn.dataset.invoiceId);
      if (id) openInvoice(id);
    });
  });
  updateEdariSyncToolbar();
}

function fillEdariDbSettings(settings) {
  if (!settings) return;
  const aliasEl = document.getElementById('edariAliasInput');
  const rootEl = document.getElementById('edariDataRootInput');
  const hint = document.getElementById('edariDbPathHint');
  if (aliasEl && !aliasEl.matches(':focus')) aliasEl.value = settings.edariAlias || '2026';
  if (rootEl && !rootEl.matches(':focus')) rootEl.value = settings.edariDataRoot || '';
  updateEdariDbPathHint();
}

function currentEdariConn() {
  return {
    alias: (document.getElementById('edariAliasInput')?.value || '2026').trim(),
    dataRoot: (document.getElementById('edariDataRootInput')?.value || '').trim()
  };
}

function updateEdariDbPathHint() {
  const hint = document.getElementById('edariDbPathHint');
  if (!hint) return;
  const { alias, dataRoot } = currentEdariConn();
  const folder = (dataRoot || 'D:\\Future of Technology\\EdariNX\\Data').replace(/[\\/]+$/, '');
  hint.textContent = `المسار المستخدم: ${folder}\\${alias || '2026'}`;
}

async function loadEdariSync() {
  let savedSettings = null;
  try {
    const fx = await api('/admin/app-settings');
    savedSettings = fx.settings;
    fillEdariDbSettings(fx.settings);
  } catch { /* ignore */ }
  const kind = document.getElementById('edariSyncKindFilter')?.value || '';
  const params = new URLSearchParams();
  if (kind) params.set('kinds', kind);
  const scope = adminAppScope();
  params.set('scope', scope === 'delegate' ? 'delegate' : 'warehouse');
  params.set('limit', '5000');
  if (scope === 'delegate' && !window.edariStatusUserSet) {
    window.edariStatusFilter = 'all';
    document.querySelectorAll('#edariStatusFilters .filter-chip').forEach((c) => {
      c.classList.toggle('active', (c.dataset.edariStatus || '') === 'all');
    });
  }
  const status = window.edariStatusFilter || '';
  if (status) params.set('status', status);
  const q = params.toString() ? `?${params}` : '';
  let data;
  try {
    data = await api(`/admin/edari/sync-queue${q}`);
  } catch (err) {
    const wrap = document.getElementById('edariSyncTable');
    if (wrap) wrap.innerHTML = `<p style="color:var(--danger);padding:16px">${esc(err.message || 'تعذّر جلب طابور المزامنة')}</p>`;
    toast(err.message || 'تعذّر جلب طابور المزامنة');
    return;
  }
  const stats = data.stats || {};
  const byKind = stats.queueByKind || {};
  edariSyncItems = filterSyncItemsByApp(data.items || []);
  edariSyncSelected = new Set([...edariSyncSelected].filter((id) => edariSyncItems.some((i) => i.id === id)));
  const scopeLabel = scope === 'delegate' ? 'المندوبين' : 'الشورجة';
  const statsEl = document.getElementById('edariSyncStats');
  if (statsEl) {
    const active = window.edariStatusFilter || '';
    statsEl.innerHTML = `
      <button type="button" class="edari-stat ${active === '' ? 'active' : ''}" data-edari-jump="">
        <span class="lbl">معلّق (${scopeLabel})</span><span class="val">${stats.pending || 0}</span>
      </button>
      <button type="button" class="edari-stat warn ${active === 'error' ? 'active' : ''}" data-edari-jump="error">
        <span class="lbl">أخطاء</span><span class="val">${stats.error || 0}</span>
      </button>
      <button type="button" class="edari-stat archived ${active === 'archived' ? 'active' : ''}" data-edari-jump="archived">
        <span class="lbl">مؤرشف</span><span class="val">${stats.archived || 0}</span>
      </button>
      <div class="edari-stat"><span class="lbl">حسابات بالطابور</span><span class="val">${byKind.account || 0}</span></div>
      <div class="edari-stat"><span class="lbl">فواتير ظاهرة</span><span class="val">${(edariSyncItems.filter((i) => i.kind === 'invoice').length) || data.invoiceTotal || byKind.invoice || 0}</span></div>
      <div class="edari-stat"><span class="lbl">تسديدات بالطابور</span><span class="val">${byKind.payment || 0}</span></div>
    `;
    statsEl.querySelectorAll('[data-edari-jump]').forEach((btn) => {
      btn.addEventListener('click', () => setEdariStatusFilter(btn.dataset.edariJump || ''));
    });
  }
  const alert = document.getElementById('edariSyncAlert');
  const canTransfer = !!window.edariDesktop?.processEdariSync;
  if (alert) {
    alert.classList.toggle('ok', canTransfer);
    alert.classList.toggle('warn', !canTransfer);
  }
  if (data.edari) window.lastEdariConn = data.edari;
  else if (savedSettings?.edariAlias) {
    const root = String(savedSettings.edariDataRoot || 'D:\\Future of Technology\\EdariNX\\Data').replace(/[\\/]+$/, '');
    window.lastEdariConn = {
      alias: savedSettings.edariAlias,
      dataRoot: savedSettings.edariDataRoot,
      databasePath: `${root}\\${savedSettings.edariAlias}`
    };
  }
  if (window.edariDesktop?.getEdariConnection) {
    window.edariDesktop.getEdariConnection().then((info) => {
      if (info?.ok && info.edari) {
        window.lastEdariConn = info.edari;
        fillEdariDbSettings({
          edariAlias: info.edari.alias,
          edariDataRoot: info.edari.dataRoot
        });
        updateEdariSyncToolbar();
      }
    }).catch(() => {});
  }
  const hint = document.getElementById('edariSyncHint');
  if (hint) {
    hint.textContent = scope === 'delegate'
      ? 'كل فواتير المندوبين تظهر هنا مع تاريخ كل فاتورة بجانبها. «الكل» يعرض المعلّق والمرحّل والمؤرشف.'
      : 'طابور ترحيل الشورجة. الفواتير المدخلة يدوياً في الإداري تُؤرشف حتى لا تُرحَّل.';
  }
  renderEdariSyncTable();
}

async function runEdariSyncTransfer({ kinds = null, itemIds = null } = {}) {
  if (!window.edariDesktop?.processEdariSync) {
    toast('افتح تطبيق الإدارة على Windows للترحيل');
    return;
  }
  let ids = itemIds && itemIds.length ? itemIds : (edariSyncSelected.size ? [...edariSyncSelected] : null);
  if (ids?.length) {
    const queuedIds = [];
    for (const raw of ids) {
      const id = Number(raw);
      if (!id) continue;
      const item = edariSyncItems.find((i) => i.id === id);
      if (item?.status === 'archived') continue;
      if (id < 0) {
        try {
          const data = await api(`/admin/delegate-invoices/${-id}/queue-edari`, { method: 'POST' });
          if (data.queueId) queuedIds.push(data.queueId);
        } catch (err) {
          toast(err.message || 'تعذّر إضافة الفاتورة للطابور');
        }
      } else {
        queuedIds.push(id);
      }
    }
    ids = queuedIds;
    if (!ids.length) {
      toast('العناصر المحددة مؤرشفة أو غير جاهزة للترحيل');
      return;
    }
  }
  const btns = ['btnEdariSyncSelected', 'btnEdariSyncAccounts', 'btnEdariSyncInvoices', 'btnEdariSyncPayments', 'btnEdariSyncRefresh'];
  btns.forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = true; });
  try {
    if (ids?.length || kinds?.length) {
      await api('/admin/edari/sync-queue/retry', {
        method: 'POST',
        body: JSON.stringify({
          itemIds: ids,
          kinds: kinds || null,
          scope: adminAppScope() === 'delegate' ? 'delegate' : 'warehouse'
        })
      });
    }
    const result = await window.edariDesktop.processEdariSync({
      kinds: kinds || null,
      itemIds: ids,
      limit: 100,
      scope: adminAppScope() === 'delegate' ? 'delegate' : 'warehouse'
    });
    if (result?.skipped) {
      const reasons = { busy: 'المزامنة قيد التشغيل', missing_sync_key: 'مفتاح المزامنة غير مضبوط', not_windows: 'يتطلب Windows' };
      toast(reasons[result.reason] || 'تعذر الترحيل');
      return;
    }
    if (result?.error) throw new Error(result.error);
    const ok = result?.okCount ?? result?.processed ?? 0;
    const fail = result?.failCount ?? 0;
    const dbLabel = result?.edari?.alias ? ` على قاعدة ${result.edari.alias}` : ' على قاعدة 2026';
    if (ok > 0) toast(`تم ترحيل ${ok} عنصر/عناصر${dbLabel}${fail ? ` — فشل ${fail}` : ''}`);
    else if (fail > 0) {
      const errMsg = (result?.results || []).find((r) => r && r.ok === false)?.error;
      toast(errMsg ? `فشل الترحيل${dbLabel}: ${errMsg}` : `فشل ترحيل ${fail} عنصر/عناصر${dbLabel}`);
    }
    else toast('لا توجد عناصر للترحيل');
    if (result?.edari) window.lastEdariConn = result.edari;
    edariSyncSelected.clear();
    await loadEdariSync();
    loadDashboard();
    const view = document.querySelector('.nav.active')?.dataset.view;
    if (view === 'accounts') loadAccounts();
    if (view === 'invoices') loadInvoices();
    if (view === 'payments') loadPayments();
  } catch (err) {
    toast(err.message || 'فشل الترحيل');
  } finally {
    updateEdariSyncToolbar();
    const refresh = document.getElementById('btnEdariSyncRefresh');
    if (refresh) refresh.disabled = false;
  }
}

document.getElementById('edariSyncKindFilter')?.addEventListener('change', () => {
  edariSyncSelected.clear();
  loadEdariSync();
});
document.getElementById('edariSyncSearch')?.addEventListener('input', debounce(() => renderEdariSyncTable(), 200));
document.getElementById('btnEdariSelectPending')?.addEventListener('click', () => {
  edariSyncSelected.clear();
  filterSyncItemsByApp(edariSyncItems).forEach((i) => {
    if (i.status === 'pending' || i.status === 'error') edariSyncSelected.add(i.id);
  });
  renderEdariSyncTable();
  toast(`تم تحديد ${edariSyncSelected.size} عنصر`);
});
document.getElementById('btnEdariSyncRefresh')?.addEventListener('click', () => loadEdariSync());
document.getElementById('btnEdariSyncSelected')?.addEventListener('click', () => {
  if (!edariSyncSelected.size) return toast('حدد عناصر من الجدول');
  runEdariSyncTransfer({ itemIds: [...edariSyncSelected] });
});
document.getElementById('btnEdariSyncAccounts')?.addEventListener('click', () => {
  const ids = edariSyncSelected.size
    ? [...edariSyncSelected].filter((id) => edariSyncItems.find((i) => i.id === id && i.kind === 'account'))
    : null;
  runEdariSyncTransfer({ kinds: ['account'], itemIds: ids });
});
document.getElementById('btnEdariSyncInvoices')?.addEventListener('click', () => {
  const ids = edariSyncSelected.size
    ? [...edariSyncSelected].filter((id) => edariSyncItems.find((i) => i.id === id && i.kind === 'invoice'))
    : null;
  runEdariSyncTransfer({ kinds: ['invoice'], itemIds: ids });
});
document.getElementById('btnEdariSyncPayments')?.addEventListener('click', () => {
  const ids = edariSyncSelected.size
    ? [...edariSyncSelected].filter((id) => edariSyncItems.find((i) => i.id === id && i.kind === 'payment'))
    : null;
  runEdariSyncTransfer({ kinds: ['payment'], itemIds: ids });
});

async function archiveEdariItems(ids) {
  const raw = [...new Set(ids || [])].map(Number).filter((id) => id && !Number.isNaN(id));
  const invoiceIds = raw.filter((id) => id < 0).map((id) => -id);
  const queueIds = raw.filter((id) => id > 0).filter((id) => {
    const item = edariSyncItems.find((i) => i.id === id);
    return !item || item.status !== 'archived';
  });
  if (!invoiceIds.length && !queueIds.length) return toast('حدد عناصر غير مؤرشفة');
  const total = invoiceIds.length + queueIds.length;
  if (!confirm(`أرشفة ${total} عنصر؟ لن تُرحَّل إلى الإداري حتى تُستعاد من الأرشيف.`)) return;
  try {
    let count = 0;
    for (const invId of invoiceIds) {
      await api(`/admin/delegate-invoices/${invId}/archive-edari`, {
        method: 'POST',
        body: JSON.stringify({ note: 'إدخال يدوي في الإداري — لن يُرحَّل' })
      });
      count += 1;
    }
    if (queueIds.length) {
      const data = await api('/admin/edari/sync-queue/archive', {
        method: 'POST',
        body: JSON.stringify({
          itemIds: queueIds,
          note: 'إدخال يدوي في الإداري — لن يُرحَّل',
          scope: adminAppScope() === 'delegate' ? 'delegate' : 'warehouse'
        })
      });
      count += Number(data.count || queueIds.length);
    }
    toast(`تم أرشفة ${count || total} عنصر — لن تُرحَّل`);
    raw.forEach((id) => edariSyncSelected.delete(id));
    await loadEdariSync();
  } catch (err) {
    toast(err.message || 'فشل الأرشفة');
  }
}

async function unarchiveEdariItems(ids) {
  const raw = [...new Set(ids || [])].map(Number).filter((id) => id && !Number.isNaN(id));
  const invoiceIds = raw.filter((id) => id < 0).map((id) => -id);
  const queueIds = raw.filter((id) => id > 0);
  if (!invoiceIds.length && !queueIds.length) return toast('حدد عناصر مؤرشفة لاستعادتها');
  try {
    let count = 0;
    for (const invId of invoiceIds) {
      await api(`/admin/delegate-invoices/${invId}/unarchive-edari`, { method: 'POST' });
      count += 1;
    }
    if (queueIds.length) {
      const data = await api('/admin/edari/sync-queue/unarchive', {
        method: 'POST',
        body: JSON.stringify({
          itemIds: queueIds,
          scope: adminAppScope() === 'delegate' ? 'delegate' : 'warehouse'
        })
      });
      count += Number(data.count || queueIds.length);
    }
    toast(`تم استعادة ${count || raw.length} عنصر إلى الطابور`);
    edariSyncSelected.clear();
    await loadEdariSync();
  } catch (err) {
    toast(err.message || 'فشل الاستعادة');
  }
}

window.archiveEdariItems = archiveEdariItems;
window.unarchiveEdariItems = unarchiveEdariItems;

document.getElementById('btnEdariArchiveSelected')?.addEventListener('click', () => {
  archiveEdariItems([...edariSyncSelected]);
});
document.getElementById('btnEdariUnarchiveSelected')?.addEventListener('click', () => {
  unarchiveEdariItems([...edariSyncSelected]);
});

function setEdariStatusFilter(status) {
  window.edariStatusUserSet = true;
  window.edariStatusFilter = status || '';
  document.querySelectorAll('#edariStatusFilters .filter-chip').forEach((c) => {
    c.classList.toggle('active', (c.dataset.edariStatus || '') === (status || ''));
  });
  edariSyncSelected.clear();
  loadEdariSync();
}
window.setEdariStatusFilter = setEdariStatusFilter;

document.getElementById('btnEdariOpenArchive')?.addEventListener('click', () => {
  setEdariStatusFilter('archived');
});

async function triggerEdariSyncNow() {
  openEdariSyncView();
}

function edariSyncLabel(status, error = '') {
  const title = error ? ` title="${esc(error)}"` : '';
  if (status === 'synced' || status === 'done') return `<span style="color:var(--ok)"${title}>متزامن</span>`;
  if (status === 'archived') return `<span style="color:var(--muted)"${title}>مؤرشف</span>`;
  if (status === 'pending') return `<span style="color:var(--warn)"${title}>بانتظار الإداري</span>`;
  if (status === 'error') return `<span class="sync-status-error"${title}>خطأ</span>`;
  return `<span style="color:var(--muted)"${title}>—</span>`;
}

async function loadInvoices() {
  const from = document.getElementById('invFrom')?.value || '';
  const to = document.getElementById('invTo')?.value || '';
  const q = document.getElementById('invSearch')?.value || '';
  const params = new URLSearchParams({ limit: '5000' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q) params.set('q', q);
  const branchId = document.getElementById('invBranch')?.value || '';
  const kind = document.getElementById('invKind')?.value || '';
  const payment = document.getElementById('invPayment')?.value || '';
  const edari = document.getElementById('invEdari')?.value || '';
  const sort = document.getElementById('invSort')?.value || 'created_desc';
  if (branchId) params.set('branchId', branchId);
  if (kind) params.set('kind', kind);
  if (payment) params.set('payment', payment);
  if (edari) params.set('edari', edari);
  if (sort) params.set('sort', sort);
  const data = await api(`/admin/invoices?${params}`);
  renderInvoiceStats(data.stats || {});
  const shown = (data.invoices || []).length;
  const total = data.total != null ? data.total : shown;
  const countEl = document.getElementById('invResultCount');
  if (countEl) countEl.textContent = `عرض ${shown}${total > shown ? ` من ${total}` : ''} فاتورة`;
  document.getElementById('invoiceTable').innerHTML = `
    <table class="ledger-table">
      <thead><tr><th>الرقم</th><th>النوع</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>مدفوع</th><th>متبقي</th><th>الإداري</th></tr></thead>
      <tbody>${(data.invoices||[]).length ? (data.invoices||[]).map((i) => `
        <tr class="clickable-row ${i.edariSyncStatus === 'archived' ? 'row-archived' : ''}" data-invoice-id="${i.id}">
          <td>${esc(i.invoiceNo)}</td>
          <td>${i.kind === 'return' ? 'مرتجع' : i.kind === 'issue' ? 'إخراج' : 'بيع'}</td>
          <td>${esc(i.customerName||'نقدي')}</td>
          <td>${esc(i.invoiceDate)}</td>
          <td dir="ltr">${fmtPrice(i.total, i.currency)}</td>
          <td dir="ltr">${fmtPrice(i.paidAmount, i.currency)}</td>
          <td dir="ltr">${fmtPrice(i.dueAmount, i.currency)}</td>
          <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}${i.edariBillNum ? `<br><small dir="ltr">${esc(i.edariBillNum)}</small>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="8" class="empty-cell">لا توجد فواتير — اضغط «عرض الكل» أو اترك التاريخ فارغاً</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('invoiceTable').querySelectorAll('[data-invoice-id]').forEach((row) => {
    row.addEventListener('click', () => openInvoice(Number(row.dataset.invoiceId)));
  });
}

function renderInvoiceStats(stats) {
  const el = document.getElementById('invoiceStats');
  if (!el) return;
  el.className = 'invoice-hero kpi-grid premium-kpis';
  el.innerHTML = `
    <button type="button" class="kpi premium-kpi" data-inv-jump="all"><div class="lbl">كل الفواتير</div><div class="val">${stats.total || 0}</div></button>
    <button type="button" class="kpi premium-kpi" data-inv-jump="today"><div class="lbl">اليوم</div><div class="val">${stats.today || 0}</div></button>
    <button type="button" class="kpi premium-kpi warn" data-inv-jump="pending"><div class="lbl">بانتظار الترحيل</div><div class="val">${stats.pending || 0}</div></button>
    <button type="button" class="kpi premium-kpi" data-inv-jump="archived"><div class="lbl">مؤرشفة</div><div class="val">${stats.archived || 0}</div></button>
    <button type="button" class="kpi premium-kpi" data-inv-jump="synced"><div class="lbl">مرحّلة</div><div class="val">${stats.synced || 0}</div></button>
  `;
}

document.getElementById('invDate')?.addEventListener('change', loadInvoices);
document.getElementById('invSearch')?.addEventListener('input', debounce(loadInvoices, 250));
document.getElementById('invSort')?.addEventListener('change', loadInvoices);

function renderPrepStats(el, stats) {
  if (!el) return;
  el.innerHTML = `
    <div class="kpi"><div class="lbl">كل الفواتير</div><div class="val">${stats.total || 0}</div></div>
    <div class="kpi warn"><div class="lbl">بانتظار الترحيل</div><div class="val">${stats.pending || 0}</div></div>
    <div class="kpi"><div class="lbl">مؤرشفة</div><div class="val">${stats.archived || 0}</div></div>
    <div class="kpi"><div class="lbl">مرحّلة</div><div class="val">${stats.synced || 0}</div></div>`;
}

function prepEdariActionsHtml(i) {
  if (i.edariSyncStatus === 'synced' && i.edariBillSeq) {
    return '<span style="color:var(--ok)">✓ مرحّلة</span>';
  }
  if (i.edariSyncStatus === 'archived') {
    return `<button type="button" class="btn btn-ghost btn-sm" data-unarchive-inv="${i.id}">استعادة</button>`;
  }
  return `
    <button type="button" class="btn btn-secondary btn-sm" data-queue-edari="${i.id}">ترحيل للإداري</button>
    <button type="button" class="btn btn-ghost btn-sm" data-archive-inv="${i.id}">أرشفة</button>`;
}

function reloadActivePrepView() {
  const view = document.querySelector('.nav.active')?.dataset.view;
  if (view === 'delegates') (window.loadDelegates || loadDelegates)();
  else if (view === 'warehousePrep') (window.loadWarehousePrep || loadWarehousePrep)();
  else if (view === 'invoices') (window.loadInvoices || loadInvoices)();
  else if (view === 'edariSync') (window.loadEdariSync || loadEdariSync)();
  else document.querySelector('.nav.active')?.click();
}

async function archiveInvoiceFromPrep(invoiceId) {
  if (!confirm('أرشفة هذه الفاتورة؟ لن تُرحَّل إلى الإداري لأنها مدخلة يدوياً.')) return;
  try {
    await api(`/admin/delegate-invoices/${invoiceId}/archive-edari`, {
      method: 'POST',
      body: JSON.stringify({ note: 'إدخال يدوي في الإداري — لن يُرحَّل' })
    });
    toast('تم أرشفة الفاتورة — لن تُرحَّل');
    reloadActivePrepView();
  } catch (err) { toast(err.message); }
}

async function unarchiveInvoiceFromPrep(invoiceId) {
  try {
    await api(`/admin/delegate-invoices/${invoiceId}/unarchive-edari`, { method: 'POST' });
    toast('أُعيدت الفاتورة من الأرشيف');
    reloadActivePrepView();
  } catch (err) { toast(err.message); }
}

window.archiveInvoiceFromPrep = archiveInvoiceFromPrep;
window.unarchiveInvoiceFromPrep = unarchiveInvoiceFromPrep;
window.prepEdariActionsHtml = prepEdariActionsHtml;

function bindPrepTableActions(tableEl) {
  if (!tableEl) return;
  tableEl.querySelectorAll('[data-invoice-id]').forEach((btn) => {
    btn.addEventListener('click', () => openInvoice(Number(btn.dataset.invoiceId)));
  });
  tableEl.querySelectorAll('[data-queue-edari]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/admin/delegate-invoices/${btn.dataset.queueEdari}/queue-edari`, { method: 'POST' });
        toast('أُضيفت الفاتورة لطابور الإداري — راجع «مزامنة الإداري» للترحيل');
        reloadActivePrepView();
      } catch (err) { toast(err.message); }
    });
  });
  tableEl.querySelectorAll('[data-archive-inv]').forEach((btn) => {
    btn.addEventListener('click', () => archiveInvoiceFromPrep(Number(btn.dataset.archiveInv)));
  });
  tableEl.querySelectorAll('[data-unarchive-inv]').forEach((btn) => {
    btn.addEventListener('click', () => unarchiveInvoiceFromPrep(Number(btn.dataset.unarchiveInv)));
  });
}

function renderPrepTable(tableEl, rows, { labelHeader, labelFn }) {
  if (!tableEl) return;
  tableEl.innerHTML = `
    <table>
      <thead><tr>
        <th>${labelHeader}</th><th>الفاتورة والتاريخ</th><th>طلب التجهيز</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الإداري</th><th></th>
      </tr></thead>
      <tbody>${rows.map((i) => `
        <tr class="${i.edariSyncStatus === 'archived' ? 'row-archived' : ''}">
          <td>${esc(labelFn(i))}</td>
          <td><button type="button" class="linkish inv-open-btn" data-invoice-id="${i.id}">${invoiceTitleHtml(i.invoiceNo, i.invoiceDate || i.createdAt)}</button></td>
          <td dir="ltr">${esc(i.prepOrderNo || '—')}</td>
          <td>${esc(i.customerName || 'نقدي')}</td>
          <td dir="ltr">${esc(formatInvoiceDate(i.invoiceDate || i.createdAt) || '—')}</td>
          <td dir="ltr">${fmtPrice(i.total, i.currency)}</td>
          <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}${i.edariBillNum ? `<br><small dir="ltr">${esc(i.edariBillNum)}</small>` : ''}</td>
          <td class="row-actions">${prepEdariActionsHtml(i)}</td>
        </tr>`).join('') || '<tr><td colspan="8">لا توجد فواتير</td></tr>'}
      </tbody>
    </table>`;
  bindPrepTableActions(tableEl);
}

function prepListParams(dateEl, searchEl, edariFilter) {
  const dateInput = document.getElementById(dateEl);
  const date = dateInput?.dataset.userSet && dateInput.value ? dateInput.value : '';
  const q = document.getElementById(searchEl)?.value || '';
  const params = new URLSearchParams();
  params.set('limit', '5000');
  if (date) { params.set('from', date); params.set('to', date); }
  if (q) params.set('q', q);
  if (edariFilter === 'pending' || edariFilter === 'synced' || edariFilter === 'archived') {
    params.set('edari', edariFilter);
  }
  return params;
}

async function loadWarehousePrep() {
  const data = await api(`/admin/warehouse-prep-invoices?${prepListParams('warehouseDate', 'warehouseSearch', window.warehouseFilter || '')}`);
  renderPrepStats(document.getElementById('warehouseStats'), data.stats || {});
  renderPrepTable(document.getElementById('warehouseTable'), data.invoices || [], {
    labelHeader: 'الفرع',
    labelFn: (i) => i.branchName || i.sourceLabel || 'فرع الشورجة'
  });
}

document.getElementById('warehouseDate')?.addEventListener('change', loadWarehousePrep);
document.getElementById('warehouseSearch')?.addEventListener('input', debounce(loadWarehousePrep, 250));

async function loadDelegates() {
  const tableEl = document.getElementById('delegateTable');
  const dateEl = document.getElementById('delegateDate');
  if (dateEl && !dateEl.dataset.userSet) dateEl.value = '';
  try {
    const data = await api(`/admin/delegate-invoices?${prepListParams('delegateDate', 'delegateSearch', window.delegateFilter || '')}`);
    renderPrepStats(document.getElementById('delegateStats'), data.stats || {});
    const meta = document.getElementById('delegateListMeta');
    const rows = data.invoices || [];
    const total = data.total != null ? data.total : rows.length;
    const statsTotal = Number(data.stats?.total || 0);
    if (meta) {
      if (!rows.length && statsTotal > 0) {
        meta.textContent = `يوجد ${statsTotal} فاتورة لكن الفلتر الحالي لا يُظهرها — امسح التاريخ أو اختر «الكل».`;
      } else {
        meta.textContent = `عرض ${rows.length} فاتورة${total > rows.length ? ` من ${total}` : ''} — كل التواريخ ما لم تختار يوماً.`;
      }
    }
    renderPrepTable(tableEl, rows, {
      labelHeader: 'المندوب',
      labelFn: (i) => i.sourceLabel || i.prepOrderNo || '—'
    });
  } catch (err) {
    if (tableEl) {
      tableEl.innerHTML = `<p style="color:var(--danger);padding:16px">${esc(err.message || 'تعذّر جلب فواتير المندوبين')}</p>`;
    }
    toast(err.message || 'تعذّر جلب فواتير المندوبين');
  }
}

document.getElementById('delegateDate')?.addEventListener('change', () => {
  const el = document.getElementById('delegateDate');
  if (el) el.dataset.userSet = '1';
  (window.loadDelegates || loadDelegates)();
});
document.getElementById('delegateSearch')?.addEventListener('input', debounce(() => (window.loadDelegates || loadDelegates)(), 250));

async function openInvoice(id) {
  try {
    const data = await api(`/admin/invoices/${id}`);
    const inv = data.invoice;
    activeInvoiceId = id;
    document.getElementById('invoiceDetail').innerHTML = `
      <h2>فاتورة ${esc(inv.invoiceNo)}</h2>
      <div class="ledger-summary inv-meta-grid">
        <span>النوع: <strong>${inv.kind === 'return' ? 'مرتجع' : inv.kind === 'issue' ? 'إخراج' : 'بيع'}</strong></span>
        <span>التاريخ: <strong>${esc(inv.invoiceDate)}</strong></span>
        <span>الوقت: <strong>${esc((inv.createdAt || '').slice(11, 16) || '—')}</strong></span>
        <span>العميل: <strong>${esc(inv.customerName || 'نقدي')}</strong></span>
        <span>الدفع: <strong>${esc(inv.paymentMethod === 'credit' ? 'آجل' : inv.paymentMethod === 'partial' ? 'جزئي' : 'نقدي')}</strong></span>
        <span>الإجمالي: <strong dir="ltr">${fmtPrice(inv.total, inv.currency)}</strong></span>
        <span>مدفوع: <strong dir="ltr">${fmtPrice(inv.paidAmount, inv.currency)}</strong></span>
        <span>متبقي: <strong dir="ltr">${fmtPrice(inv.dueAmount, inv.currency)}</strong></span>
        <span>العملة: <strong>${currencyLabel(inv.currency)}</strong></span>
        <span>الإداري: ${edariSyncLabel(inv.edariSyncStatus, inv.edariSyncError)}</span>
        ${inv.notes ? `<span>ملاحظات: <strong>${esc(inv.notes)}</strong></span>` : ''}
      </div>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>المنتج</th><th>الباركود</th><th>الكمية</th><th>هدايا</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>${(inv.lines||[]).map((l) => `
            <tr>
              <td>${esc(l.name)}</td>
              <td dir="ltr">${esc(l.barcode)}</td>
              <td dir="ltr">${l.qty}</td>
              <td dir="ltr">${l.giftQty || 0}</td>
              <td dir="ltr">${fmtPrice(l.unitPrice, inv.currency)}</td>
              <td dir="ltr">${fmtPrice(l.lineTotal, inv.currency)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="row-actions" style="margin-top:12px">
        ${inv.edariSyncStatus === 'archived'
          ? `<button type="button" class="btn btn-ghost btn-sm" id="btnInvUnarchiveEdari">استعادة من الأرشيف</button>`
          : (inv.edariSyncStatus === 'synced' && inv.edariBillSeq
            ? ''
            : `<button type="button" class="btn btn-sm btn-primary" id="btnInvQueueEdari">ترحيل للإداري</button>
               <button type="button" class="btn btn-ghost btn-sm" id="btnInvArchiveEdari">أرشفة (إدخال يدوي)</button>`)}
      </div>`;
    document.getElementById('invoiceModal').showModal();
    document.getElementById('btnInvQueueEdari')?.addEventListener('click', async () => {
      try {
        await api(`/admin/delegate-invoices/${id}/queue-edari`, { method: 'POST' });
        toast('أُضيفت للطابور — راجع مزامنة الإداري');
        openInvoice(id);
      } catch (err) { toast(err.message); }
    });
    document.getElementById('btnInvArchiveEdari')?.addEventListener('click', async () => {
      await archiveInvoiceFromPrep(id);
      if (document.getElementById('invoiceModal')?.open) openInvoice(id);
    });
    document.getElementById('btnInvUnarchiveEdari')?.addEventListener('click', async () => {
      await unarchiveInvoiceFromPrep(id);
      if (document.getElementById('invoiceModal')?.open) openInvoice(id);
    });
  } catch (err) { toast(err.message); }
}

function printInvoice(id) {
  const w = window.open('', '_blank', 'width=420,height=680');
  fetch(`/api/admin/invoices/${id}/print`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.text())
    .then((html) => { w.document.write(html); w.document.close(); })
    .catch(() => toast('تعذّر الطباعة'));
}

document.getElementById('btnPrintInvoice')?.addEventListener('click', () => {
  if (activeInvoiceId) printInvoice(activeInvoiceId);
});

document.getElementById('btnDeleteInvoice')?.addEventListener('click', async () => {
  if (!activeInvoiceId) return;
  if (!confirm('حذف هذه الفاتورة من لوحة التحكم ونقطة البيع؟\nحتى لو كانت مرحّلة: تُحذف هنا فقط ولا تُلغى من برنامج الإداري.\nيُعكس المخزون والدين، وتُحذف المرتجعات المرتبطة.')) return;
  try {
    await api(`/admin/invoices/${activeInvoiceId}`, { method: 'DELETE' });
    document.getElementById('invoiceModal').close();
    activeInvoiceId = null;
    toast('تم حذف الفاتورة من الشورجة');
    loadInvoices();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

function productCardHtml(p, opts = {}) {
  const { showAdd = false, showEdit = false, showDelete = false, selected = false } = opts;
  const stock = Number(p.stockQty || 0);
  const stockCls = stock <= 0 ? 'out' : stock <= 5 ? 'low' : '';
  const stockLbl = stock <= 0 ? 'نفد' : `متوفر ${fmt(stock)}`;
  return `
    <article class="prod-card${selected ? ' selected' : ''}" data-barcode="${esc(p.barcode)}">
      ${p.hasOffer ? `<span class="prod-offer">${esc(p.offerName || 'عرض')}</span>` : ''}
      ${p.category ? `<span class="prod-category">${esc(p.category)}</span>` : ''}
      <span class="prod-currency-pill">${p.priced ? currencyLabel(p.priceCurrency) : 'بدون سعر'}</span>
      <div class="prod-name">${esc(p.name)}</div>
      <div class="prod-barcode">${esc(p.barcode)}</div>
      <div class="prod-meta">
        <span class="prod-price" dir="ltr">${productPriceLabel(p)}</span>
        <span class="prod-stock ${stockCls}">${stockLbl}</span>
      </div>
      ${showAdd || showEdit || showDelete ? `
      <div class="prod-card-actions">
        ${showAdd ? `<button type="button" class="btn btn-primary btn-add-price" data-barcode="${esc(p.barcode)}">${selected ? '✓ مضاف' : '+ إضافة'}</button>` : ''}
        ${showEdit ? `<button type="button" class="btn btn-secondary btn-edit-card" data-barcode="${esc(p.barcode)}">تعديل</button>` : ''}
        ${showDelete ? `<button type="button" class="btn btn-danger btn-delete-card" data-id="${p.id}">حذف</button>` : ''}
      </div>` : ''}
    </article>`;
}

function categoryIcon(name) {
  return CATEGORY_ICONS[name] || CATEGORY_ICONS.default;
}

function buildCategoryCatalog(products) {
  const map = new Map();
  for (const p of products) {
    const cat = p.category || 'بدون قسم';
    map.set(cat, (map.get(cat) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ar'))
    .map(([name, count]) => ({ name, count }));
}

async function loadCategoryCatalog() {
  try {
    const data = await api('/admin/products/categories');
    const stats = data.categories || [];
    categoryCatalog = stats.map((c) => ({
      name: c.name || 'بدون قسم',
      count: Number(c.count || 0),
      pricedCount: Number(c.pricedCount || 0),
      key: c.name ? c.name : '__none__'
    }));
  } catch {
    categoryCatalog = buildCategoryCatalog(allProductsCache).map((c) => ({
      ...c,
      key: c.name === 'بدون قسم' ? '__none__' : c.name,
      pricedCount: 0
    }));
  }
  fillCategoryOptions();
}

function fillCategoryOptions() {
  const names = [
    ...extraCategories,
    ...categoryCatalog.map((c) => c.name).filter((n) => n && n !== 'بدون قسم')
  ];
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ar'));
  const list = document.getElementById('categoryOptions');
  if (list) list.innerHTML = unique.map((n) => `<option value="${esc(n)}"></option>`).join('');
  const assign = document.getElementById('priceAssignCategory');
  if (assign) {
    const current = assign.value;
    assign.innerHTML = `<option value="">— اختر قسماً —</option>`
      + unique.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (current && unique.includes(current)) assign.value = current;
  }
}

function renderCategoryBar(barId, activeCategory, onSelect) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  const total = categoryCatalog.reduce((s, c) => s + c.count, 0);
  const chips = [
    { name: '', label: 'الكل', count: total, icon: '🏷️' },
    ...categoryCatalog.map((c) => ({
      name: c.name === 'بدون قسم' ? '__none__' : c.name,
      label: c.name,
      count: c.count,
      icon: categoryIcon(c.name)
    }))
  ];
  bar.innerHTML = chips.map((c) => {
    const isActive = (activeCategory || '') === (c.name || '');
    return `
      <button type="button" class="category-chip${isActive ? ' active' : ''}" data-category="${esc(c.name)}">
        <span class="chip-ico">${c.icon}</span>
        <span>${esc(c.label)}</span>
        <span class="chip-count">${c.count}</span>
      </button>`;
  }).join('');

  bar.querySelectorAll('.category-chip').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.category || ''));
  });
}

function openProductView(p) {
  viewingProduct = p;
  document.getElementById('productViewDetail').innerHTML = `
    <h2>${esc(p.name)}</h2>
    <div class="product-detail-grid">
      <div class="detail-item"><label>الباركود</label><strong dir="ltr">${esc(p.barcode)}</strong></div>
      <div class="detail-item"><label>سعر الجملة</label><strong dir="ltr">${fmtPrice(p.costPrice || 0, p.priceCurrency)}</strong></div>
      <div class="detail-item"><label>سعر البيع</label><strong dir="ltr">${productPriceLabel(p)}</strong></div>
      <div class="detail-item"><label>المخزون</label><strong dir="ltr">${fmt(p.stockQty)}</strong></div>
      <div class="detail-item"><label>القسم</label><strong>${esc(p.category || '—')}</strong></div>
      <div class="detail-item"><label>الوحدة</label><strong>${esc(p.unit || 'قطعة')}</strong></div>
      <div class="detail-item"><label>SKU</label><strong dir="ltr">${esc(p.sku || '—')}</strong></div>
      ${p.hasOffer ? `<div class="detail-item"><label>العرض</label><strong>${esc(p.offerName)} — ${fmt(p.originalPrice)}</strong></div>` : ''}
    </div>`;
  document.getElementById('productViewModal').showModal();
}

function setProductViewMode(mode) {
  productViewMode = mode;
  document.querySelectorAll('.view-toggle-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.getElementById('prodGrid')?.classList.toggle('hidden', mode !== 'grid');
  document.getElementById('productTableWrap')?.classList.toggle('hidden', mode !== 'table');
}

function renderProductGrid(products, containerId, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!products.length) {
    el.innerHTML = '<div class="prod-empty">لا توجد منتجات مطابقة</div>';
    return;
  }
  el.innerHTML = products.map((p) => productCardHtml(p, {
    ...opts,
    selected: opts.showAdd && priceSelection.has(p.barcode)
  })).join('');

  el.querySelectorAll('.prod-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const p = products.find((x) => x.barcode === card.dataset.barcode);
      if (p) openProductView(p);
    });
  });

  el.querySelectorAll('.btn-add-price').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = products.find((x) => x.barcode === btn.dataset.barcode);
      if (!p) return;
      document.querySelector('.nav[data-view="prices"]')?.click();
      setTimeout(() => {
        document.getElementById('priceBrowseSearch').value = p.barcode;
        loadPriceSheet().then(() => focusPriceCell(p.barcode));
      }, 50);
    });
  });

  el.querySelectorAll('.btn-edit-card').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = products.find((x) => x.barcode === btn.dataset.barcode);
      if (p) openProductModal(p);
    });
  });

  el.querySelectorAll('.btn-delete-card').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = products.find((x) => String(x.id) === btn.dataset.id);
      if (p) deleteProduct(p);
    });
  });
}

function renderProductTable(products) {
  const el = document.getElementById('productTable');
  if (!el) return;
  el.innerHTML = `
    <table id="productsDataTable">
      <thead><tr><th>باركود</th><th>الاسم</th><th>السعر</th><th>العملة</th><th>المخزون</th><th>القسم</th><th></th></tr></thead>
      <tbody>${products.length ? products.map((p) => `
        <tr class="clickable-row" data-barcode="${esc(p.barcode)}">
          <td dir="ltr">${esc(p.barcode)}</td>
          <td>${esc(p.name)}</td>
          <td dir="ltr">${productPriceLabel(p)}</td>
          <td>${p.priced ? currencyLabel(p.priceCurrency) : '—'}</td>
          <td dir="ltr">${fmt(p.stockQty)}</td>
          <td>${esc(p.category)}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-edit-prod" data-barcode="${esc(p.barcode)}">تعديل</button>
            <button type="button" class="btn btn-danger btn-sm btn-delete-prod" data-id="${p.id}">حذف</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty-cell">لا توجد منتجات مطابقة</td></tr>'}
      </tbody>
    </table>`;

  el.querySelectorAll('tr[data-barcode]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const p = products.find((x) => x.barcode === row.dataset.barcode);
      if (p) openProductView(p);
    });
  });

  el.querySelectorAll('.btn-edit-prod').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = products.find((x) => x.barcode === btn.dataset.barcode);
      if (p) openProductModal(p);
    });
  });

  el.querySelectorAll('.btn-delete-prod').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = products.find((x) => String(x.id) === btn.dataset.id);
      if (p) deleteProduct(p);
    });
  });
}

async function fetchProductsList({ q = '', category = '', limit = 500, stock = '', priced = '' } = {}) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (category) params.set('category', category);
  if (stock) params.set('stock', stock);
  if (priced) params.set('priced', priced);
  return api(`/admin/products?${params}`);
}

async function loadProducts() {
  const q = document.getElementById('prodSearch')?.value || '';
  const data = await fetchProductsList({ q, category: prodActiveCategory, limit: 500, stock: prodStockFilter });
  const products = data.products || [];
  const sort = document.getElementById('prodSort')?.value || 'name';
  products.sort((a, b) => {
    if (sort === 'stock') return Number(a.stockQty || 0) - Number(b.stockQty || 0);
    if (sort === 'price') return Number(b.price || 0) - Number(a.price || 0);
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });
  allProductsCache = products;

  if (!q) await loadCategoryCatalog();
  renderCategoryBar('prodCategoryBar', prodActiveCategory, (cat) => {
    prodActiveCategory = cat;
    loadProducts();
  });

  const statsEl = document.getElementById('prodStats');
  if (statsEl) {
    const catLabel = prodActiveCategory === '__none__' ? 'بدون قسم'
      : prodActiveCategory || 'كل الأقسام';
    statsEl.innerHTML = `
      <div class="prod-stat">${esc(catLabel)} · معروض <strong>${products.length}</strong></div>
      <div class="prod-stat">الإجمالي <strong>${data.total ?? products.length}</strong></div>
      <div class="prod-stat">متوفر <strong>${products.filter((p) => Number(p.stockQty) > 5).length}</strong></div>
      <div class="prod-stat warn">منخفض <strong>${products.filter((p) => Number(p.stockQty) > 0 && Number(p.stockQty) <= 5).length}</strong></div>
      <div class="prod-stat danger">نافد <strong>${products.filter((p) => Number(p.stockQty) <= 0).length}</strong></div>`;
  }

  renderProductGrid(products, 'prodGrid', { showEdit: true, showDelete: true });
  renderProductTable(products);
  setProductViewMode(productViewMode);
}

async function loadPriceSheet() {
  const q = document.getElementById('priceBrowseSearch')?.value || '';
  const data = await fetchProductsList({
    q,
    category: priceBrowseActiveCategory,
    priced: priceSheetFilter,
    limit: 10000
  });
  priceSheetRows = data.products || [];
  await loadCategoryCatalog();
  renderPriceCategoryList();
  renderPriceSheet();
}

function renderPriceCategoryList() {
  const el = document.getElementById('priceCategoryList');
  if (!el) return;
  const total = categoryCatalog.reduce((s, c) => s + c.count, 0);
  const extra = [...extraCategories]
    .filter((name) => !categoryCatalog.some((c) => c.name === name))
    .map((name) => ({ name, count: 0, pricedCount: 0, key: name }));
  const items = [
    { name: 'الكل', count: total, pricedCount: 0, key: '' },
    ...categoryCatalog,
    ...extra
  ];
  el.innerHTML = items.map((c) => {
    const active = (priceBrowseActiveCategory || '') === (c.key || '');
    const priced = c.key && c.pricedCount != null
      ? `<span class="cat-priced">${c.pricedCount} مسعّر</span>`
      : '';
    return `<button type="button" class="price-cat-item${active ? ' active' : ''}" data-category="${esc(c.key)}">
      <span>${esc(c.name)}</span>
      ${priced}
      <span class="cat-count">${c.count}</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.price-cat-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (priceSheetDirty.size && !confirm('تغيير القسم يُخفي الجدول الحالي. المتابعة بدون حفظ؟')) return;
      priceBrowseActiveCategory = btn.dataset.category || '';
      priceSheetSelected.clear();
      loadPriceSheet();
    });
  });
}

function mergedSheetProduct(p) {
  const patch = priceSheetDirty.get(p.barcode) || {};
  const price = patch.price != null ? Number(patch.price) : Number(p.price || 0);
  const category = patch.category != null ? patch.category : (p.category || '');
  const name = patch.name != null ? patch.name : p.name;
  const priceCurrency = patch.priceCurrency || p.priceCurrency || 'iqd';
  return {
    ...p,
    name,
    category,
    price,
    priceCurrency,
    priced: price > 0
  };
}

function renderPriceSheet() {
  const tbody = document.getElementById('priceSelectionBody');
  const hint = document.getElementById('priceSelectionHint');
  const meta = document.getElementById('priceSheetMeta');
  const publishBtn = document.getElementById('btnPublishPrices');
  if (!tbody) return;
  const rows = priceSheetRows.map(mergedSheetProduct);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">لا توجد منتجات مطابقة — غيّر القسم أو البحث</td></tr>';
  } else {
    tbody.innerHTML = rows.map((p, i) => {
      const dirty = priceSheetDirty.has(p.barcode);
      const checked = priceSheetSelected.has(p.barcode);
      const cats = [
        ...extraCategories,
        ...categoryCatalog.map((c) => c.name).filter((n) => n && n !== 'بدون قسم')
      ];
      const uniqueCats = [...new Set(cats)].sort((a, b) => a.localeCompare(b, 'ar'));
      const catOpts = `<option value="">بدون قسم</option>`
        + uniqueCats.map((n) => `<option value="${esc(n)}"${p.category === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
      return `<tr class="${dirty ? 'dirty' : ''}${p.priced ? '' : ' unpriced'}" data-barcode="${esc(p.barcode)}" data-row="${i + 1}">
        <td class="sheet-rownum">${i + 1}</td>
        <td class="sheet-check"><input type="checkbox" class="sheet-select" tabindex="-1" ${checked ? 'checked' : ''}></td>
        <td class="sheet-text" dir="ltr">${esc(p.barcode)}</td>
        <td class="sheet-text sheet-name">${esc(p.name)}</td>
        <td><select class="sheet-cell" data-field="category" tabindex="-1">${catOpts}</select></td>
        <td class="sheet-price"><input class="sheet-cell sheet-nav" data-field="price" type="number" min="0" step="any" inputmode="decimal" dir="ltr" value="${p.priced || dirty ? p.price || '' : ''}" placeholder=""></td>
        <td class="sheet-currency"><select class="sheet-cell sheet-nav" data-field="priceCurrency">
            <option value="iqd"${p.priceCurrency === 'usd' ? '' : ' selected'}>دينار</option>
            <option value="usd"${p.priceCurrency === 'usd' ? ' selected' : ''}>دولار</option>
          </select></td>
        <td><span class="sheet-status ${p.priced ? 'ok' : 'miss'}">${p.priced ? 'مسعّر' : 'بدون سعر'}</span></td>
      </tr>`;
    }).join('');
  }
  if (hint) hint.classList.toggle('hidden', false);
  if (meta) {
    const priced = rows.filter((p) => p.priced).length;
    meta.textContent = `${rows.length} صف · مسعّر ${priced} · بدون سعر ${rows.length - priced} · Enter للصف التالي · Ctrl+S حفظ`;
  }
  if (publishBtn) publishBtn.disabled = !priceSheetSelected.size;
  updatePriceSheetDirtyUi();
  const selectAll = document.getElementById('priceSheetSelectAll');
  if (selectAll) {
    selectAll.checked = rows.length > 0 && rows.every((p) => priceSheetSelected.has(p.barcode));
  }
}

function syncSheetFormulaBar(el) {
  const ref = document.getElementById('sheetCellRef');
  const fx = document.getElementById('sheetFormulaInput');
  const tr = el?.closest?.('tr[data-barcode]');
  if (!ref || !fx) return;
  if (!tr || !el?.dataset?.field) {
    ref.textContent = '—';
    if (document.activeElement !== fx) fx.value = '';
    return;
  }
  const row = tr.dataset.row || '';
  const col = el.dataset.field === 'price' ? 'السعر' : el.dataset.field === 'priceCurrency' ? 'العملة' : el.dataset.field;
  ref.textContent = `${col} ${row}`;
  if (document.activeElement !== fx) fx.value = el.value || '';
}

function fillPriceDown() {
  const body = document.getElementById('priceSelectionBody');
  const active = (lastSheetNavEl?.isConnected && lastSheetNavEl) || document.activeElement;
  const tr = active?.closest?.('tr[data-barcode]') || body?.querySelector('tr.sheet-focus');
  if (!tr) {
    toast('قف على خلية السعر أولاً ثم اضغط تعبئة للأسفل');
    return;
  }
  const priceEl = tr.querySelector('[data-field="price"]');
  const curEl = tr.querySelector('[data-field="priceCurrency"]');
  const price = priceEl?.value ?? '';
  const currency = curEl?.value || 'iqd';
  const rows = [...body.querySelectorAll('tr[data-barcode]')];
  const start = rows.indexOf(tr);
  const targets = priceSheetSelected.size > 1
    ? rows.filter((r) => priceSheetSelected.has(r.dataset.barcode) && r !== tr)
    : rows.slice(start + 1);
  if (!targets.length) {
    toast('لا توجد صفوف تحت هذا الصف');
    return;
  }
  let n = 0;
  for (const row of targets) {
    const pInput = row.querySelector('[data-field="price"]');
    const cInput = row.querySelector('[data-field="priceCurrency"]');
    if (pInput) {
      pInput.value = price;
      markPriceSheetDirty(row.dataset.barcode, 'price', price === '' ? 0 : Number(price));
    }
    if (cInput) {
      cInput.value = currency;
      markPriceSheetDirty(row.dataset.barcode, 'priceCurrency', currency);
    }
    n += 1;
  }
  toast(`تم نسخ السعر والعملة إلى ${n} صف`);
}

function updatePriceSheetDirtyUi() {
  const n = priceSheetDirty.size;
  const badge = document.getElementById('priceSheetDirty');
  const saveBtn = document.getElementById('btnSavePriceSheet');
  if (badge) {
    badge.textContent = `${n} تعديلات غير محفوظة`;
    badge.classList.toggle('hidden', n === 0);
  }
  if (saveBtn) saveBtn.disabled = n === 0 || priceSheetSaving;
}

function markPriceSheetDirty(barcode, field, value) {
  const row = priceSheetRows.find((p) => p.barcode === barcode);
  if (!row) return;
  const patch = { ...(priceSheetDirty.get(barcode) || {}) };
  patch[field] = value;
  const origPrice = Number(row.price || 0);
  const origName = row.name || '';
  const origCat = row.category || '';
  const origCur = row.priceCurrency || 'iqd';
  const nextPrice = patch.price != null ? Number(patch.price || 0) : origPrice;
  const nextName = patch.name != null ? patch.name : origName;
  const nextCat = patch.category != null ? patch.category : origCat;
  const nextCur = patch.priceCurrency || origCur;
  const unchanged = nextName === origName
    && nextCat === origCat
    && nextCur === origCur
    && nextPrice === origPrice;
  if (unchanged) priceSheetDirty.delete(barcode);
  else priceSheetDirty.set(barcode, patch);
  const tr = document.querySelector(`#priceSelectionBody tr[data-barcode="${CSS.escape(barcode)}"]`);
  tr?.classList.toggle('dirty', priceSheetDirty.has(barcode));
  const status = tr?.querySelector('.sheet-status');
  if (status) {
    const priced = nextPrice > 0;
    status.textContent = priced ? 'مسعّر' : 'بدون سعر';
    status.classList.toggle('ok', priced);
    status.classList.toggle('miss', !priced);
  }
  updatePriceSheetDirtyUi();
}

function selectedSheetBarcodes() {
  return [...priceSheetSelected];
}

async function savePriceSheet() {
  const items = [...priceSheetDirty.entries()].map(([barcode, patch]) => ({ barcode, ...patch }));
  if (!items.length) return true;
  priceSheetSaving = true;
  updatePriceSheetDirtyUi();
  try {
    await api('/admin/products/bulk-patch', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
    priceSheetDirty.clear();
    toast(`تم حفظ ${items.length} منتج`);
    await loadPriceSheet();
    return true;
  } catch (err) {
    toast(err.message || 'فشل حفظ الأسعار');
    return false;
  } finally {
    priceSheetSaving = false;
    updatePriceSheetDirtyUi();
  }
}

function focusPriceCell(barcode) {
  const tr = document.querySelector(`#priceSelectionBody tr[data-barcode="${CSS.escape(barcode)}"]`);
  if (!tr) return false;
  tr.scrollIntoView({ block: 'center' });
  document.querySelectorAll('#priceSelectionBody tr').forEach((r) => r.classList.remove('sheet-focus'));
  tr.classList.add('sheet-focus');
  const input = tr.querySelector('input[data-field="price"]');
  input?.focus();
  input?.select();
  return true;
}

async function loadPrices() {
  try {
    const fx = await api('/admin/app-settings');
    const fxInput = document.getElementById('usdToIqdInput');
    if (fxInput && fx.settings && !fxInput.matches(':focus')) {
      fxInput.value = fx.settings.usdToIqd || '';
    }
    fillEdariDbSettings(fx.settings);
  } catch { /* ignore */ }
  const data = await api('/admin/prices/packages');
  document.getElementById('packagesList').innerHTML = (data.packages || []).length
    ? `<div class="packages-list">${(data.packages || []).map((p) => `
        <div class="package-row">
          <strong>v${p.version}</strong>
          <span>${p.itemCount} منتج</span>
          <span class="muted">${esc(p.createdAt || '')}</span>
          <span class="muted">${esc(p.branchName || 'الإدارة')}</span>
        </div>`).join('')}</div>`
    : '<p class="empty-cell">لا توجد حزم أسعار بعد — احفظ الأسعار ثم ارفعها للفروع</p>';
  await loadPriceSheet();
  document.getElementById('priceBarcode')?.focus();
}

async function addPriceItem() {
  const input = document.getElementById('priceBarcode');
  const code = input?.value.trim();
  if (!code) { toast('أدخل الباركود'); return; }
  if (focusPriceCell(code)) {
    input.value = '';
    return;
  }
  try {
    let product = null;
    try {
      const local = await api(`/admin/products/barcode/${encodeURIComponent(code)}`);
      product = local.product;
    } catch { /* fetch from edari */ }
    if (!product) {
      product = await saveProductFromEdari(code);
    }
    priceBrowseActiveCategory = product.category || '__none__';
    document.getElementById('priceBrowseSearch').value = product.barcode;
    await loadPriceSheet();
    if (!focusPriceCell(product.barcode)) {
      toast('تم جلب المادة — ابحث عنها في الجدول');
    }
    input.value = '';
    input.focus();
  } catch (err) {
    toast(err.message || 'المادة غير موجودة');
  }
}

function openProductModal(product = null) {
  editingProduct = product;
  fillCategoryOptions();
  document.getElementById('productModalTitle').textContent = product ? 'تعديل منتج' : 'منتج جديد';
  document.getElementById('prodBarcode').value = product?.barcode || '';
  document.getElementById('prodBarcode').readOnly = !!product;
  document.getElementById('prodName').value = product?.name || '';
  document.getElementById('prodCostPrice').value = product?.costPrice || '';
  document.getElementById('prodPrice').value = product?.priced ? (product.price ?? '') : '';
  document.getElementById('prodPriceCurrency').value = product?.priceCurrency || 'iqd';
  document.getElementById('prodStock').value = product?.stockQty ?? 0;
  document.getElementById('prodFormCategory').value = product?.category || '';
  document.getElementById('prodUnit').value = product?.unit || 'قطعة';
  document.getElementById('btnDeleteProduct')?.classList.toggle('hidden', !product?.id);
  document.getElementById('productModal').showModal();
}

async function deleteProduct(product) {
  if (!product?.id) return;
  if (!confirm(`حذف المنتج «${product.name}»؟\nسيُخفى من القوائم ويبقى في الفواتير السابقة.`)) return;
  try {
    await api(`/admin/products/${product.id}`, { method: 'DELETE' });
    if (priceSheetSelected.has(product.barcode)) priceSheetSelected.delete(product.barcode);
    priceSheetDirty.delete(product.barcode);
    document.getElementById('productModal')?.close();
    document.getElementById('productViewModal')?.close();
    toast('تم حذف المنتج');
    loadProducts();
    loadDashboard();
    if (!document.getElementById('viewPrices')?.classList.contains('hidden')) {
      loadPriceSheet();
    }
  } catch (err) {
    toast(err.message || 'فشل حذف المنتج');
  }
}

function fillProductForm(product) {
  if (!product) return;
  document.getElementById('prodBarcode').value = product.barcode || '';
  document.getElementById('prodName').value = product.name || '';
  document.getElementById('prodCostPrice').value = product.costPrice || '';
  document.getElementById('prodPrice').value = product.priced ? (product.price ?? '') : '';
  if (document.getElementById('prodPriceCurrency')) {
    document.getElementById('prodPriceCurrency').value = product.priceCurrency || 'iqd';
  }
  document.getElementById('prodStock').value = product.stockQty ?? 0;
  document.getElementById('prodFormCategory').value = product.category || '';
  document.getElementById('prodUnit').value = product.unit || 'قطعة';
}

async function fetchProductFromEdari(code) {
  const c = String(code || '').trim();
  if (!c) throw new Error('أدخل الباركود');

  let liveMaterial = null;
  if (window.edariDesktop?.lookupEdariMaterial) {
    const live = await window.edariDesktop.lookupEdariMaterial(c);
    if (live?.ok && live.material) {
      liveMaterial = live.material;
    } else if (live?.error && !live.ok) {
      throw new Error(live.error);
    }
  }

  if (liveMaterial) {
    const data = await api('/admin/products/edari-cache', {
      method: 'POST',
      body: JSON.stringify({ material: liveMaterial })
    });
    return data.product;
  }

  const data = await api(`/admin/products/edari-lookup?code=${encodeURIComponent(c)}`);
  if (!data.product) throw new Error('المادة غير موجودة في الإداري (Edari)');
  return data.product;
}

async function saveProductFromEdari(code, extras = {}) {
  const product = await fetchProductFromEdari(code);
  const data = await api('/admin/products/from-edari', {
    method: 'POST',
    body: JSON.stringify({ ...product, ...extras, barcode: product.barcode })
  });
  return data.product;
}

/** @deprecated use fetchProductFromEdari */
async function fetchProductByBarcode(code) {
  try {
    const data = await api(`/admin/products/barcode/${encodeURIComponent(String(code).trim())}`);
    if (data.product) return data.product;
  } catch { /* fall through */ }
  return fetchProductFromEdari(code);
}

async function refreshProductFormFromAdmin() {
  const input = document.getElementById('prodBarcode');
  const code = input?.value.trim();
  if (!code) {
    toast('أدخل الباركود أولاً');
    input?.focus();
    return;
  }
  const btn = document.getElementById('btnFetchProdBarcode');
  if (btn) btn.disabled = true;
  try {
    const product = await fetchProductFromEdari(code);
    fillProductForm(product);
    toast(`تم جلب من الإداري: ${product.name} · مخزون ${fmt(product.stockQty)} — أدخل سعر البيع يدوياً`);
  } catch (err) {
    toast(err.message || 'فشل جلب المنتج');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function warehouseImportButtons() {
  return document.querySelectorAll('[data-import-edari-warehouse], [data-refresh-edari-warehouse]');
}

function warehouseImportProgressEls() {
  return document.querySelectorAll('#edariImportProgress, #edariImportProgressPrices');
}

function setWarehouseImportProgress(text) {
  warehouseImportProgressEls().forEach((el) => {
    if (text) {
      el.classList.remove('hidden');
      el.textContent = text;
    } else {
      el.classList.add('hidden');
      el.textContent = '';
    }
  });
}

async function importWarehouseProductsFromEdari() {
  const buttons = warehouseImportButtons();
  if ([...buttons].some((b) => b.disabled)) return;

  const useDesktop = !!window.edariDesktop?.fetchEdariWarehouseImportBatch;
  if (!useDesktop) {
    toast('جلب مستودع الشورجة يتطلب تطبيق الإدارة على Windows (ليس المتصفح)', 'err');
    return;
  }

  let total = 0;
  let warehouse = null;
  let storeName = 'محل الشورجه';
  try {
    const st = await window.edariDesktop.getEdariWarehouseImportStatus();
    if (!st?.ok) throw new Error(st?.error || 'تعذر الاتصال بـ Edari');
    total = Number(st.totalInEdari || 0);
    warehouse = st.warehouse || null;
    storeName = warehouse?.name || storeName;
  } catch (err) {
    toast(err.message || 'تعذر الاتصال بالإداري — تأكد من EdariNX', 'err');
    return;
  }

  if (!total) {
    toast(`لا توجد مواد في مستودع «${storeName}»`, 'err');
    return;
  }

  const confirmed = confirm(
    `جلب ${total.toLocaleString('ar-IQ')} منتج من مستودع «${storeName}»؟\n\n` +
    '• تُضاف المواد الجديدة فقط\n' +
    '• يُحدَّث الاسم والباركود والمخزون للمواد الموجودة\n' +
    '• الأسعار التي أدخلتها تبقى كما هي — لا تُحذف\n' +
    '• لا يُحذف أي منتج من اللوحة\n\n' +
    'اضغط OK للمتابعة.'
  );
  if (!confirmed) return;

  buttons.forEach((b) => { b.disabled = true; });
  setWarehouseImportProgress('جاري الجلب من المستودع دون حذف الأسعار...');

  let afterSeq = 0;
  let imported = 0;
  let skipped = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const batch = await window.edariDesktop.fetchEdariWarehouseImportBatch({
        afterSeq,
        limit: 500,
        warehouse
      });
      if (!batch?.ok) throw new Error(batch?.error || 'فشل جلب دفعة من مستودع الشورجة');
      if (batch.products?.length) {
        await api('/admin/products/bulk', {
          method: 'POST',
          body: JSON.stringify({ items: batch.products, fromEdari: true })
        });
      }
      imported += Number(batch.imported || 0);
      skipped += Number(batch.skipped || 0);
      afterSeq = Number(batch.lastSeq || afterSeq);
      hasMore = !!batch.hasMore;
      const pct = total ? Math.min(100, Math.round((imported / total) * 100)) : 0;
      setWarehouseImportProgress(
        `جلب مستودع الشورجة: ${imported.toLocaleString('ar-IQ')} · ${skipped} متخطى · ~${pct}%`
      );
    }

    toast(`تم جلب ${imported.toLocaleString('ar-IQ')} منتج من مستودع «${storeName}» — الأسعار الحالية محفوظة`);
    loadProducts();
    loadDashboard();
    if (!document.getElementById('viewPrices')?.classList.contains('hidden')) {
      loadPriceSheet();
    }
  } catch (err) {
    toast(err.message || 'فشل جلب مستودع الشورجة');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    setWarehouseImportProgress('');
  }
}

document.querySelectorAll('[data-import-edari-warehouse]').forEach((btn) => {
  btn.addEventListener('click', () => importWarehouseProductsFromEdari());
});
document.querySelectorAll('[data-refresh-edari-warehouse]').forEach((btn) => {
  btn.addEventListener('click', () => importWarehouseProductsFromEdari());
});
document.getElementById('btnNewProduct')?.addEventListener('click', () => openProductModal());
document.getElementById('btnProdCancel')?.addEventListener('click', () => {
  document.getElementById('productModal').close();
});
document.getElementById('btnFetchProdBarcode')?.addEventListener('click', refreshProductFormFromAdmin);
document.getElementById('prodBarcode')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !editingProduct) {
    e.preventDefault();
    await refreshProductFormFromAdmin();
  }
});

document.getElementById('productForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        barcode: document.getElementById('prodBarcode').value.trim(),
        name: document.getElementById('prodName').value.trim(),
        costPrice: Number(document.getElementById('prodCostPrice').value || 0),
        price: Number(document.getElementById('prodPrice').value || 0),
        priceCurrency: document.getElementById('prodPriceCurrency')?.value || 'iqd',
        stockQty: Number(document.getElementById('prodStock').value || 0),
        category: document.getElementById('prodFormCategory').value.trim(),
        unit: document.getElementById('prodUnit').value.trim() || 'قطعة'
      })
    });
    document.getElementById('productModal').close();
    toast(editingProduct ? 'تم التحديث' : 'تم إضافة المنتج');
    loadProducts();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

document.getElementById('prodSearch')?.addEventListener('input', debounce(loadProducts, 250));
document.getElementById('prodStockChips')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-prod-stock]');
  if (!chip) return;
  prodStockFilter = chip.dataset.prodStock || '';
  document.querySelectorAll('#prodStockChips .filter-chip').forEach((c) => {
    c.classList.toggle('active', c === chip);
  });
  loadProducts();
});
document.getElementById('prodViewToggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-toggle-btn');
  if (btn) setProductViewMode(btn.dataset.mode);
});
document.getElementById('prodSort')?.addEventListener('change', () => loadProducts());
document.getElementById('btnExportProducts')?.addEventListener('click', () => {
  const table = document.getElementById('productsDataTable');
  if (!table || !window.exportTableCsv) {
    toast('افتح عرض الجدول أولاً ثم صدّر');
    return;
  }
  window.exportTableCsv(table, `products-${Date.now()}.csv`);
});
document.getElementById('btnEditFromView')?.addEventListener('click', () => {
  document.getElementById('productViewModal').close();
  if (viewingProduct) openProductModal(viewingProduct);
});
document.getElementById('btnDeleteFromView')?.addEventListener('click', () => {
  if (viewingProduct) deleteProduct(viewingProduct);
});
document.getElementById('btnDeleteProduct')?.addEventListener('click', () => {
  if (editingProduct) deleteProduct(editingProduct);
});
document.getElementById('priceBrowseSearch')?.addEventListener('input', debounce(() => {
  if (priceSheetDirty.size) {
    toast('احفظ التعديلات قبل البحث');
    return;
  }
  loadPriceSheet();
}, 250));

document.getElementById('csvImport')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const csv = await file.text();
  try {
    const data = await api('/admin/products/import', { method: 'POST', body: JSON.stringify({ csv }) });
    toast(`تم استيراد ${data.count} منتج`);
    loadProducts();
    loadDashboard();
  } catch (err) { toast(err.message); }
  e.target.value = '';
});

function sheetNavCells(row) {
  return [...(row?.querySelectorAll('.sheet-nav') || [])];
}

function focusSheetNav(el) {
  if (!el) return;
  el.focus();
  if (el.select) el.select();
}

function sheetMove(el, dRow, dCol) {
  const row = el.closest('tr');
  if (!row) return;
  const cells = sheetNavCells(row);
  const col = Math.max(0, cells.indexOf(el));
  const rows = [...row.parentElement.querySelectorAll('tr[data-barcode]')];
  const r = rows.indexOf(row);
  if (dRow) {
    const nextRow = rows[r + dRow];
    if (!nextRow) return;
    const nextCells = sheetNavCells(nextRow);
    focusSheetNav(nextCells[col] || nextCells[0]);
    return;
  }
  if (dCol) {
    const target = cells[col + dCol];
    if (target) {
      focusSheetNav(target);
      return;
    }
    const wrapRow = rows[r + (dCol > 0 ? 1 : -1)];
    if (!wrapRow) return;
    const wrapCells = sheetNavCells(wrapRow);
    focusSheetNav(dCol > 0 ? wrapCells[0] : wrapCells[wrapCells.length - 1]);
  }
}

function sheetTab(el, shift) {
  sheetMove(el, 0, shift ? -1 : 1);
}

document.getElementById('priceSelectionBody')?.addEventListener('focusin', (e) => {
  const tr = e.target.closest('tr[data-barcode]');
  document.querySelectorAll('#priceSelectionBody tr').forEach((r) => r.classList.remove('sheet-focus'));
  tr?.classList.add('sheet-focus');
  if (e.target.classList.contains('sheet-nav')) {
    document.querySelectorAll('.sheet-nav-active').forEach((el) => el.classList.remove('sheet-nav-active'));
    lastSheetNavEl = e.target;
    syncSheetFormulaBar(e.target);
  }
});

document.getElementById('priceSelectionBody')?.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-barcode]');
  if (!tr) return;
  if (e.target.closest('input, select, button')) return;
  focusSheetNav(tr.querySelector('[data-field="price"]'));
});

document.getElementById('priceSelectionBody')?.addEventListener('input', (e) => {
  const field = e.target.dataset?.field;
  const tr = e.target.closest('tr[data-barcode]');
  if (!field || !tr || field === 'barcode') return;
  let value = e.target.value;
  if (field === 'price') value = e.target.value === '' ? 0 : Number(e.target.value);
  markPriceSheetDirty(tr.dataset.barcode, field, value);
  if (e.target.classList.contains('sheet-nav')) syncSheetFormulaBar(e.target);
});

document.getElementById('priceSelectionBody')?.addEventListener('change', (e) => {
  const tr = e.target.closest('tr[data-barcode]');
  if (!tr) return;
  if (e.target.classList.contains('sheet-select')) {
    if (e.target.checked) priceSheetSelected.add(tr.dataset.barcode);
    else priceSheetSelected.delete(tr.dataset.barcode);
    const publishBtn = document.getElementById('btnPublishPrices');
    if (publishBtn) publishBtn.disabled = !priceSheetSelected.size;
    return;
  }
  const field = e.target.dataset?.field;
  if (field === 'category' || field === 'priceCurrency') {
    markPriceSheetDirty(tr.dataset.barcode, field, e.target.value);
  }
});

document.getElementById('priceSelectionBody')?.addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el.classList?.contains('sheet-nav')) return;
  if (el.tagName === 'SELECT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    sheetMove(el, e.shiftKey ? -1 : 1, 0);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    sheetMove(el, 1, 0);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    sheetMove(el, -1, 0);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    sheetTab(el, e.shiftKey);
  }
});

document.getElementById('priceSheetSelectAll')?.addEventListener('change', (e) => {
  const on = e.target.checked;
  priceSheetSelected.clear();
  if (on) priceSheetRows.forEach((p) => priceSheetSelected.add(p.barcode));
  document.querySelectorAll('#priceSelectionBody .sheet-select').forEach((cb) => { cb.checked = on; });
  const publishBtn = document.getElementById('btnPublishPrices');
  if (publishBtn) publishBtn.disabled = !priceSheetSelected.size;
});

document.getElementById('priceSheetFilters')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-price-filter]');
  if (!chip) return;
  if (priceSheetDirty.size && !confirm('تصفية الجدول تُخفي تعديلات غير محفوظة. المتابعة؟')) return;
  priceSheetFilter = chip.dataset.priceFilter || '';
  document.querySelectorAll('#priceSheetFilters .filter-chip').forEach((c) => {
    c.classList.toggle('active', c === chip);
  });
  loadPriceSheet();
});

document.getElementById('btnCreateCategory')?.addEventListener('click', () => {
  const input = document.getElementById('newCategoryName');
  const name = input?.value.trim();
  if (!name) { toast('أدخل اسم القسم'); return; }
  extraCategories.add(name);
  input.value = '';
  fillCategoryOptions();
  renderPriceCategoryList();
  const assign = document.getElementById('priceAssignCategory');
  if (assign) assign.value = name;
  toast(`تم إنشاء القسم «${name}» — حدد منتجات ثم اضغط تعيين القسم`);
});

document.getElementById('newCategoryName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('btnCreateCategory')?.click();
  }
});

document.getElementById('btnAssignCategory')?.addEventListener('click', async () => {
  const category = document.getElementById('priceAssignCategory')?.value || '';
  const barcodes = selectedSheetBarcodes();
  if (!barcodes.length) { toast('حدد منتجاً واحداً أو أكثر من الجدول'); return; }
  if (!category) { toast('اختر القسم أولاً'); return; }
  try {
    if (priceSheetDirty.size) await savePriceSheet();
    const data = await api('/admin/products/assign-category', {
      method: 'POST',
      body: JSON.stringify({ barcodes, category })
    });
    extraCategories.add(category);
    priceSheetSelected.clear();
    toast(`تم تعيين ${data.count} منتج إلى «${category}»`);
    await loadPriceSheet();
  } catch (err) {
    toast(err.message || 'فشل تعيين القسم');
  }
});

document.getElementById('btnSavePriceSheet')?.addEventListener('click', () => savePriceSheet());
document.getElementById('btnFillPriceDown')?.addEventListener('click', () => fillPriceDown());

document.getElementById('sheetFormulaInput')?.addEventListener('focus', () => {
  document.querySelectorAll('.sheet-nav-active').forEach((el) => el.classList.remove('sheet-nav-active'));
  lastSheetNavEl?.classList.add('sheet-nav-active');
  if (lastSheetNavEl) syncSheetFormulaBar(lastSheetNavEl);
});

document.getElementById('sheetFormulaInput')?.addEventListener('blur', () => {
  document.querySelectorAll('.sheet-nav-active').forEach((el) => el.classList.remove('sheet-nav-active'));
});

document.getElementById('sheetFormulaInput')?.addEventListener('input', () => {
  const el = lastSheetNavEl;
  if (!el?.isConnected) return;
  const fx = document.getElementById('sheetFormulaInput');
  const field = el.dataset.field;
  const raw = fx?.value ?? '';
  if (field === 'price') {
    el.value = raw;
    const tr = el.closest('tr[data-barcode]');
    if (tr) markPriceSheetDirty(tr.dataset.barcode, 'price', raw === '' ? 0 : Number(raw));
  } else if (field === 'priceCurrency') {
    const next = /usd|دولار|dollar|\$/i.test(raw) ? 'usd' : 'iqd';
    el.value = next;
    const tr = el.closest('tr[data-barcode]');
    if (tr) markPriceSheetDirty(tr.dataset.barcode, 'priceCurrency', next);
  }
});

document.getElementById('sheetFormulaInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (lastSheetNavEl?.isConnected) sheetMove(lastSheetNavEl, e.shiftKey ? -1 : 1, 0);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    lastSheetNavEl?.focus();
  }
});

document.addEventListener('keydown', (e) => {
  if (document.getElementById('viewPrices')?.classList.contains('hidden')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    savePriceSheet();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    if (!e.target?.closest?.('#priceSheetTable, #excelFormulaBar')) return;
    e.preventDefault();
    fillPriceDown();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (!priceSheetDirty.size) return;
  e.preventDefault();
  e.returnValue = '';
});

document.getElementById('btnAddPriceItem')?.addEventListener('click', () => addPriceItem());
document.getElementById('priceBarcode')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    await addPriceItem();
  }
});

document.getElementById('btnPublishPrices')?.addEventListener('click', async () => {
  const barcodes = selectedSheetBarcodes();
  if (!barcodes.length) { toast('حدد منتجاً واحداً على الأقل'); return; }
  if (priceSheetDirty.size) {
    const ok = await savePriceSheet();
    if (!ok) return;
  }
  if (!confirm(`رفع المنتجات المسعّرة فقط من المحدد إلى الفروع؟`)) return;
  try {
    const data = await api('/admin/prices/publish', {
      method: 'POST',
      body: JSON.stringify({ barcodes, note: `تحديث ${barcodes.length} منتج` })
    });
    let msg = `تم — الإصدار v${data.version} · ${data.itemCount} منتج مسعّر`;
    if (data.missing?.length) msg += ` · لم يُعثر على: ${data.missing.join(', ')}`;
    if (data.skippedUnpriced?.length) msg += ` · تُرك بلا سعر: ${data.skippedUnpriced.length}`;
    document.getElementById('publishResult').textContent = msg;
    toast('تم رفع المنتجات المحددة');
    priceSheetSelected.clear();
    loadPrices();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

document.getElementById('btnPublishPriced')?.addEventListener('click', async () => {
  if (priceSheetDirty.size) {
    const ok = await savePriceSheet();
    if (!ok) return;
  }
  if (!confirm('رفع كل المنتجات المسعّرة إلى نقاط البيع؟')) return;
  try {
    const priced = await fetchProductsList({ priced: 'priced', limit: 500000 });
    const barcodes = (priced.products || []).map((p) => p.barcode);
    if (!barcodes.length) { toast('لا توجد منتجات مسعّرة'); return; }
    const data = await api('/admin/prices/publish', {
      method: 'POST',
      body: JSON.stringify({ barcodes, note: `رفع ${barcodes.length} منتج مسعّر` })
    });
    document.getElementById('publishResult').textContent = `تم — الإصدار v${data.version} · ${data.itemCount} منتج`;
    toast('تم رفع المنتجات المسعّرة');
    loadPrices();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

async function loadAccounts() {
  const q = document.getElementById('accSearch').value || '';
  const data = await api(`/admin/accounts?q=${encodeURIComponent(q)}${scopeQuery()}`);
  document.getElementById('accountTable').innerHTML = `
    <table>
      <thead><tr><th>الرمز</th><th>الاسم</th><th>العملة</th><th>الهاتف</th><th>الرصيد / الدين</th><th>حد الائتمان</th><th>الإداري</th></tr></thead>
      <tbody>${(data.accounts||[]).map((a) => `
        <tr class="clickable-row" data-account-id="${a.id}">
          <td>${esc(a.code)}</td>
          <td>${esc(a.name)}</td>
          <td>${currencyLabel(a.currency)}</td>
          <td dir="ltr">${esc(a.phone)}</td>
          <td dir="ltr" style="color:var(--danger);font-weight:700">${fmtPrice(a.balance, a.currency)}</td>
          <td dir="ltr">${fmtPrice(a.creditLimit, a.currency)}</td>
          <td>${edariSyncLabel(a.edariSyncStatus, a.edariSyncError)}${a.edariNum ? `<br><small dir="ltr">${esc(a.edariNum)}</small>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="7">لا توجد حسابات</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('accountTable').querySelectorAll('[data-account-id]').forEach((row) => {
    row.addEventListener('click', () => openLedger(Number(row.dataset.accountId)));
  });
}

async function openLedger(id) {
  try {
    activeAccountId = id;
    const data = await api(`/admin/accounts/${id}`);
    const a = data.account;
    const entries = data.journal?.entries || data.journal || [];
    const pays = data.payments || [];
    document.getElementById('ledgerDetail').innerHTML = `
      <h2>كشف حساب — ${esc(a.name)}</h2>
      <div class="ledger-summary">
        <span>الرمز: <strong>${esc(a.code)}</strong></span>
        <span>العملة: <strong>${currencyLabel(a.currency)}</strong></span>
        <span>الدين: <strong dir="ltr" style="color:var(--danger)">${fmtPrice(a.balance, a.currency)}</strong></span>
        <span>حد الائتمان: <strong dir="ltr">${fmtPrice(a.creditLimit, a.currency)}</strong></span>
        <span>الإداري: <strong>${edariSyncLabel(a.edariSyncStatus, a.edariSyncError)}</strong>${a.edariNum ? ` <small dir="ltr">(${esc(a.edariNum)})</small>` : ''}</span>
      </div>
      <h3 style="font-size:0.95rem;margin:12px 0 8px">آخر التسديدات</h3>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>الرقم</th><th>المبلغ</th><th>التاريخ</th><th>الإداري</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody>${pays.length ? pays.map((p) => `
            <tr>
              <td>${esc(p.paymentNo)}</td>
              <td dir="ltr">${fmtPrice(p.amount, a.currency)}</td>
              <td>${esc(p.paymentDate)}</td>
              <td>${edariSyncLabel(p.edariSyncStatus, p.edariSyncError)}</td>
              <td>${esc(p.notes)}</td>
              <td><button type="button" class="btn btn-danger btn-sm" data-delete-payment="${p.id}" title="حذف التسديد">حذف</button></td>
            </tr>
          `).join('') : '<tr><td colspan="6">لا توجد تسديدات</td></tr>'}
          </tbody>
        </table>
      </div>
      <h3 style="font-size:0.95rem;margin:12px 0 8px">سجل الحركات</h3>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>الرقم</th><th>النوع</th><th>المبلغ</th><th>الوصف</th><th>التاريخ</th><th></th></tr></thead>
          <tbody>${entries.length ? entries.map((e) => `
            <tr>
              <td>${esc(e.entryNo)}</td>
              <td>${esc(journalKindLabel(e.kind))}</td>
              <td dir="ltr">${fmtPrice(e.amount, a.currency)}</td>
              <td>${esc(e.description)}</td>
              <td>${esc(e.entryDate)}</td>
              <td><button type="button" class="btn btn-danger btn-sm" data-delete-journal="${e.id}" title="حذف من الشورجة فقط">حذف</button></td>
            </tr>
          `).join('') : '<tr><td colspan="6">لا توجد حركات</td></tr>'}
          </tbody>
        </table>
      </div>`;
    document.getElementById('ledgerModal').showModal();
    document.getElementById('ledgerDetail').querySelectorAll('[data-delete-payment]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('حذف هذا التسديد من لوحة التحكم فقط؟\nيُعكس رصيد الحساب هنا — ولا يُلغى من الإداري إن كان مرحّلاً.')) return;
        try {
          await api(`/admin/payments/${btn.dataset.deletePayment}`, { method: 'DELETE' });
          toast('تم حذف التسديد');
          openLedger(activeAccountId);
          loadPayments();
          loadAccounts();
          loadDashboard();
        } catch (err) { toast(err.message); }
      });
    });
    document.getElementById('ledgerDetail').querySelectorAll('[data-delete-journal]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('حذف هذا القيد من لوحة التحكم فقط؟\nحتى القيود المرحّلة تُحذف هنا ولا تُلغى من برنامج الإداري.')) return;
        try {
          await api(`/admin/journal/${btn.dataset.deleteJournal}`, { method: 'DELETE' });
          toast('تم حذف القيد من الشورجة');
          openLedger(activeAccountId);
          loadJournal();
          loadAccounts();
        } catch (err) { toast(err.message); }
      });
    });
  } catch (err) { toast(err.message); }
}

document.getElementById('btnEditAccount')?.addEventListener('click', async () => {
  if (!activeAccountId) return;
  try {
    const data = await api(`/admin/accounts/${activeAccountId}`);
    const a = data.account;
    document.getElementById('accFormId').value = String(a.id);
    document.getElementById('accountModalTitle').textContent = 'تعديل الحساب';
    document.getElementById('accFormName').value = a.name || '';
    document.getElementById('accFormPhone').value = a.phone || '';
    document.getElementById('accFormAddress').value = a.address || '';
    document.getElementById('accFormCredit').value = a.creditLimit || 0;
    document.getElementById('accFormNotes').value = a.notes || '';
    document.getElementById('accFormCurrency').value = a.currency || 'iqd';
    document.getElementById('ledgerModal')?.close();
    document.getElementById('accountModal').showModal();
  } catch (err) { toast(err.message); }
});

document.getElementById('btnDeleteAccount')?.addEventListener('click', async () => {
  if (!activeAccountId) return;
  if (!confirm('حذف هذا الحساب من لوحة التحكم ونقطة البيع مع كل فواتيره وتسديداته وقيوده؟\nحتى البيانات المرحّلة تُحذف هنا فقط ولا تُلغى من برنامج الإداري.')) return;
  try {
    await api(`/admin/accounts/${activeAccountId}`, { method: 'DELETE' });
    document.getElementById('ledgerModal').close();
    activeAccountId = null;
    toast('تم حذف الحساب من الشورجة');
    loadAccounts();
    loadInvoices();
    loadPayments();
    loadJournal();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

document.getElementById('accSearch')?.addEventListener('input', debounce(loadAccounts, 250));

document.getElementById('btnSaveFxRate')?.addEventListener('click', async () => {
  try {
    const data = await api('/admin/app-settings', {
      method: 'PUT',
      body: JSON.stringify({ usdToIqd: Number(document.getElementById('usdToIqdInput')?.value || 0) })
    });
    toast(`تم حفظ سعر الصرف: 1 دولار = ${fmt(data.settings.usdToIqd)} دينار`);
  } catch (err) { toast(err.message); }
});

document.getElementById('edariAliasInput')?.addEventListener('input', updateEdariDbPathHint);
document.getElementById('edariDataRootInput')?.addEventListener('input', updateEdariDbPathHint);

document.getElementById('btnSaveEdariDb')?.addEventListener('click', async () => {
  try {
    const conn = currentEdariConn();
    if (!conn.alias) {
      toast('أدخل سنة القاعدة مثل 2026');
      return;
    }
    const data = await api('/admin/app-settings', {
      method: 'PUT',
      body: JSON.stringify({
        edariAlias: conn.alias,
        edariDataRoot: conn.dataRoot
      })
    });
    fillEdariDbSettings(data.settings);
    toast(`تم حفظ قاعدة الإداري: ${data.settings.edariAlias}`);
  } catch (err) { toast(err.message); }
});

document.getElementById('btnTestEdariDb')?.addEventListener('click', async () => {
  if (!window.edariDesktop?.getEdariWarehouseImportStatus) {
    toast('اختبار الاتصال يتطلب تطبيق الإدارة على Windows');
    return;
  }
  try {
    const conn = currentEdariConn();
    const data = await api('/admin/app-settings', {
      method: 'PUT',
      body: JSON.stringify({
        edariAlias: conn.alias,
        edariDataRoot: conn.dataRoot
      })
    });
    fillEdariDbSettings(data.settings);
    const st = await window.edariDesktop.getEdariWarehouseImportStatus();
    if (!st?.ok) throw new Error(st?.error || 'تعذر الاتصال بقاعدة الإداري');
    const name = st.warehouse?.name || 'المستودع';
    toast(`الاتصال ناجح — قاعدة ${data.settings.edariAlias} · ${name} · ${Number(st.totalInEdari || 0)} مادة`);
  } catch (err) { toast(err.message || 'فشل اختبار الإداري'); }
});

document.getElementById('btnNewAccount').addEventListener('click', () => {
  document.getElementById('accountForm').reset();
  document.getElementById('accFormId').value = '';
  document.getElementById('accountModalTitle').textContent = 'حساب جديد';
  document.getElementById('accFormCredit').value = '0';
  document.getElementById('accFormCurrency').value = 'iqd';
  document.getElementById('accountModal').showModal();
});

document.getElementById('btnAccCancel')?.addEventListener('click', () => {
  document.getElementById('accountModal').close();
});

document.getElementById('accountForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = document.getElementById('accFormId').value;
    const payload = {
      name: document.getElementById('accFormName').value.trim(),
      phone: document.getElementById('accFormPhone').value.trim(),
      address: document.getElementById('accFormAddress').value.trim(),
      creditLimit: Number(document.getElementById('accFormCredit').value || 0),
      notes: document.getElementById('accFormNotes').value.trim(),
      currency: document.getElementById('accFormCurrency').value || 'iqd',
      accountScope: adminAppScope()
    };
    if (id) {
      await api(`/admin/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('تم تحديث الحساب');
    } else {
      await api('/admin/accounts', { method: 'POST', body: JSON.stringify(payload) });
      toast('تم إنشاء الحساب');
    }
    document.getElementById('accountModal').close();
    loadAccounts();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

async function loadPayments() {
  const acc = await api(`/admin/accounts?limit=500${scopeQuery()}`);
  const opts = (acc.accounts||[]).map((a) =>
    `<option value="${a.id}" data-balance="${a.balance}" data-currency="${a.currency || 'iqd'}">${esc(a.name)} — ${currencyLabel(a.currency)} — دين: ${fmtPrice(a.balance, a.currency)}</option>`
  ).join('');
  document.getElementById('payAcc').innerHTML = opts;
  const payParams = new URLSearchParams({ limit: '400' });
  const scope = adminAppScope();
  if (scope === 'warehouse' || scope === 'delegate') payParams.set('scope', scope);
  const from = document.getElementById('payFrom')?.value || '';
  const to = document.getElementById('payTo')?.value || '';
  if (from) payParams.set('from', from);
  if (to) payParams.set('to', to);
  const pays = await api(`/admin/payments?${payParams}`);
  let rows = pays.payments || [];
  const q = (document.getElementById('paySearch')?.value || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((p) =>
      String(p.paymentNo || '').toLowerCase().includes(q) ||
      String(p.accountName || '').toLowerCase().includes(q) ||
      String(p.notes || '').toLowerCase().includes(q)
    );
  }
  const method = document.getElementById('payMethodFilter')?.value || '';
  if (method) rows = rows.filter((p) => p.method === method);
  const countEl = document.getElementById('payResultCount');
  if (countEl) countEl.textContent = `${rows.length} تسديد · ${fmtPaySplit(rows)}`;
  document.getElementById('paymentsTable').innerHTML = `
    <table id="paymentsDataTable">
      <thead><tr><th>الرقم</th><th>الحساب</th><th>العملة</th><th>المبلغ</th><th>التاريخ</th><th>الإداري</th><th>ملاحظات</th><th></th></tr></thead>
      <tbody>${rows.map((p) => `
        <tr>
          <td>${esc(p.paymentNo)}</td>
          <td>${esc(p.accountName)}</td>
          <td>${currencyLabel(p.currency)}</td>
          <td dir="ltr">${fmtPrice(p.amount, p.currency)}</td>
          <td>${esc(p.paymentDate)}</td>
          <td>${edariSyncLabel(p.edariSyncStatus, p.edariSyncError)}</td>
          <td>${esc(p.notes)}</td>
          <td><button type="button" class="btn btn-danger btn-sm" data-delete-payment-row="${p.id}">حذف</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty-cell">لا توجد تسديدات مطابقة</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('paymentsTable').querySelectorAll('[data-delete-payment-row]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا التسديد من لوحة التحكم فقط؟\nيُعكس رصيد الحساب هنا — ولا يُلغى من الإداري إن كان مرحّلاً.')) return;
      try {
        await api(`/admin/payments/${btn.dataset.deletePaymentRow}`, { method: 'DELETE' });
        toast('تم حذف التسديد');
        loadPayments();
        loadAccounts();
        loadDashboard();
      } catch (err) { toast(err.message); }
    });
  });
}

document.getElementById('btnPay').addEventListener('click', async () => {
  try {
    await api('/admin/payments', {
      method: 'POST',
      body: JSON.stringify({
        accountId: Number(document.getElementById('payAcc').value),
        amount: Number(document.getElementById('payAmt').value),
        notes: document.getElementById('payNote').value
      })
    });
    toast('تم التسديد');
    document.getElementById('payAmt').value = '';
    document.getElementById('payNote').value = '';
    loadPayments();
    loadDashboard();
    loadAccounts();
  } catch (err) { toast(err.message); }
});

document.getElementById('payFrom')?.addEventListener('change', () => loadPayments());
document.getElementById('payTo')?.addEventListener('change', () => loadPayments());
document.getElementById('paySearch')?.addEventListener('input', debounce(loadPayments, 250));
document.getElementById('payMethodFilter')?.addEventListener('change', () => loadPayments());
document.getElementById('btnPayFillDebt')?.addEventListener('click', () => {
  const opt = document.getElementById('payAcc')?.selectedOptions?.[0];
  const bal = Number(opt?.dataset.balance || 0);
  if (bal <= 0) { toast('لا يوجد دين على هذا الحساب'); return; }
  document.getElementById('payAmt').value = String(bal);
});
document.getElementById('btnPayClearDates')?.addEventListener('click', () => {
  const f = document.getElementById('payFrom');
  const t = document.getElementById('payTo');
  if (f) f.value = '';
  if (t) t.value = '';
  loadPayments();
});

function journalKindLabel(k) {
  if (k === 'sale') return 'بيع';
  if (k === 'return') return 'مرتجع';
  if (k === 'payment') return 'تسديد';
  if (k === 'adjustment') return 'تسوية';
  if (k === 'issue') return 'إخراج';
  return k || '—';
}

async function loadJournal() {
  const acc = await api(`/admin/accounts?limit=500${scopeQuery()}`);
  document.getElementById('adjAcc').innerHTML = (acc.accounts||[]).map((a) =>
    `<option value="${a.id}">${esc(a.name)} — ${currencyLabel(a.currency)} — ${fmtPrice(a.balance, a.currency)}</option>`
  ).join('');
  const from = document.getElementById('journalFrom')?.value || '';
  const to = document.getElementById('journalTo')?.value || '';
  const params = new URLSearchParams({ limit: '400' });
  const scope = adminAppScope();
  if (scope === 'warehouse' || scope === 'delegate') params.set('scope', scope);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const data = await api(`/admin/journal?${params}`);
  let entries = data.entries || [];
  const kind = document.getElementById('journalKind')?.value || '';
  const q = (document.getElementById('journalSearch')?.value || '').trim().toLowerCase();
  if (kind) entries = entries.filter((e) => e.kind === kind);
  if (q) {
    entries = entries.filter((e) =>
      String(e.entryNo || '').toLowerCase().includes(q) ||
      String(e.description || '').toLowerCase().includes(q) ||
      String(e.accountName || '').toLowerCase().includes(q)
    );
  }
  const countEl = document.getElementById('journalResultCount');
  if (countEl) countEl.textContent = `${entries.length} قيد · ${fmtPaySplit(entries)}`;
  document.getElementById('journalTable').innerHTML = `
    <table id="journalDataTable">
      <thead><tr><th>الرقم</th><th>النوع</th><th>الحساب</th><th>العملة</th><th>المبلغ</th><th>الوصف</th><th>التاريخ</th><th></th></tr></thead>
      <tbody>${entries.map((e) => `
        <tr>
          <td>${esc(e.entryNo)}</td>
          <td>${esc(journalKindLabel(e.kind))}</td>
          <td>${esc(e.accountName || '—')}</td>
          <td>${currencyLabel(e.currency)}</td>
          <td dir="ltr">${fmtPrice(e.amount, e.currency)}</td>
          <td>${esc(e.description)}</td>
          <td>${esc(e.entryDate)}</td>
          <td><button type="button" class="btn btn-danger btn-sm" data-delete-journal-row="${e.id}">حذف</button></td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty-cell">لا توجد قيود مطابقة</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('journalTable').querySelectorAll('[data-delete-journal-row]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا القيد من لوحة التحكم فقط؟\nحتى القيود المرحّلة تُحذف هنا ولا تُلغى من برنامج الإداري.')) return;
      try {
        await api(`/admin/journal/${btn.dataset.deleteJournalRow}`, { method: 'DELETE' });
        toast('تم حذف القيد');
        loadJournal();
        loadAccounts();
        loadDashboard();
      } catch (err) { toast(err.message); }
    });
  });
}

document.getElementById('journalSearch')?.addEventListener('input', debounce(loadJournal, 250));
document.getElementById('journalKind')?.addEventListener('change', () => loadJournal());
document.getElementById('journalFrom')?.addEventListener('change', () => loadJournal());
document.getElementById('journalTo')?.addEventListener('change', () => loadJournal());

document.getElementById('btnAdj')?.addEventListener('click', async () => {
  try {
    await api('/admin/journal/adjustment', {
      method: 'POST',
      body: JSON.stringify({
        accountId: Number(document.getElementById('adjAcc').value),
        amount: Number(document.getElementById('adjAmt').value),
        description: document.getElementById('adjDesc').value.trim() || 'تسوية يدوية'
      })
    });
    toast('تم تسجيل القيد');
    document.getElementById('adjAmt').value = '';
    document.getElementById('adjDesc').value = '';
    loadJournal();
    loadAccounts();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

async function initSession() {
  token = localStorage.getItem(KEY);
  if (!token) return;
  try {
    const data = await api('/auth/me');
    if (data.user?.role !== 'admin') throw new Error('غير مصرح');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    setPageTitle('dashboard');
    loadDashboard();
    if (!window.__edariDashTimer) {
      window.__edariDashTimer = setInterval(() => {
        const view = document.querySelector('.nav.active')?.dataset.view;
        if (view === 'dashboard') loadDashboard();
        if (view === 'edariSync') loadEdariSync();
      }, 15000);
    }
  } catch {
    localStorage.removeItem(KEY);
    token = null;
  }
}

initSession();
