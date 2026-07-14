const API = '/api';
const KEY = 'shorja_admin';
let token = null;
let activeInvoiceId = null;
let editingProduct = null;
const priceSelection = new Map();
let productViewMode = 'grid';
let allProductsCache = [];
let categoryCatalog = [];
let prodActiveCategory = '';
let priceBrowseActiveCategory = '';
let viewingProduct = null;

const CATEGORY_ICONS = {
  'عناية': '✨',
  'عطور': '🌸',
  'مكياج': '💄',
  'default': '📦'
};

const PAGE_TITLES = {
  dashboard: ['لوحة اليوم', 'ملخص مبيعات الفروع والحسابات'],
  invoices: ['فواتير المبيعات', 'سجل المبيعات والمرتجعات'],
  products: ['المنتجات', 'استعراض وإدارة مخزون المنتجات'],
  prices: ['إدارة الأسعار', 'حدد المنتجات بالباركود ثم ارفعها للفروع'],
  accounts: ['حسابات العملاء', 'الديون وحدود الائتمان'],
  payments: ['التسديدات', 'تسجيل دفعات العملاء'],
  journal: ['سجل القيود', 'الحركات والتسويات اليدوية']
};

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
    if (data.user.role !== 'admin') throw new Error('حساب إداري فقط');
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
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view${view.charAt(0).toUpperCase() + view.slice(1)}`).classList.remove('hidden');
    setPageTitle(view);
    const loaders = {
      dashboard: loadDashboard,
      invoices: loadInvoices,
      products: loadProducts,
      prices: loadPrices,
      accounts: loadAccounts,
      payments: loadPayments,
      journal: loadJournal
    };
    loaders[btn.dataset.view]?.();
  });
});

async function loadDashboard() {
  const data = await api('/admin/dashboard');
  const t = data.today;
  const pending = data.pendingSync || 0;
  const edari = data.edariSync || {};
  const edariPending = Number(edari.total || 0);
  const canSyncNow = !!window.edariDesktop?.processEdariSync;
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi"><div class="lbl">فواتير اليوم</div><div class="val">${t.salesCount}</div></div>
    <div class="kpi"><div class="lbl">مبيعات اليوم</div><div class="val" dir="ltr">${fmt(t.salesAmount)}</div></div>
    <div class="kpi"><div class="lbl">مرتجعات</div><div class="val" dir="ltr">${fmt(t.returnsAmount)}</div></div>
    <div class="kpi"><div class="lbl">صافي اليوم</div><div class="val" dir="ltr">${fmt(t.netSales)}</div></div>
    <div class="kpi"><div class="lbl">منتجات</div><div class="val">${data.products.total}</div></div>
    <div class="kpi"><div class="lbl">إجمالي الديون</div><div class="val" dir="ltr">${fmt(data.accounts.totalDebt)}</div></div>
    <div class="kpi${pending ? ' warn' : ''}"><div class="lbl">فواتير بانتظار المزامنة</div><div class="val">${pending}</div></div>
    <div class="kpi${edariPending ? ' warn' : ''}" id="edariSyncKpi"><div class="lbl">حسابات بانتظار الإداري</div><div class="val">${edariPending}</div></div>
    <div class="kpi"><div class="lbl">إصدار الأسعار</div><div class="val">v${data.priceVersion || 0}</div></div>
  `;
  const syncBar = document.getElementById('edariSyncBar');
  if (syncBar) {
    if (edariPending > 0) {
      syncBar.hidden = false;
      syncBar.innerHTML = `
        <span>${edariPending} حساب بانتظار الدخول إلى الإداري (Edari)</span>
        ${canSyncNow ? '<button type="button" class="btn btn-sm" id="btnEdariSyncNow">مزامنة الآن</button>' : '<span style="color:var(--muted)">افتح تطبيق الإدارة على Windows</span>'}
      `;
      document.getElementById('btnEdariSyncNow')?.addEventListener('click', triggerEdariSyncNow);
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

async function triggerEdariSyncNow() {
  if (!window.edariDesktop?.processEdariSync) {
    toast('افتح تطبيق الإدارة على Windows للمزامنة');
    return;
  }
  try {
    const btn = document.getElementById('btnEdariSyncNow');
    if (btn) btn.disabled = true;
    const result = await window.edariDesktop.processEdariSync();
    if (result?.processed > 0) toast(`تمت مزامنة ${result.processed} حساب/حسابات`);
    else if (result?.skipped) toast('المزامنة قيد التشغيل أو غير متاحة');
    else toast('لا توجد حسابات معلّقة');
    loadDashboard();
    if (document.querySelector('.nav.active')?.dataset.view === 'accounts') loadAccounts();
  } catch (err) {
    toast(err.message || 'فشلت المزامنة');
  } finally {
    const btn = document.getElementById('btnEdariSyncNow');
    if (btn) btn.disabled = false;
  }
}

function edariSyncLabel(status) {
  if (status === 'synced') return '<span style="color:var(--ok)">متزامن</span>';
  if (status === 'pending') return '<span style="color:var(--warn)">بانتظار الإداري</span>';
  if (status === 'error') return '<span style="color:var(--danger)">خطأ</span>';
  return '<span style="color:var(--muted)">—</span>';
}

async function loadInvoices() {
  const date = document.getElementById('invDate').value || new Date().toISOString().slice(0, 10);
  document.getElementById('invDate').value = date;
  const q = document.getElementById('invSearch').value || '';
  const data = await api(`/admin/invoices?from=${date}&to=${date}&q=${encodeURIComponent(q)}`);
  document.getElementById('invoiceTable').innerHTML = `
    <table>
      <thead><tr><th>الرقم</th><th>النوع</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>مدفوع</th><th>متبقي</th></tr></thead>
      <tbody>${(data.invoices||[]).map((i) => `
        <tr class="clickable-row" data-invoice-id="${i.id}">
          <td>${esc(i.invoiceNo)}</td>
          <td>${i.kind === 'return' ? 'مرتجع' : 'بيع'}</td>
          <td>${esc(i.customerName||'نقدي')}</td>
          <td>${esc(i.invoiceDate)}</td>
          <td dir="ltr">${fmt(i.total)}</td>
          <td dir="ltr">${fmt(i.paidAmount)}</td>
          <td dir="ltr">${fmt(i.dueAmount)}</td>
        </tr>`).join('') || '<tr><td colspan="7">لا توجد فواتير</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('invoiceTable').querySelectorAll('[data-invoice-id]').forEach((row) => {
    row.addEventListener('click', () => openInvoice(Number(row.dataset.invoiceId)));
  });
}

document.getElementById('invDate')?.addEventListener('change', loadInvoices);
document.getElementById('invSearch')?.addEventListener('input', debounce(loadInvoices, 250));

async function openInvoice(id) {
  try {
    const data = await api(`/admin/invoices/${id}`);
    const inv = data.invoice;
    activeInvoiceId = id;
    document.getElementById('invoiceDetail').innerHTML = `
      <h2>فاتورة ${esc(inv.invoiceNo)}</h2>
      <p style="color:var(--muted);font-size:0.88rem;margin-bottom:12px">
        ${inv.kind === 'return' ? 'مرتجع' : 'بيع'} · ${esc(inv.invoiceDate)} · ${esc(inv.customerName || 'نقدي')}
        · إجمالي: <strong dir="ltr">${fmt(inv.total)}</strong>
      </p>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>المنتج</th><th>الباركود</th><th>الكمية</th><th>هدايا</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>${(inv.lines||[]).map((l) => `
            <tr>
              <td>${esc(l.name)}</td>
              <td dir="ltr">${esc(l.barcode)}</td>
              <td dir="ltr">${l.qty}</td>
              <td dir="ltr">${l.giftQty || 0}</td>
              <td dir="ltr">${fmt(l.unitPrice)}</td>
              <td dir="ltr">${fmt(l.lineTotal)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('invoiceModal').showModal();
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

function productCardHtml(p, opts = {}) {
  const { showAdd = false, showEdit = false, showDelete = false, selected = false } = opts;
  const stock = Number(p.stockQty || 0);
  const stockCls = stock <= 0 ? 'out' : stock <= 5 ? 'low' : '';
  const stockLbl = stock <= 0 ? 'نفد' : `متوفر ${fmt(stock)}`;
  return `
    <article class="prod-card${selected ? ' selected' : ''}" data-barcode="${esc(p.barcode)}">
      ${p.hasOffer ? `<span class="prod-offer">${esc(p.offerName || 'عرض')}</span>` : ''}
      ${p.category ? `<span class="prod-category">${esc(p.category)}</span>` : ''}
      <div class="prod-name">${esc(p.name)}</div>
      <div class="prod-barcode">${esc(p.barcode)}</div>
      <div class="prod-meta">
        <span class="prod-price" dir="ltr">${fmt(p.price)}</span>
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
    const data = await api('/admin/products?limit=5000');
    categoryCatalog = buildCategoryCatalog(data.products || []);
  } catch {
    categoryCatalog = buildCategoryCatalog(allProductsCache);
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
      <div class="detail-item"><label>سعر الجملة</label><strong dir="ltr">${fmt(p.costPrice || 0)}</strong></div>
      <div class="detail-item"><label>سعر البيع</label><strong dir="ltr">${fmt(p.price)}</strong></div>
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
      if (priceSelection.has(p.barcode)) {
        toast('المنتج مضاف مسبقاً');
        return;
      }
      priceSelection.set(p.barcode, p);
      renderPriceSelection();
      renderPriceBrowse();
      toast(`تمت الإضافة: ${p.name}`);
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
    <table>
      <thead><tr><th>باركود</th><th>الاسم</th><th>السعر</th><th>المخزون</th><th>القسم</th><th></th></tr></thead>
      <tbody>${products.map((p) => `
        <tr class="clickable-row" data-barcode="${esc(p.barcode)}">
          <td dir="ltr">${esc(p.barcode)}</td>
          <td>${esc(p.name)}</td>
          <td dir="ltr">${fmt(p.price)}</td>
          <td dir="ltr">${fmt(p.stockQty)}</td>
          <td>${esc(p.category)}</td>
          <td class="row-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-edit-prod" data-barcode="${esc(p.barcode)}">تعديل</button>
            <button type="button" class="btn btn-danger btn-sm btn-delete-prod" data-id="${p.id}">حذف</button>
          </td>
        </tr>`).join('')}
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

async function fetchProductsList({ q = '', category = '', limit = 500 } = {}) {
  if (category === '__none__') {
    const data = await api(`/admin/products?q=${encodeURIComponent(q)}&limit=${limit}`);
    const products = (data.products || []).filter((p) => !p.category);
    return { products, total: products.length };
  }
  return api(`/admin/products?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&limit=${limit}`);
}

async function loadProducts() {
  const q = document.getElementById('prodSearch')?.value || '';
  const data = await fetchProductsList({ q, category: prodActiveCategory, limit: 500 });
  const products = data.products || [];
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
      <div class="prod-stat">أقسام <strong>${categoryCatalog.length}</strong></div>`;
  }

  renderProductGrid(products, 'prodGrid', { showEdit: true, showDelete: true });
  renderProductTable(products);
  setProductViewMode(productViewMode);
}

async function loadPriceBrowse() {
  const q = document.getElementById('priceBrowseSearch')?.value || '';
  const data = await fetchProductsList({ q, category: priceBrowseActiveCategory, limit: 500 });
  const products = data.products || [];
  if (!q) await loadCategoryCatalog();
  renderCategoryBar('priceCategoryBar', priceBrowseActiveCategory, (cat) => {
    priceBrowseActiveCategory = cat;
    loadPriceBrowse();
  });
  renderPriceBrowse(products);
}

function renderPriceBrowse(products = null) {
  if (!products) {
    const q = document.getElementById('priceBrowseSearch')?.value || '';
    products = allProductsCache.length && !q && !priceBrowseActiveCategory
      ? allProductsCache
      : [];
    if (!products.length) return loadPriceBrowse();
  }
  renderProductGrid(products, 'priceBrowseGrid', { showAdd: true });
}

function openProductModal(product = null) {
  editingProduct = product;
  document.getElementById('productModalTitle').textContent = product ? 'تعديل منتج' : 'منتج جديد';
  document.getElementById('prodBarcode').value = product?.barcode || '';
  document.getElementById('prodBarcode').readOnly = !!product;
  document.getElementById('prodName').value = product?.name || '';
  document.getElementById('prodCostPrice').value = product?.costPrice ?? 0;
  document.getElementById('prodPrice').value = product?.price ?? 0;
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
    if (priceSelection.has(product.barcode)) {
      priceSelection.delete(product.barcode);
      renderPriceSelection();
    }
    document.getElementById('productModal')?.close();
    document.getElementById('productViewModal')?.close();
    toast('تم حذف المنتج');
    loadProducts();
    loadDashboard();
    if (!document.getElementById('viewPrices')?.classList.contains('hidden')) {
      loadPriceBrowse();
    }
  } catch (err) {
    toast(err.message || 'فشل حذف المنتج');
  }
}

function fillProductForm(product) {
  if (!product) return;
  document.getElementById('prodBarcode').value = product.barcode || '';
  document.getElementById('prodName').value = product.name || '';
  document.getElementById('prodCostPrice').value = product.costPrice ?? 0;
  document.getElementById('prodPrice').value = product.price ?? 0;
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
    toast(`تم جلب من الإداري: ${product.name} · جملة ${fmt(product.costPrice)} · مخزون ${fmt(product.stockQty)}`);
  } catch (err) {
    toast(err.message || 'فشل جلب المنتج');
  } finally {
    if (btn) btn.disabled = false;
  }
}

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
document.getElementById('prodViewToggle')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-toggle-btn');
  if (btn) setProductViewMode(btn.dataset.mode);
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
document.getElementById('priceBrowseSearch')?.addEventListener('input', debounce(loadPriceBrowse, 250));

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

async function loadPrices() {
  const data = await api('/admin/prices/packages');
  document.getElementById('packagesList').innerHTML = (data.packages||[]).map((p) => `
    <div class="branch-row">
      <span>إصدار <strong>v${p.version}</strong> — ${p.itemCount} منتج</span>
      <span style="color:var(--muted)">${esc(p.createdAt)} · ${esc(p.branchName || 'الإدارة')}</span>
    </div>
  `).join('') || '<p style="color:var(--muted)">لا توجد حزم بعد</p>';
  renderPriceSelection();
  await loadPriceBrowse();
  document.getElementById('priceBarcode')?.focus();
}

function renderPriceSelection() {
  const items = [...priceSelection.values()];
  const wrap = document.getElementById('priceSelectionWrap');
  const hint = document.getElementById('priceSelectionHint');
  const tbody = document.getElementById('priceSelectionBody');
  const publishBtn = document.getElementById('btnPublishPrices');
  if (!tbody) return;

  if (!items.length) {
    wrap?.classList.add('hidden');
    if (hint) {
      hint.classList.remove('hidden');
      hint.textContent = 'لم تُضف منتجات بعد';
    }
    if (publishBtn) publishBtn.disabled = true;
    tbody.innerHTML = '';
    return;
  }

  wrap?.classList.remove('hidden');
  hint?.classList.add('hidden');
  if (publishBtn) publishBtn.disabled = false;

  tbody.innerHTML = items.map((p) => `
    <tr>
      <td dir="ltr">${esc(p.barcode)}</td>
      <td>${esc(p.name)}</td>
      <td dir="ltr">${fmt(p.costPrice || 0)}</td>
      <td dir="ltr">${fmt(p.price)}</td>
      <td dir="ltr">${fmt(p.stockQty)}</td>
      <td>
        <button type="button" class="btn btn-ghost btn-sm btn-refresh-price-row" data-barcode="${esc(p.barcode)}" title="تحديث من الإدارة">↻</button>
        <button type="button" class="btn btn-ghost btn-sm btn-remove-price" data-barcode="${esc(p.barcode)}">إزالة</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-refresh-price-row').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const product = await saveProductFromEdari(btn.dataset.barcode);
        priceSelection.set(product.barcode, product);
        renderPriceSelection();
        renderPriceBrowse();
        toast(`تم تحديث من الإداري: ${product.name}`);
      } catch (err) {
        toast(err.message || 'فشل التحديث');
      }
    });
  });

  tbody.querySelectorAll('.btn-remove-price').forEach((btn) => {
    btn.addEventListener('click', () => {
      priceSelection.delete(btn.dataset.barcode);
      renderPriceSelection();
      renderPriceBrowse();
    });
  });
}

