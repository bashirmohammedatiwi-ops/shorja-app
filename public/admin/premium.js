/**
 * Premium admin enhancements v2
 */
(function () {
  const NAV_ICONS = {
    dashboard: '📊',
    reports: '📈',
    invoices: '🧾',
    delegates: '🚚',
    products: '📦',
    prices: '💰',
    accounts: '👥',
    payments: '💳',
    journal: '📒',
    edariSync: '🔄'
  };

  let currentUser = null;
  let branchesCache = [];
  let delegateFilter = '';
  let accDebtOnly = false;
  let clockTimer = null;

  function $(id) { return document.getElementById(id); }

  function exportTableCsv(tableEl, filename) {
    if (!tableEl) return;
    const rows = [...tableEl.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')].map((c) => `"${String(c.textContent || '').replace(/"/g, '""').trim()}"`).join(',')
    );
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function decorateNav() {
    document.querySelectorAll('.nav[data-view]').forEach((btn) => {
      const view = btn.dataset.view;
      const icon = NAV_ICONS[view] || '•';
      if (!btn.querySelector('.nav-ico')) {
        const label = btn.textContent.trim();
        btn.innerHTML = `<span class="nav-ico" aria-hidden="true">${icon}</span><span>${label}</span><span class="nav-badge hidden" data-nav-badge="${view}"></span>`;
      }
    });
  }

  function updateNavBadges(stats = {}) {
    const edari = Number(stats.edariTotal || 0);
    const delegate = Number(stats.delegatePending || 0);
    const map = { edariSync: edari, delegates: delegate };
    Object.entries(map).forEach(([view, n]) => {
      const badge = document.querySelector(`[data-nav-badge="${view}"]`);
      if (!badge) return;
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
      } else badge.classList.add('hidden');
    });
  }

  function updateClock() {
    const el = $('headerClock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString('ar-IQ', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short'
    });
  }

  async function pingServer() {
    const el = $('serverStatus');
    if (!el) return;
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(6000) });
      const ok = res.ok;
      el.className = `status-pill ${ok ? 'ok' : 'offline'}`;
      el.textContent = ok ? '● متصل بالسيرفر' : '● السيرفر لا يستجيب';
    } catch {
      el.className = 'status-pill offline';
      el.textContent = '● غير متصل';
    }
  }

  function updateDesktopBadge() {
    const el = $('desktopBadge');
    if (!el) return;
    const desktop = !!window.edariDesktop?.processEdariSync;
    el.className = `status-pill ${desktop ? 'ok' : 'warn'}`;
    el.textContent = desktop ? '✓ تطبيق سطح المكتب' : 'متصفح — الترحيل من التطبيق';
  }

  function setupHeader() {
    document.body.classList.add('premium-ready');
    $('app')?.classList.add('premium-ready');
    $('pageTop')?.classList.add('premium-top');

    $('btnGlobalRefresh')?.addEventListener('click', () => {
      const view = document.querySelector('.nav.active')?.dataset.view;
      document.querySelector(`.nav[data-view="${view}"]`)?.click();
      toast('تم التحديث');
    });

    $('btnSidebarToggle')?.addEventListener('click', () => {
      $('app')?.classList.toggle('sidebar-open');
    });
    $('sidebarOverlay')?.addEventListener('click', () => {
      $('app')?.classList.remove('sidebar-open');
    });

    document.querySelectorAll('.nav').forEach((btn) => {
      btn.addEventListener('click', () => $('app')?.classList.remove('sidebar-open'));
    });

    updateClock();
    if (!clockTimer) clockTimer = setInterval(updateClock, 30000);
    pingServer();
    setInterval(pingServer, 60000);
    updateDesktopBadge();
  }

  function setupQuickActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-goto]');
      if (!btn) return;
      document.querySelector(`.nav[data-view="${btn.dataset.goto}"]`)?.click();
    });
  }

  async function fetchBranches() {
    if (branchesCache.length) return branchesCache;
    try {
      const data = await api('/admin/branches');
      branchesCache = data.branches || [];
    } catch { branchesCache = []; }
    return branchesCache;
  }

  function fillBranchSelect(sel, { allLabel = 'كل الفروع' } = {}) {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      branchesCache.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }

  // ——— Enhanced Dashboard ———
  const _loadDashboard = window.loadDashboard || loadDashboard;
  window.loadDashboard = async function loadDashboardPremium() {
    const data = await api('/admin/dashboard');
    currentUser = currentUser || { fullName: 'مدير' };
    const userEl = $('sidebarUserName');
    if (userEl) userEl.textContent = currentUser.fullName || 'مدير النظام';

    const t = data.today;
    const edari = data.edariSync || {};
    const edariPending = Number(edari.total || 0);
    const delegate = data.delegatePrep || {};
    const lowStock = Number(data.lowStock || 0);

    updateNavBadges({
      edariTotal: edariPending,
      delegatePending: delegate.pending || 0
    });

    const alerts = [];
    if (edariPending > 0) {
      alerts.push(`<div class="alert-strip edari"><span>${edariPending} عنصر بانتظار الترحيل إلى الإداري</span><button type="button" class="btn btn-sm" data-goto="edariSync">مراجعة</button></div>`);
    }
    if ((delegate.pending || 0) > 0) {
      alerts.push(`<div class="alert-strip delegate"><span>${delegate.pending} فاتورة مندوبين جاهزة للترحيل</span><button type="button" class="btn btn-sm" data-goto="delegates">عرض</button></div>`);
    }
    if (lowStock > 0) {
      alerts.push(`<div class="alert-strip stock"><span>${lowStock} منتج بمخزون منخفض (≤5)</span><button type="button" class="btn btn-sm" data-goto="products">المنتجات</button></div>`);
    }
    $('dashboardAlerts').innerHTML = alerts.join('');
    $('dashboardAlerts').querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => document.querySelector(`.nav[data-view="${b.dataset.goto}"]`)?.click());
    });

    $('kpiGrid').className = 'kpi-grid premium-kpis';
    $('kpiGrid').innerHTML = `
      <div class="kpi premium-kpi"><div class="ico">🧾</div><div class="lbl">فواتير اليوم</div><div class="val">${t.salesCount}</div></div>
      <div class="kpi premium-kpi"><div class="ico">💵</div><div class="lbl">مبيعات اليوم</div><div class="val" dir="ltr">${fmt(t.salesAmount)}</div></div>
      <div class="kpi premium-kpi"><div class="ico">↩️</div><div class="lbl">مرتجعات</div><div class="val" dir="ltr">${fmt(t.returnsAmount)}</div></div>
      <div class="kpi premium-kpi accent"><div class="ico">📈</div><div class="lbl">صافي اليوم</div><div class="val" dir="ltr">${fmt(t.netSales)}</div></div>
      <div class="kpi premium-kpi"><div class="ico">📦</div><div class="lbl">منتجات</div><div class="val">${data.products.total}</div></div>
      <div class="kpi premium-kpi warn"><div class="ico">💳</div><div class="lbl">إجمالي الديون</div><div class="val" dir="ltr">${fmt(data.accounts.totalDebt)}</div></div>
      <div class="kpi premium-kpi delegate"><div class="ico">🚚</div><div class="lbl">مندوبين للترحيل</div><div class="val">${delegate.pending || 0}</div></div>
      <div class="kpi premium-kpi${edariPending ? ' warn' : ''}"><div class="ico">🔄</div><div class="lbl">طابور الإداري</div><div class="val">${edariPending}</div></div>
      <div class="kpi premium-kpi"><div class="ico">🏷️</div><div class="lbl">إصدار الأسعار</div><div class="val">v${data.priceVersion || 0}</div></div>`;

    const syncBar = $('edariSyncBar');
    if (syncBar) syncBar.hidden = true;

    $('branchesList').innerHTML = `
      <div class="branch-grid">${(data.branches || []).map((b) => {
        const online = branchOnline(b.last_seen_at);
        return `<article class="branch-card ${online ? 'online' : 'offline'}">
          <div class="branch-card-top">
            <span class="status-dot ${online ? 'online' : 'offline'}"></span>
            <strong>${esc(b.name)}</strong>
          </div>
          <div class="branch-card-meta">
            <div>${esc(b.code)}</div>
            <div>${online ? 'متصل الآن' : `آخر اتصال: ${esc(b.last_seen_at || '—')}`}</div>
            <div>أسعار v${b.price_version || 0}</div>
          </div>
        </article>`;
      }).join('') || '<p style="color:var(--muted)">لا توجد فروع</p>'}</div>`;
  };

  // ——— Reports ———
  window.loadReports = async function loadReports() {
    await fetchBranches();
    fillBranchSelect($('reportBranch'));
    const to = $('reportTo')?.value || new Date().toISOString().slice(0, 10);
    const from = $('reportFrom')?.value || to;
    const branchId = $('reportBranch')?.value || '';
    const q = new URLSearchParams({ from, to });
    if (branchId) q.set('branchId', branchId);
    const data = await api(`/admin/reports/sales?${q}`);
    const r = data.report || {};

    $('reportKpis').innerHTML = `
      <div class="kpi premium-kpi"><div class="lbl">فواتير البيع</div><div class="val">${r.salesCount || 0}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">إجمالي المبيعات</div><div class="val" dir="ltr">${fmt(r.salesAmount)}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">المرتجعات</div><div class="val" dir="ltr">${fmt(r.returnsAmount)}</div></div>
      <div class="kpi premium-kpi accent"><div class="lbl">الصافي</div><div class="val" dir="ltr">${fmt(r.netSales)}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">المحصّل</div><div class="val" dir="ltr">${fmt(r.collectionsTotal)}</div></div>
      <div class="kpi premium-kpi warn"><div class="lbl">دين الفترة</div><div class="val" dir="ltr">${fmt(r.dueAmount)}</div></div>`;

    const maxPay = Math.max(...(r.byPayment || []).map((x) => x.amount), 1);
    $('reportPaymentBars').innerHTML = (r.byPayment || []).map((p) => `
      <div class="report-bar">
        <i style="height:${Math.max(8, Math.round(p.amount / maxPay * 100))}%"></i>
        <b dir="ltr">${fmt(p.amount)}</b>
        <span>${p.method === 'credit' ? 'آجل' : p.method === 'cash' ? 'نقدي' : esc(p.method)}</span>
      </div>`).join('') || '<p style="color:var(--muted)">لا توجد بيانات</p>';

    $('reportTopProducts').innerHTML = `<ul class="top-products-list">${
      (r.topProducts || []).map((p, i) => `
        <li><span>${i + 1}. ${esc(p.name)} <small dir="ltr">${esc(p.barcode)}</small></span><strong dir="ltr">${fmt(p.amount)}</strong></li>
      `).join('') || '<li>لا توجد مبيعات في الفترة</li>'
    }</ul>`;
  };

  $('btnRunReport')?.addEventListener('click', () => loadReports());
  $('reportFrom')?.addEventListener('change', () => loadReports());
  $('reportTo')?.addEventListener('change', () => loadReports());
  $('reportBranch')?.addEventListener('change', () => loadReports());

  // ——— Enhanced Invoices ———
  const _loadInvoices = loadInvoices;
  window.loadInvoices = async function loadInvoicesPremium() {
    await fetchBranches();
    fillBranchSelect($('invBranch'));
    const from = $('invFrom')?.value || $('invDate')?.value || new Date().toISOString().slice(0, 10);
    const to = $('invTo')?.value || from;
    if ($('invFrom')) $('invFrom').value = from;
    if ($('invTo')) $('invTo').value = to;
    if ($('invDate')) $('invDate').value = from;
    const q = $('invSearch')?.value || '';
    const branchId = $('invBranch')?.value || '';
    const params = new URLSearchParams({ from, to, q, limit: '200' });
    if (branchId) params.set('branchId', branchId);
    const data = await api(`/admin/invoices?${params}`);
    const kindBadge = (k) => k === 'return' ? 'return' : k === 'issue' ? 'issue' : 'sale';
    const kindLabel = (k) => k === 'return' ? 'مرتجع' : k === 'issue' ? 'إخراج' : 'بيع';
    $('invoiceTable').innerHTML = `
      <table id="invoicesDataTable">
        <thead><tr><th>الرقم</th><th>النوع</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>مدفوع</th><th>متبقي</th><th>الإداري</th></tr></thead>
        <tbody>${(data.invoices||[]).map((i) => `
          <tr class="clickable-row" data-invoice-id="${i.id}">
            <td>${esc(i.invoiceNo)}</td>
            <td><span class="badge-pill ${kindBadge(i.kind)}">${kindLabel(i.kind)}</span></td>
            <td>${esc(i.customerName||'نقدي')}</td>
            <td>${esc(i.invoiceDate)}</td>
            <td dir="ltr">${fmt(i.total)}</td>
            <td dir="ltr">${fmt(i.paidAmount)}</td>
            <td dir="ltr">${fmt(i.dueAmount)}</td>
            <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}</td>
          </tr>`).join('') || '<tr><td colspan="8">لا توجد فواتير</td></tr>'}
        </tbody>
      </table>`;
    $('invoiceTable').querySelectorAll('[data-invoice-id]').forEach((row) => {
      row.addEventListener('click', () => openInvoice(Number(row.dataset.invoiceId)));
    });
  };

  $('btnExportInvoices')?.addEventListener('click', () => {
    exportTableCsv($('invoicesDataTable'), `invoices-${Date.now()}.csv`);
    toast('تم تصدير CSV');
  });
  $('invFrom')?.addEventListener('change', loadInvoices);
  $('invTo')?.addEventListener('change', loadInvoices);
  $('invBranch')?.addEventListener('change', loadInvoices);

  // ——— Enhanced Delegates ———
  const _loadDelegates = loadDelegates;
  window.loadDelegates = async function loadDelegatesPremium() {
    const date = $('delegateDate')?.value || '';
    const q = $('delegateSearch')?.value || '';
    const params = new URLSearchParams();
    if (date) { params.set('from', date); params.set('to', date); }
    if (q) params.set('q', q);
    const data = await api(`/admin/delegate-invoices?${params}`);
    const stats = data.stats || {};
    $('delegateStats').className = 'kpi-grid premium-kpis delegate-hero';
    $('delegateStats').innerHTML = `
      <div class="kpi premium-kpi"><div class="lbl">جاهزة</div><div class="val">${stats.total || 0}</div></div>
      <div class="kpi premium-kpi warn"><div class="lbl">بانتظار الإداري</div><div class="val">${stats.pending || 0}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">مرحّلة</div><div class="val">${stats.synced || 0}</div></div>`;

    let rows = data.invoices || [];
    if (delegateFilter === 'pending') rows = rows.filter((i) => i.edariSyncStatus !== 'synced');
    if (delegateFilter === 'synced') rows = rows.filter((i) => i.edariSyncStatus === 'synced');

    $('delegateTable').innerHTML = `
      <table>
        <thead><tr>
          <th>المصدر</th><th>الفاتورة</th><th>طلب التجهيز</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الإداري</th><th></th>
        </tr></thead>
        <tbody>${rows.map((i) => `
          <tr>
            <td><span class="badge-pill ${i.prepMode === 'warehouse' ? 'warehouse' : 'delegate'}">${esc(i.sourceLabel || '')}</span></td>
            <td><button type="button" class="linkish" data-invoice-id="${i.id}">${esc(i.invoiceNo)}</button></td>
            <td dir="ltr">${esc(i.prepOrderNo || '—')}</td>
            <td>${esc(i.customerName || 'نقدي')}</td>
            <td>${esc(i.invoiceDate)}</td>
            <td dir="ltr">${fmt(i.total)}</td>
            <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}</td>
            <td class="row-actions">${i.edariSyncStatus === 'synced' ? '✓' : `<button type="button" class="btn btn-secondary btn-sm" data-queue-edari="${i.id}">ترحيل</button>`}</td>
          </tr>`).join('') || '<tr><td colspan="8">لا توجد فواتير</td></tr>'}
        </tbody>
      </table>`;

    $('delegateTable').querySelectorAll('[data-invoice-id]').forEach((btn) => {
      btn.addEventListener('click', () => openInvoice(Number(btn.dataset.invoiceId)));
    });
    $('delegateTable').querySelectorAll('[data-queue-edari]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/admin/delegate-invoices/${btn.dataset.queueEdari}/queue-edari`, { method: 'POST' });
          toast('أُضيفت للطابور — راجع مزامنة الإداري');
          loadDelegates();
        } catch (err) { toast(err.message); }
      });
    });
  };

  $('delegateFilters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-delegate-filter]');
    if (!chip) return;
    delegateFilter = chip.dataset.delegateFilter || '';
    $('delegateFilters').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadDelegates();
  });

  $('btnQueueAllDelegates')?.addEventListener('click', async () => {
    try {
      const data = await api('/admin/delegate-invoices');
      const pending = (data.invoices || []).filter((i) => i.edariSyncStatus !== 'synced');
      if (!pending.length) { toast('لا توجد فواتير للترحيل'); return; }
      if (!confirm(`ترحيل ${pending.length} فاتورة إلى طابور الإداري؟`)) return;
      for (const inv of pending) {
        await api(`/admin/delegate-invoices/${inv.id}/queue-edari`, { method: 'POST' });
      }
      toast(`تمت إضافة ${pending.length} فاتورة للطابور`);
      loadDelegates();
    } catch (err) { toast(err.message); }
  });

  // ——— Enhanced Accounts ———
  const _loadAccounts = loadAccounts;
  window.loadAccounts = async function loadAccountsPremium() {
    const q = $('accSearch')?.value || '';
    const debtQ = accDebtOnly ? '&debt=1' : '';
    const data = await api(`/admin/accounts?q=${encodeURIComponent(q)}${debtQ}`);
    $('accountTable').innerHTML = `
      <table>
        <thead><tr><th>الرمز</th><th>الاسم</th><th>الهاتف</th><th>الدين</th><th>حد الائتمان</th><th>الإداري</th><th></th></tr></thead>
        <tbody>${(data.accounts||[]).map((a) => {
          const overLimit = a.creditLimit > 0 && a.balance > a.creditLimit;
          return `<tr>
            <td>${esc(a.code)}</td>
            <td><button type="button" class="linkish" data-account-id="${a.id}">${esc(a.name)}</button></td>
            <td dir="ltr">${esc(a.phone)}</td>
            <td dir="ltr" style="color:var(--danger);font-weight:700${overLimit ? ';background:#fef2f2' : ''}">${fmt(a.balance)}</td>
            <td dir="ltr">${fmt(a.creditLimit)}</td>
            <td>${edariSyncLabel(a.edariSyncStatus, a.edariSyncError)}</td>
            <td>${a.edariSyncStatus !== 'synced' ? `<button type="button" class="btn btn-sm btn-secondary" data-sync-acc="${a.id}">مزامنة</button>` : '✓'}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7">لا توجد حسابات</td></tr>'}
      </tbody></table>`;
    $('accountTable').querySelectorAll('[data-account-id]').forEach((btn) => {
      btn.addEventListener('click', () => openLedger(Number(btn.dataset.accountId)));
    });
    $('accountTable').querySelectorAll('[data-sync-acc]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/admin/accounts/${btn.dataset.syncAcc}/sync-edari`, { method: 'POST' });
          toast('أُضيف الحساب لطابور الإداري');
          loadAccounts();
        } catch (err) { toast(err.message); }
      });
    });
  };

  $('btnAccDebtOnly')?.addEventListener('click', () => {
    accDebtOnly = !accDebtOnly;
    $('btnAccDebtOnly')?.classList.toggle('active', accDebtOnly);
    loadAccounts();
  });

  // ——— Enhanced Edari Sync ———
  const _loadEdariSync = loadEdariSync;
  window.loadEdariSync = async function loadEdariSyncPremium() {
    try {
      const parent = await api('/admin/edari/parent');
      const p = parent.parent || {};
      $('edariParentPanel').innerHTML = `
        <div class="item"><div class="lbl">حساب الأب (الشجرة)</div><div class="val" dir="ltr">${esc(p.num || '12111')} — ${esc(p.name || 'زبائن الشورجة')}</div></div>
        <div class="item"><div class="lbl">الكتابة في الإداري</div><div class="val">${parent.canWrite ? 'مفعّلة' : 'معطّلة (وضع آمن)'}</div></div>
        <div class="item"><div class="lbl">الترحيل</div><div class="val">${window.edariDesktop?.processEdariSync ? 'من هذا الجهاز ✓' : 'يتطلب تطبيق Windows'}</div></div>`;
    } catch {
      $('edariParentPanel').innerHTML = '<p style="color:var(--muted)">تعذر جلب معلومات الإداري</p>';
    }
    await _loadEdariSync();
    updateDesktopBadge();
  };

  // ——— Enhanced Invoice Modal ———
  const _openInvoice = openInvoice;
  window.openInvoice = async function openInvoicePremium(id) {
    await _openInvoice(id);
    const detail = $('invoiceDetail');
    if (!detail) return;
    const inv = (await api(`/admin/invoices/${id}`)).invoice;
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    actions.style.marginTop = '12px';
    actions.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" id="btnPrintThermal">طباعة حرارية</button>
      ${inv.edariSyncStatus !== 'synced' && inv.prepStatus === 'processing' ? `<button type="button" class="btn btn-sm btn-primary" id="btnInvQueueEdari">ترحيل للإداري</button>` : ''}`;
    detail.appendChild(actions);
    $('btnPrintThermal')?.addEventListener('click', () => {
      const w = window.open('', '_blank', 'width=320,height=640');
      fetch(`/api/admin/invoices/${id}/print?thermal=1`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.text()).then((html) => { w.document.write(html); w.document.close(); });
    });
    $('btnInvQueueEdari')?.addEventListener('click', async () => {
      try {
        await api(`/admin/delegate-invoices/${id}/queue-edari`, { method: 'POST' });
        toast('أُضيفت للطابور');
        openInvoice(id);
      } catch (err) { toast(err.message); }
    });
  };

  // ——— Patch login ———
  const loginForm = $('loginForm');
  if (loginForm) {
    const origSubmit = loginForm.onsubmit;
    loginForm.addEventListener('submit', async function patchLogin(e) {
      setTimeout(() => {
        api('/auth/me').then((d) => {
          currentUser = d.user;
          $('sidebarUserName').textContent = currentUser?.fullName || 'مدير';
        }).catch(() => {});
      }, 500);
    }, true);
  }

  // ——— Extend nav for reports ———
  PAGE_TITLES.reports = ['التقارير', 'تحليل المبيعات والمنتجات الأكثر مبيعاً'];

  // ——— Init ———
  function initPremium() {
    decorateNav();
    setupHeader();
    setupQuickActions();
    fetchBranches();

    const today = new Date().toISOString().slice(0, 10);
    if ($('reportFrom')) $('reportFrom').value = today;
    if ($('reportTo')) $('reportTo').value = today;
    if ($('invFrom')) $('invFrom').value = today;
    if ($('invTo')) $('invTo').value = today;

    if (token && !$('loginScreen')?.classList.contains('hidden') === false && $('app') && !$('app').classList.contains('hidden')) {
      api('/auth/me').then((d) => {
        currentUser = d.user;
        $('sidebarUserName').textContent = currentUser?.fullName || 'مدير';
      }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPremium);
  } else {
    initPremium();
  }
})();