async function addPriceItem(forceRefresh = false) {
  const input = document.getElementById('priceBarcode');
  const code = input?.value.trim();
  if (!code) { toast('أدخل الباركود'); return; }
  if (!forceRefresh && priceSelection.has(code)) {
    toast('المنتج مضاف مسبقاً — استخدم ↻ للتحديث');
    input.value = '';
    input.focus();
    return;
  }
  try {
    const product = await saveProductFromEdari(code);
    const existed = priceSelection.has(product.barcode);
    priceSelection.set(product.barcode, product);
    renderPriceSelection();
    renderPriceBrowse();
    input.value = '';
    input.focus();
    toast(existed
      ? `تم تحديث من الإداري: ${product.name}`
      : `تمت الإضافة من الإداري: ${product.name} · جملة ${fmt(product.costPrice)}`);
  } catch (err) {
    toast(err.message || 'المادة غير موجودة في الإداري (Edari)');
  }
}

async function refreshPriceBarcodeFromAdmin() {
  const input = document.getElementById('priceBarcode');
  const code = input?.value.trim();
  if (!code) {
    toast('أدخل الباركود أولاً');
    input?.focus();
    return;
  }
  const btn = document.getElementById('btnRefreshPriceBarcode');
  if (btn) btn.disabled = true;
  try {
    const product = await fetchProductFromEdari(code);
    if (priceSelection.has(product.barcode)) {
      priceSelection.set(product.barcode, product);
      renderPriceSelection();
      renderPriceBrowse();
      toast(`تم تحديث التفاصيل: ${product.name}`);
    } else {
      fillProductPreviewFromBarcode(product);
      toast(`جاهز للإضافة: ${product.name} · جملة ${fmt(product.costPrice || 0)} · مخزون ${fmt(product.stockQty)}`);
    }
  } catch (err) {
    toast(err.message || 'فشل جلب المنتج');
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

function fillProductPreviewFromBarcode(product) {
  const hint = document.getElementById('priceSelectionHint');
  if (!hint || priceSelection.size) return;
  hint.classList.remove('hidden');
  hint.innerHTML = `معاينة: <strong>${esc(product.name)}</strong> · جملة <span dir="ltr">${fmt(product.costPrice || 0)}</span> · بيع <span dir="ltr">${fmt(product.price)}</span> · مخزون <span dir="ltr">${fmt(product.stockQty)}</span>`;
}

document.getElementById('btnAddPriceItem')?.addEventListener('click', () => addPriceItem(false));
document.getElementById('btnRefreshPriceBarcode')?.addEventListener('click', refreshPriceBarcodeFromAdmin);
document.getElementById('priceBarcode')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const code = e.target.value.trim();
    if (priceSelection.has(code)) await refreshPriceBarcodeFromAdmin();
    else await addPriceItem(false);
  }
});
document.getElementById('btnClearPriceSelection')?.addEventListener('click', () => {
  if (!priceSelection.size || confirm('تفريغ قائمة المنتجات المحددة؟')) {
    priceSelection.clear();
    renderPriceSelection();
    renderPriceBrowse();
    document.getElementById('publishResult').textContent = '';
  }
});

document.getElementById('btnPublishPrices').addEventListener('click', async () => {
  const barcodes = [...priceSelection.keys()];
  if (!barcodes.length) { toast('أضف منتجاً واحداً على الأقل'); return; }
  if (!confirm(`رفع ${barcodes.length} منتج للفروع؟`)) return;
  try {
    const data = await api('/admin/prices/publish', {
      method: 'POST',
      body: JSON.stringify({ barcodes, note: `تحديث ${barcodes.length} منتج` })
    });
    let msg = `تم — الإصدار v${data.version} · ${data.itemCount} منتج`;
    if (data.missing?.length) msg += ` · لم يُعثر على: ${data.missing.join(', ')}`;
    document.getElementById('publishResult').textContent = msg;
    toast('تم رفع المنتجات المحددة');
    priceSelection.clear();
    renderPriceSelection();
    renderPriceBrowse();
    loadPrices();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

async function loadAccounts() {
  const q = document.getElementById('accSearch').value || '';
  const data = await api(`/admin/accounts?q=${encodeURIComponent(q)}`);
  document.getElementById('accountTable').innerHTML = `
    <table>
      <thead><tr><th>الرمز</th><th>الاسم</th><th>الهاتف</th><th>الرصيد / الدين</th><th>حد الائتمان</th><th>الإداري</th></tr></thead>
      <tbody>${(data.accounts||[]).map((a) => `
        <tr class="clickable-row" data-account-id="${a.id}">
          <td>${esc(a.code)}</td>
          <td>${esc(a.name)}</td>
          <td dir="ltr">${esc(a.phone)}</td>
          <td dir="ltr" style="color:var(--danger);font-weight:700">${fmt(a.balance)}</td>
          <td dir="ltr">${fmt(a.creditLimit)}</td>
          <td>${edariSyncLabel(a.edariSyncStatus)}${a.edariNum ? `<br><small dir="ltr">${esc(a.edariNum)}</small>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6">لا توجد حسابات</td></tr>'}
      </tbody>
    </table>`;
  document.getElementById('accountTable').querySelectorAll('[data-account-id]').forEach((row) => {
    row.addEventListener('click', () => openLedger(Number(row.dataset.accountId)));
  });
}

async function openLedger(id) {
  try {
    const data = await api(`/admin/accounts/${id}`);
    const a = data.account;
    const entries = data.journal?.entries || data.journal || [];
    const pays = data.payments || [];
    document.getElementById('ledgerDetail').innerHTML = `
      <h2>كشف حساب — ${esc(a.name)}</h2>
      <div class="ledger-summary">
        <span>الرمز: <strong>${esc(a.code)}</strong></span>
        <span>الدين: <strong dir="ltr" style="color:var(--danger)">${fmt(a.balance)}</strong></span>
        <span>حد الائتمان: <strong dir="ltr">${fmt(a.creditLimit)}</strong></span>
      </div>
      <h3 style="font-size:0.95rem;margin:12px 0 8px">آخر التسديدات</h3>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>الرقم</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
          <tbody>${pays.length ? pays.map((p) => `
            <tr><td>${esc(p.paymentNo)}</td><td dir="ltr">${fmt(p.amount)}</td><td>${esc(p.paymentDate)}</td><td>${esc(p.notes)}</td></tr>
          `).join('') : '<tr><td colspan="4">لا توجد تسديدات</td></tr>'}
          </tbody>
        </table>
      </div>
      <h3 style="font-size:0.95rem;margin:12px 0 8px">سجل الحركات</h3>
      <div class="invoice-lines">
        <table>
          <thead><tr><th>الرقم</th><th>النوع</th><th>المبلغ</th><th>الوصف</th><th>التاريخ</th></tr></thead>
          <tbody>${entries.length ? entries.map((e) => `
            <tr><td>${esc(e.entryNo)}</td><td>${esc(e.kind)}</td><td dir="ltr">${fmt(e.amount)}</td><td>${esc(e.description)}</td><td>${esc(e.entryDate)}</td></tr>
          `).join('') : '<tr><td colspan="5">لا توجد حركات</td></tr>'}
          </tbody>
        </table>
      </div>`;
    document.getElementById('ledgerModal').showModal();
  } catch (err) { toast(err.message); }
}

document.getElementById('accSearch')?.addEventListener('input', debounce(loadAccounts, 250));

document.getElementById('btnNewAccount').addEventListener('click', () => {
  document.getElementById('accountForm').reset();
  document.getElementById('accFormCredit').value = '0';
  document.getElementById('accountModal').showModal();
});

document.getElementById('btnAccCancel')?.addEventListener('click', () => {
  document.getElementById('accountModal').close();
});

document.getElementById('accountForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('accFormName').value.trim(),
        phone: document.getElementById('accFormPhone').value.trim(),
        address: document.getElementById('accFormAddress').value.trim(),
        creditLimit: Number(document.getElementById('accFormCredit').value || 0),
        notes: document.getElementById('accFormNotes').value.trim()
      })
    });
    document.getElementById('accountModal').close();
    toast('تم إنشاء الحساب');
    loadAccounts();
    loadDashboard();
  } catch (err) { toast(err.message); }
});

async function loadPayments() {
  const acc = await api('/admin/accounts');
  const opts = (acc.accounts||[]).map((a) =>
    `<option value="${a.id}">${esc(a.name)} — دين: ${fmt(a.balance)}</option>`
  ).join('');
  document.getElementById('payAcc').innerHTML = opts;
  const pays = await api('/admin/payments');
  document.getElementById('paymentsTable').innerHTML = `
    <table>
      <thead><tr><th>الرقم</th><th>الحساب</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
      <tbody>${(pays.payments||[]).map((p) => `
        <tr>
          <td>${esc(p.paymentNo)}</td>
          <td>${esc(p.accountName)}</td>
          <td dir="ltr">${fmt(p.amount)}</td>
          <td>${esc(p.paymentDate)}</td>
          <td>${esc(p.notes)}</td>
        </tr>`).join('') || '<tr><td colspan="5">لا توجد تسديدات</td></tr>'}
      </tbody>
    </table>`;
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

async function loadJournal() {
  const acc = await api('/admin/accounts');
  document.getElementById('adjAcc').innerHTML = (acc.accounts||[]).map((a) =>
    `<option value="${a.id}">${esc(a.name)} — ${fmt(a.balance)}</option>`
  ).join('');
  const data = await api('/admin/journal?limit=100');
  document.getElementById('journalTable').innerHTML = `
    <table>
      <thead><tr><th>الرقم</th><th>النوع</th><th>المبلغ</th><th>الوصف</th><th>التاريخ</th></tr></thead>
      <tbody>${(data.entries||[]).map((e) => `
        <tr>
          <td>${esc(e.entryNo)}</td>
          <td>${esc(e.kind)}</td>
          <td dir="ltr">${fmt(e.amount)}</td>
          <td>${esc(e.description)}</td>
          <td>${esc(e.entryDate)}</td>
        </tr>`).join('') || '<tr><td colspan="5">لا توجد قيود</td></tr>'}
      </tbody>
    </table>`;
}

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
        if (document.querySelector('.nav.active')?.dataset.view === 'dashboard') loadDashboard();
      }, 15000);
    }
  } catch {
    localStorage.removeItem(KEY);
    token = null;
  }
}

initSession();
