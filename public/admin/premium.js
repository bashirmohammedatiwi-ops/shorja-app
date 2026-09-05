/**
 * Premium admin enhancements v4 — dual-app isolation (الشورجة | المندوبين)
 */
(function () {
  const APP_KEY = 'shorja_admin_app';
  let currentApp = localStorage.getItem(APP_KEY) || 'warehouse';

  window.getAdminAppScope = () => currentApp;

  const APP_META = {
    warehouse: {
      title: 'ديما الحياة',
      subtitle: 'لوحة الشورجة',
      logo: 'د',
      themeClass: 'app-warehouse',
      accountsLabel: 'حسابات الشورجة',
      paymentsLabel: 'تسديدات الشورجة'
    },
    delegate: {
      title: 'المندوبين',
      subtitle: 'لوحة المندوبين',
      logo: 'م',
      themeClass: 'app-delegate',
      accountsLabel: 'حسابات المندوبين',
      paymentsLabel: 'تسديدات المندوبين'
    }
  };

  const NAV_ICONS = {
    dashboard: '📊',
    posMonitor: '📡',
    reports: '📈',
    invoices: '🧾',
    warehousePrep: '🏪',
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
  let warehouseFilter = '';
  let accDebtOnly = false;
  let accEdariFilter = '';
  let edariStatusFilter = '';
  let clockTimer = null;

  const VIEW_SCOPE = {
    dashboard: 'shared',
    posMonitor: 'warehouse',
    reports: 'warehouse',
    invoices: 'warehouse',
    warehousePrep: 'warehouse',
    products: 'warehouse',
    prices: 'warehouse',
    journal: 'warehouse',
    delegates: 'delegate',
    accounts: 'shared',
    payments: 'shared',
    edariSync: 'shared'
  };

  function $(id) { return document.getElementById(id); }

  function updateAccountsBanner() {
    const el = $('accountsScopeBanner');
    if (!el) return;
    if (currentApp === 'warehouse') {
      el.className = 'accounts-scope-banner warehouse';
      el.innerHTML = '<span class="banner-ico">🏪</span><div><strong>حسابات الشورجة</strong><p>زبائن فروع الشورجة ونقاط البيع فقط — لا تظهر حسابات المندوبين في نقطة البيع</p></div>';
    } else {
      el.className = 'accounts-scope-banner delegate';
      el.innerHTML = '<span class="banner-ico">🚚</span><div><strong>حسابات المندوبين</strong><p>زبائن المندوبين منفصلون تماماً عن الشورجة — تُدار من هنا فقط</p></div>';
    }
  }

  function updatePaymentsBanner() {
    const el = $('paymentsScopeBanner');
    if (!el) return;
    if (currentApp === 'warehouse') {
      el.className = 'accounts-scope-banner warehouse';
      el.innerHTML = '<span class="banner-ico">💳</span><div><strong>تسديدات الشورجة</strong><p>دفعات زبائن فروع الشورجة فقط</p></div>';
    } else {
      el.className = 'accounts-scope-banner delegate';
      el.innerHTML = '<span class="banner-ico">💳</span><div><strong>تسديدات المندوبين</strong><p>دفعات زبائن المندوبين فقط</p></div>';
    }
  }

  function updateEdariBanner() {
    const el = $('edariScopeBanner');
    if (!el) return;
    if (currentApp === 'warehouse') {
      el.className = 'accounts-scope-banner warehouse';
      el.innerHTML = '<span class="banner-ico">🔄</span><div><strong>مزامنة إداري — الشورجة</strong><p>حسابات وفواتير وتسديدات الشورجة فقط — بدون المندوبين</p></div>';
    } else {
      el.className = 'accounts-scope-banner delegate';
      el.innerHTML = '<span class="banner-ico">🔄</span><div><strong>مزامنة إداري — المندوبين</strong><p>طابور ترحيل المندوبين فقط — منفصل عن الشورجة</p></div>';
    }
  }

  function viewAllowed(view) {
    const scope = VIEW_SCOPE[view];
    if (!scope || scope === 'shared') return true;
    return scope === currentApp;
  }

  function goToView(view) {
    if (!viewAllowed(view)) {
      toast('هذا القسم غير متاح في التطبيق الحالي');
      return;
    }
    const root = currentApp === 'delegate' ? '#navDelegate' : '#navWarehouse';
    const btn = document.querySelector(`${root} .nav[data-view="${view}"]`)
      || document.querySelector(`.nav[data-view="${view}"]`);
    btn?.click();
  }

  function bindKpiLinks(root = $('kpiGrid')) {
    root?.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => goToView(el.dataset.goto));
    });
  }

  function stampDashboard() {
    const stamp = $('dashUpdated');
    if (stamp) stamp.textContent = `آخر تحديث: ${new Date().toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  const PAGE_SEARCH_MAP = {
    invoices: 'invSearch', products: 'prodSearch', accounts: 'accSearch',
    payments: 'paySearch', journal: 'journalSearch', posMonitor: 'posMonSearch',
    warehousePrep: 'warehouseSearch', delegates: 'delegateSearch',
    prices: 'priceBrowseSearch', edariSync: 'edariSyncSearch'
  };

  function applyAppContext() {
    const meta = APP_META[currentApp];
    const appEl = $('app');
    appEl?.classList.remove('app-warehouse', 'app-delegate');
    appEl?.classList.add(meta.themeClass);

    document.querySelectorAll('.app-switch-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.app === currentApp);
    });

    $('navWarehouse')?.classList.toggle('hidden', currentApp !== 'warehouse');
    $('navDelegate')?.classList.toggle('hidden', currentApp !== 'delegate');

    document.querySelectorAll('.wh-only').forEach((el) => {
      el.classList.toggle('hidden', currentApp !== 'warehouse');
    });
    document.querySelectorAll('.del-only').forEach((el) => {
      el.classList.toggle('hidden', currentApp !== 'delegate');
    });

    if ($('sidebarAppTitle')) $('sidebarAppTitle').textContent = meta.title;
    if ($('sidebarAppSubtitle')) $('sidebarAppSubtitle').textContent = meta.subtitle;
    if ($('sidebarLogoMark')) $('sidebarLogoMark').textContent = meta.logo;
    if ($('sidebarUserRole')) {
      $('sidebarUserRole').textContent = currentApp === 'warehouse'
        ? 'فروع الشورجة · نقاط البيع · المخزن'
        : 'طلبات المندوبين · حساباتهم';
    }

    const modePill = $('appModePill');
    if (modePill) {
      modePill.textContent = currentApp === 'warehouse' ? '🏪 تطبيق الشورجة' : '🚚 تطبيق المندوبين';
      modePill.className = `app-mode-pill ${currentApp}`;
    }

    PAGE_TITLES.accounts = [meta.accountsLabel, currentApp === 'warehouse'
      ? 'زبائن فروع الشورجة — منفصلون عن المندوبين'
      : 'زبائن المندوبين فقط'];
    PAGE_TITLES.payments = [meta.paymentsLabel, 'تسجيل دفعات العملاء'];
    PAGE_TITLES.dashboard = currentApp === 'warehouse'
      ? ['لوحة الشورجة', 'ملخص مبيعات الفروع والمخزن']
      : ['لوحة المندوبين', 'حسابات وطلبات المندوبين — منفصلة عن الشورجة'];
    PAGE_TITLES.delegates = ['فواتير المندوبين', 'طلبات المندوبين الجاهزة للترحيل'];
    PAGE_TITLES.edariSync = currentApp === 'warehouse'
      ? ['مزامنة الإداري — الشورجة', 'ترحيل حسابات وفواتير الشورجة فقط']
      : ['مزامنة الإداري — المندوبين', 'ترحيل طلبات وحسابات المندوبين فقط'];

    updateAccountsBanner();
    updatePaymentsBanner();
    updateEdariBanner();

    const edariView = $('viewEdariSync');
    if (edariView && !edariView.classList.contains('hidden') && typeof window.loadEdariSync === 'function') {
      window.loadEdariSync();
    }
    refreshAppBadges();

    document.title = currentApp === 'warehouse' ? 'ديما الحياة — الشورجة' : 'ديما الحياة — المندوبين';
  }

  function pickEdariSyncStats(data) {
    if (!data) return {};
    if (currentApp === 'warehouse') return data.edariSyncWarehouse || data.edariSync || {};
    if (currentApp === 'delegate') return data.edariSyncDelegate || data.edariSync || {};
    return data.edariSync || {};
  }

  function refreshAppBadges() {
    api('/admin/dashboard').then((data) => {
      const edari = pickEdariSyncStats(data);
      updateNavBadges({
        edariTotal: Number(edari.total || 0),
        delegatePending: data.delegatePrep?.pending || 0,
        warehousePending: data.warehousePrep?.pending || 0
      });
    }).catch(() => {});
  }

  function switchApp(app) {
    if (app !== 'warehouse' && app !== 'delegate') return;
    if (app === currentApp) return;
    currentApp = app;
    localStorage.setItem(APP_KEY, app);
    applyAppContext();
    const edariView = $('viewEdariSync');
    if (edariView && !edariView.classList.contains('hidden') && typeof window.loadEdariSync === 'function') {
      window.loadEdariSync();
      return;
    }
    const homeView = 'dashboard';
    const navRoot = app === 'delegate' ? '#navDelegate' : '#navWarehouse';
    document.querySelector(`${navRoot} .nav[data-view="${homeView}"]`)?.click();
  }

  function setupAppSwitcher() {
    document.querySelectorAll('.app-switch-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchApp(tab.dataset.app));
    });
    applyAppContext();
    patchNavClicks();
  }

  function patchNavClicks() {
    document.querySelectorAll('.nav[data-view]').forEach((btn) => {
      if (btn.dataset.patchedNav) return;
      btn.dataset.patchedNav = '1';
      btn.addEventListener('click', (e) => {
        const view = btn.dataset.view;
        if (!viewAllowed(view)) {
          e.stopImmediatePropagation();
          toast('هذا القسم غير متاح في التطبيق الحالي');
          return;
        }
        document.querySelectorAll('.nav').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      }, true);
    });
  }

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
  window.exportTableCsv = exportTableCsv;

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
    const warehouse = Number(stats.warehousePending || 0);
    document.querySelectorAll('[data-nav-badge]').forEach((badge) => badge.classList.add('hidden'));
    if (currentApp === 'warehouse') {
      const map = { edariSync: edari, warehousePrep: warehouse };
      Object.entries(map).forEach(([view, n]) => {
        const badge = document.querySelector(`#navWarehouse [data-nav-badge="${view}"]`);
        if (!badge) return;
        if (n > 0) {
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.classList.remove('hidden');
        }
      });
    } else {
      const badge = document.querySelector('#navDelegate [data-nav-badge="delegates"]');
      if (badge && delegate > 0) {
        badge.textContent = delegate > 99 ? '99+' : String(delegate);
        badge.classList.remove('hidden');
      }
      const edariBadge = document.querySelector('#navDelegate [data-nav-badge="edariSync"]');
      if (edariBadge && edari > 0) {
        edariBadge.textContent = edari > 99 ? '99+' : String(edari);
        edariBadge.classList.remove('hidden');
      }
    }
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
      const data = await api('/admin/branches?scope=pos');
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
    const edari = pickEdariSyncStats(data);
    const edariPending = Number(edari.total || 0);
    const delegate = data.delegatePrep || {};
    const warehouse = data.warehousePrep || {};
    const lowStock = Number(data.lowStock || 0);
    const accStats = currentApp === 'warehouse'
      ? (data.accountsWarehouse || data.accounts)
      : (data.accountsDelegate || { total: 0, withDebt: 0, totalDebt: 0 });

    updateNavBadges({
      edariTotal: edariPending,
      delegatePending: delegate.pending || 0,
      warehousePending: warehouse.pending || 0
    });

    const alerts = [];
    if (currentApp === 'warehouse') {
      if (edariPending > 0) {
        alerts.push(`<div class="alert-strip edari"><span>${edariPending} عنصر بانتظار الترحيل إلى الإداري</span><button type="button" class="btn btn-sm" data-goto="edariSync">مراجعة</button></div>`);
      }
      if ((warehouse.pending || 0) > 0) {
        alerts.push(`<div class="alert-strip warehouse"><span>${warehouse.pending} فاتورة شورجة جاهزة للترحيل</span><button type="button" class="btn btn-sm" data-goto="warehousePrep">عرض</button></div>`);
      }
      if (lowStock > 0) {
        alerts.push(`<div class="alert-strip stock"><span>${lowStock} منتج بمخزون منخفض (≤5)</span><button type="button" class="btn btn-sm" data-goto="products">المنتجات</button></div>`);
      }
    } else {
      if ((delegate.pending || 0) > 0) {
        alerts.push(`<div class="alert-strip delegate"><span>${delegate.pending} فاتورة مندوبين جاهزة للترحيل</span><button type="button" class="btn btn-sm" data-goto="delegates">عرض</button></div>`);
      }
      if (edariPending > 0) {
        alerts.push(`<div class="alert-strip edari"><span>${edariPending} عنصر بانتظار الترحيل إلى الإداري</span><button type="button" class="btn btn-sm" data-goto="edariSync">مراجعة</button></div>`);
      }
    }
    $('dashboardAlerts').innerHTML = alerts.join('');
    $('dashboardAlerts').querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => document.querySelector(`.nav[data-view="${b.dataset.goto}"]`)?.click());
    });

    $('kpiGrid').className = 'kpi-grid premium-kpis';
    if (currentApp !== 'warehouse') {
      $('kpiGrid').innerHTML = `
        <div class="kpi premium-kpi kpi-link" data-goto="accounts"><div class="lbl">حسابات المندوبين</div><div class="val">${accStats.total || 0}</div></div>
        <div class="kpi premium-kpi warn kpi-link" data-goto="accounts"><div class="lbl">ديون المندوبين</div><div class="val" dir="ltr">${fmtDebtSplit(accStats)}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="delegates"><div class="lbl">جاهزة للترحيل</div><div class="val">${delegate.pending || 0}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="delegates"><div class="lbl">مرحّلة</div><div class="val">${delegate.synced || 0}</div></div>
        <div class="kpi premium-kpi${edariPending ? ' warn' : ''} kpi-link" data-goto="edariSync"><div class="lbl">طابور الإداري</div><div class="val">${edariPending}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="payments"><div class="lbl">تسديدات</div><div class="val">←</div></div>`;
      bindKpiLinks();
      stampDashboard();
      const hub = $('delegateHubPanel');
      if (hub) {
        hub.innerHTML = `
          <div class="dash-row"><span>حسابات</span><strong>${accStats.total || 0}</strong></div>
          <div class="dash-row"><span>مدينون</span><strong>${accStats.withDebt || 0}</strong></div>
          <div class="dash-row"><span>إجمالي الدين</span><strong dir="ltr">${fmtDebtSplit(accStats)}</strong></div>
          <div class="dash-row"><span>طلبات بانتظار الترحيل</span><strong>${delegate.pending || 0}</strong></div>
          <p class="hint" style="margin-top:10px">طلبات المندوبين منفصلة تماماً عن فروع الشورجة ونقاط البيع.</p>`;
      }
      return;
    }

    $('kpiGrid').innerHTML = `
        <div class="kpi premium-kpi kpi-link" data-goto="invoices"><div class="ico">🧾</div><div class="lbl">فواتير اليوم</div><div class="val">${t.salesCount}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="reports"><div class="ico">💵</div><div class="lbl">مبيعات اليوم</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'salesAmount', t.salesAmount)}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="invoices"><div class="ico">↩️</div><div class="lbl">مرتجعات</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'returnsAmount', t.returnsAmount)}</div></div>
        <div class="kpi premium-kpi accent kpi-link" data-goto="posMonitor"><div class="ico">📈</div><div class="lbl">صافي اليوم</div><div class="val" dir="ltr">${fmtMoneySplit(t.byCurrency, 'netSales', t.netSales)}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="accounts"><div class="ico">👥</div><div class="lbl">حسابات الشورجة</div><div class="val">${accStats.total || 0}</div></div>
        <div class="kpi premium-kpi warn kpi-link" data-goto="accounts"><div class="ico">💳</div><div class="lbl">ديون الشورجة</div><div class="val" dir="ltr">${fmtDebtSplit(accStats)}</div></div>
        <div class="kpi premium-kpi warehouse kpi-link" data-goto="warehousePrep"><div class="ico">🏪</div><div class="lbl">تجهيز للترحيل</div><div class="val">${warehouse.pending || 0}</div></div>
        <div class="kpi premium-kpi${edariPending ? ' warn' : ''} kpi-link" data-goto="edariSync"><div class="ico">🔄</div><div class="lbl">طابور الإداري</div><div class="val">${edariPending}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="products"><div class="ico">📦</div><div class="lbl">منتجات</div><div class="val">${data.products.total}</div></div>
        <div class="kpi premium-kpi kpi-link" data-goto="prices"><div class="ico">🏷️</div><div class="lbl">إصدار الأسعار</div><div class="val">v${data.priceVersion || 0}</div></div>`;
    bindKpiLinks();
    stampDashboard();

    try {
      const { monitor } = await fetchPosMonitor();
      renderPosLiveStrip(monitor);
      renderBranchPerformanceTable($('branchPerformanceTable'), monitor.branches);
      renderActivityFeed($('recentInvoicesFeed'), monitor.recent);
      renderHourlyChart($('hourlySalesChart'), monitor.hourly);
    } catch { /* */ }

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
    $('branchesList')?.querySelectorAll('.branch-card').forEach((card) => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => goToView('posMonitor'));
    });

    const syncBar = $('edariSyncBar');
    if (syncBar) syncBar.hidden = true;
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
      <div class="kpi premium-kpi"><div class="lbl">إجمالي المبيعات</div><div class="val" dir="ltr">${fmtMoneySplit(r.byCurrency, 'salesAmount', r.salesAmount)}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">عدد المرتجعات</div><div class="val">${r.returnsCount || 0}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">المرتجعات</div><div class="val" dir="ltr">${fmtMoneySplit(r.byCurrency, 'returnsAmount', r.returnsAmount)}</div></div>
      <div class="kpi premium-kpi accent"><div class="lbl">الصافي</div><div class="val" dir="ltr">${fmtMoneySplit(r.byCurrency, 'netSales', r.netSales)}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">المحصّل نقداً</div><div class="val" dir="ltr">${fmtMoneySplit(r.byCurrency, 'paidAmount', r.paidAmount)}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">تحصيلات حسابات</div><div class="val" dir="ltr">${fmtMoneySplit({ iqd: { amount: r.collectionsByCurrency?.iqd ?? r.collectionsTotal }, usd: { amount: r.collectionsByCurrency?.usd ?? r.collectionsTotalUsd } }, 'amount')}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">متوسط الفاتورة</div><div class="val" dir="ltr">${fmtAvgTicket(r.byCurrency, r.salesCount, r.salesAmount)}</div></div>
      <div class="kpi premium-kpi warn"><div class="lbl">دين الفترة</div><div class="val" dir="ltr">${fmtMoneySplit(r.byCurrency, 'dueAmount', r.dueAmount)}</div></div>`;

    const maxPay = Math.max(...(r.byPayment || []).map((x) => x.amount), 1);
    $('reportPaymentBars').innerHTML = (r.byPayment || []).map((p) => `
      <div class="report-bar">
        <i style="height:${Math.max(8, Math.round(p.amount / maxPay * 100))}%"></i>
        <b dir="ltr">${fmtPrice(p.amount, p.currency)}</b>
        <span>${p.method === 'credit' ? 'آجل' : p.method === 'cash' ? 'نقدي' : esc(p.method)}${p.currency ? ` · ${currencyLabel(p.currency)}` : ''}</span>
      </div>`).join('') || '<p style="color:var(--muted)">لا توجد بيانات</p>';

    $('reportTopProducts').innerHTML = `<ul class="top-products-list">${
      (r.topProducts || []).map((p, i) => `
        <li><span>${i + 1}. ${esc(p.name)} <small dir="ltr">${esc(p.barcode)}</small></span><strong dir="ltr">${fmtPrice(p.amount, p.currency)}</strong></li>
      `).join('') || '<li>لا توجد مبيعات في الفترة</li>'
    }</ul>`;

    const branchEl = $('reportByBranch');
    if (branchEl) {
      const rows = r.byBranch || [];
      branchEl.innerHTML = `
        <table class="data-table compact" id="reportBranchTable">
          <thead><tr><th>الفرع</th><th>فواتير</th><th>المبيعات</th><th>مدفوع</th><th>آجل</th><th>مرتجعات</th><th>صافي</th></tr></thead>
          <tbody>${rows.length ? rows.map((b) => `
            <tr>
              <td>${esc(b.name)}</td>
              <td>${b.count}</td>
              <td dir="ltr">${fmt(b.amount)}</td>
              <td dir="ltr">${fmt(b.paid)}</td>
              <td dir="ltr">${fmt(b.due)}</td>
              <td dir="ltr">${fmt(b.returnsAmount)}</td>
              <td dir="ltr"><strong>${fmt(b.net ?? (Number(b.amount||0) - Number(b.returnsAmount||0)))}</strong></td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="empty-cell">لا توجد بيانات</td></tr>'}</tbody>
        </table>`;
    }
  };

  function isoDay(d = new Date()) {
    const x = new Date(d);
    x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
    return x.toISOString().slice(0, 10);
  }

  $('reportPresetChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-report-preset]');
    if (!chip) return;
    const today = isoDay();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const week = new Date(); week.setDate(week.getDate() - 6);
    const month = new Date(); month.setDate(1);
    const map = {
      today: [today, today],
      yesterday: [isoDay(y), isoDay(y)],
      week: [isoDay(week), today],
      month: [isoDay(month), today]
    };
    const range = map[chip.dataset.reportPreset];
    if (range) {
      if ($('reportFrom')) $('reportFrom').value = range[0];
      if ($('reportTo')) $('reportTo').value = range[1];
    }
    $('reportPresetChips').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadReports();
  });

  $('btnExportReport')?.addEventListener('click', () => {
    const table = $('reportBranchTable');
    if (table) {
      exportTableCsv(table, `sales-by-branch-${Date.now()}.csv`);
      toast('تم تصدير تقرير الفروع');
    } else toast('اعرض التقرير أولاً');
  });
  $('btnPrintReport')?.addEventListener('click', () => {
    const body = $('viewReports');
    if (!body) return;
    const w = window.open('', '_blank');
    w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>تقرير</title></head><body>${$('reportKpis')?.outerHTML || ''}${$('reportByBranch')?.innerHTML || ''}</body></html>`);
    w.document.close();
    w.print();
  });

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
    const kind = $('invKind')?.value || '';
    const payment = $('invPayment')?.value || '';
    const edari = $('invEdari')?.value || '';
    const params = new URLSearchParams({ from, to, q, limit: '200' });
    if (branchId) params.set('branchId', branchId);
    if (kind) params.set('kind', kind);
    if (payment) params.set('payment', payment);
    if (edari) params.set('edari', edari);
    const data = await api(`/admin/invoices?${params}`);
    const countEl = $('invResultCount');
    if (countEl) countEl.textContent = `${data.total ?? (data.invoices || []).length} نتيجة`;
    $('invoiceTable').innerHTML = `
      <table id="invoicesDataTable">
        <thead><tr><th>الوقت</th><th>الرقم</th><th>الفرع</th><th>النوع</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>مدفوع</th><th>متبقي</th><th>الدفع</th><th>الإداري</th><th></th></tr></thead>
        <tbody>${(data.invoices||[]).length ? (data.invoices||[]).map((i) => `
          <tr class="clickable-row" data-invoice-id="${i.id}">
            <td>${esc((i.createdAt || '').slice(11, 16) || '—')}</td>
            <td>${esc(i.invoiceNo)}</td>
            <td>${esc(i.branchName || branchesCache.find((b) => b.id === i.branchId)?.name || '—')}</td>
            <td>${kindBadgeHtml(i.kind)}</td>
            <td>${esc(i.customerName||'نقدي')}</td>
            <td>${esc(i.invoiceDate)}</td>
            <td dir="ltr">${fmtPrice(i.total, i.currency)}</td>
            <td dir="ltr">${fmtPrice(i.paidAmount, i.currency)}</td>
            <td dir="ltr">${fmtPrice(i.dueAmount, i.currency)}</td>
            <td>${payMethodLabel(i.paymentMethod)}</td>
            <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}</td>
            <td class="row-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-print-invoice="${i.id}">طباعة</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-invoice="${i.id}">حذف</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="12" class="empty-cell">لا توجد فواتير مطابقة</td></tr>'}
        </tbody>
      </table>`;
    $('invoiceTable').querySelectorAll('[data-invoice-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-delete-invoice], [data-print-invoice]')) return;
        openInvoice(Number(row.dataset.invoiceId));
      });
    });
    $('invoiceTable').querySelectorAll('[data-print-invoice]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        fetch(`/api/admin/invoices/${btn.dataset.printInvoice}/print`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.text())
          .then((html) => {
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
          })
          .catch(() => toast('تعذّرت الطباعة'));
      });
    });
    $('invoiceTable').querySelectorAll('[data-delete-invoice]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('حذف هذه الفاتورة من لوحة التحكم ونقطة البيع؟\nحتى لو كانت مرحّلة: تُحذف هنا فقط ولا تُلغى من برنامج الإداري.')) return;
        try {
          await api(`/admin/invoices/${btn.dataset.deleteInvoice}`, { method: 'DELETE' });
          toast('تم حذف الفاتورة من الشورجة');
          loadInvoices();
          loadDashboard();
        } catch (err) { toast(err.message); }
      });
    });
  };

  document.getElementById('invPresetChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-inv-preset]');
    if (!chip) return;
    const today = isoDay();
    const week = new Date(); week.setDate(week.getDate() - 6);
    const month = new Date(); month.setDate(1);
    if ($('invFrom')) $('invFrom').value = today;
    if ($('invTo')) $('invTo').value = today;
    if ($('invDate')) $('invDate').value = today;
    if ($('invKind')) $('invKind').value = '';
    if ($('invPayment')) $('invPayment').value = '';
    if ($('invEdari')) $('invEdari').value = '';
    if ($('invSearch')) $('invSearch').value = '';
    const preset = chip.dataset.invPreset;
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    if (preset === 'yesterday') {
      const y = isoDay(yest);
      if ($('invFrom')) $('invFrom').value = y;
      if ($('invTo')) $('invTo').value = y;
    }
    if (preset === 'week' && $('invFrom')) $('invFrom').value = isoDay(week);
    if (preset === 'month' && $('invFrom')) $('invFrom').value = isoDay(month);
    if (preset === 'today-credit' && $('invPayment')) $('invPayment').value = 'credit';
    if (preset === 'returns' && $('invKind')) $('invKind').value = 'return';
    if (preset === 'edari-pending' && $('invEdari')) $('invEdari').value = 'pending';
    if (preset === 'edari-error' && $('invEdari')) $('invEdari').value = 'error';
    $('invPresetChips').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadInvoices();
  });

  $('btnResetInvFilters')?.addEventListener('click', () => {
    const today = isoDay();
    if ($('invFrom')) $('invFrom').value = today;
    if ($('invTo')) $('invTo').value = today;
    if ($('invSearch')) $('invSearch').value = '';
    if ($('invKind')) $('invKind').value = '';
    if ($('invPayment')) $('invPayment').value = '';
    if ($('invEdari')) $('invEdari').value = '';
    if ($('invBranch')) $('invBranch').value = '';
    $('invPresetChips')?.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    loadInvoices();
  });
  $('btnExportInvoices')?.addEventListener('click', () => {
    exportTableCsv($('invoicesDataTable'), `invoices-${Date.now()}.csv`);
    toast('تم تصدير CSV');
  });
  $('invFrom')?.addEventListener('change', loadInvoices);
  $('invTo')?.addEventListener('change', loadInvoices);
  $('invBranch')?.addEventListener('change', loadInvoices);
  $('invKind')?.addEventListener('change', loadInvoices);
  $('invPayment')?.addEventListener('change', loadInvoices);
  $('invEdari')?.addEventListener('change', loadInvoices);

  function renderPrepTablePremium(tableEl, rows, { labelHeader, labelFn, badgeClass }) {
    tableEl.innerHTML = `
      <table id="prepDataTable">
        <thead><tr>
          <th>${labelHeader}</th><th>الفاتورة</th><th>طلب التجهيز</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الإداري</th><th></th>
        </tr></thead>
          <tbody>${rows.length ? rows.map((i) => `
          <tr>
            <td><span class="badge-pill ${badgeClass}">${esc(labelFn(i))}</span></td>
            <td><button type="button" class="linkish" data-invoice-id="${i.id}">${esc(i.invoiceNo)}</button></td>
            <td dir="ltr">${esc(i.prepOrderNo || '—')}</td>
            <td>${esc(i.customerName || 'نقدي')}</td>
            <td>${esc(i.invoiceDate)}</td>
            <td dir="ltr">${fmtPrice(i.total, i.currency)}</td>
            <td>${edariSyncLabel(i.edariSyncStatus, i.edariSyncError)}</td>
            <td class="row-actions">${i.edariSyncStatus === 'synced' ? '✓' : `<button type="button" class="btn btn-secondary btn-sm" data-queue-edari="${i.id}">ترحيل</button>`}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty-cell">لا توجد فواتير</td></tr>'}
        </tbody>
      </table>`;
    tableEl.querySelectorAll('[data-invoice-id]').forEach((btn) => {
      btn.addEventListener('click', () => openInvoice(Number(btn.dataset.invoiceId)));
    });
    tableEl.querySelectorAll('[data-queue-edari]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/admin/delegate-invoices/${btn.dataset.queueEdari}/queue-edari`, { method: 'POST' });
          toast('أُضيفت للطابور — راجع مزامنة الإداري');
          document.querySelector('.nav.active')?.click();
        } catch (err) { toast(err.message); }
      });
    });
  }

  function renderPrepStatsPremium(el, stats) {
    el.className = 'kpi-grid premium-kpis';
    el.innerHTML = `
      <div class="kpi premium-kpi"><div class="lbl">جاهزة</div><div class="val">${stats.total || 0}</div></div>
      <div class="kpi premium-kpi warn"><div class="lbl">بانتظار الإداري</div><div class="val">${stats.pending || 0}</div></div>
      <div class="kpi premium-kpi"><div class="lbl">مرحّلة</div><div class="val">${stats.synced || 0}</div></div>`;
  }

  // ——— Warehouse Prep (Shorja branches only) ———
  window.loadWarehousePrep = async function loadWarehousePrepPremium() {
    const date = $('warehouseDate')?.value || '';
    const q = $('warehouseSearch')?.value || '';
    const params = new URLSearchParams();
    if (date) { params.set('from', date); params.set('to', date); }
    if (q) params.set('q', q);
    const data = await api(`/admin/warehouse-prep-invoices?${params}`);
    const stats = data.stats || {};
    $('warehouseStats').className = 'kpi-grid premium-kpis warehouse-hero';
    renderPrepStatsPremium($('warehouseStats'), stats);
    let rows = data.invoices || [];
    if (warehouseFilter === 'pending') rows = rows.filter((i) => i.edariSyncStatus !== 'synced');
    if (warehouseFilter === 'synced') rows = rows.filter((i) => i.edariSyncStatus === 'synced');
    renderPrepTablePremium($('warehouseTable'), rows, {
      labelHeader: 'الفرع',
      labelFn: (i) => i.branchName || i.sourceLabel || 'فرع الشورجة',
      badgeClass: 'warehouse'
    });
  };

  $('warehouseFilters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-warehouse-filter]');
    if (!chip) return;
    warehouseFilter = chip.dataset.warehouseFilter || '';
    $('warehouseFilters').querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadWarehousePrep();
  });

  $('btnQueueAllWarehouse')?.addEventListener('click', async () => {
    try {
      const data = await api('/admin/warehouse-prep-invoices');
      const pending = (data.invoices || []).filter((i) => i.edariSyncStatus !== 'synced');
      if (!pending.length) { toast('لا توجد فواتير للترحيل'); return; }
      if (!confirm(`ترحيل ${pending.length} فاتورة شورجة إلى طابور الإداري؟`)) return;
      for (const inv of pending) {
        await api(`/admin/delegate-invoices/${inv.id}/queue-edari`, { method: 'POST' });
      }
      toast(`تمت إضافة ${pending.length} فاتورة للطابور`);
      loadWarehousePrep();
    } catch (err) { toast(err.message); }
  });

  $('btnExportWarehouse')?.addEventListener('click', () => {
    exportTableCsv($('prepDataTable'), `warehouse-prep-${Date.now()}.csv`);
    toast('تم التصدير');
  });
  $('btnExportDelegates')?.addEventListener('click', () => {
    exportTableCsv($('prepDataTable'), `delegates-${Date.now()}.csv`);
    toast('تم التصدير');
  });
  $('warehouseDate')?.addEventListener('change', loadWarehousePrep);
  $('warehouseSearch')?.addEventListener('input', debounce(loadWarehousePrep, 250));

  // ——— Delegates only ———
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
    renderPrepStatsPremium($('delegateStats'), stats);

    let rows = data.invoices || [];
    if (delegateFilter === 'pending') rows = rows.filter((i) => i.edariSyncStatus !== 'synced');
    if (delegateFilter === 'synced') rows = rows.filter((i) => i.edariSyncStatus === 'synced');

    renderPrepTablePremium($('delegateTable'), rows, {
      labelHeader: 'المندوب',
      labelFn: (i) => i.prepOrderNo || i.sourceLabel || '—',
      badgeClass: 'delegate'
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
    const edariQ = accEdariFilter ? `&edariStatus=${encodeURIComponent(accEdariFilter)}` : '';
    const scopeQ = currentApp === 'warehouse' || currentApp === 'delegate' ? `&scope=${currentApp}` : '';
    updateAccountsBanner();
    const data = await api(`/admin/accounts?q=${encodeURIComponent(q)}${debtQ}${edariQ}${scopeQ}`);
    const list = data.accounts || [];
    const debtSum = list.reduce((s, a) => s + Number(a.balance || 0), 0);
    const debtN = list.filter((a) => Number(a.balance) > 0).length;
    if ($('accResultCount')) $('accResultCount').textContent = `${list.length} حساب · مدينون ${debtN} · ${fmt(debtSum)}`;
    $('accountTable').innerHTML = `
      <table id="accountsDataTable">
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
            <td class="row-actions">
              ${a.edariSyncStatus !== 'synced' ? `<button type="button" class="btn btn-sm btn-secondary" data-sync-acc="${a.id}">مزامنة</button>` : ''}
              <button type="button" class="btn btn-danger btn-sm" data-delete-acc="${a.id}">حذف</button>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="empty-cell">لا توجد حسابات مطابقة</td></tr>'}
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
    $('accountTable').querySelectorAll('[data-delete-acc]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('حذف هذا الحساب من لوحة التحكم ونقطة البيع مع كل فواتيره وتسديداته وقيوده؟\nحتى البيانات المرحّلة تُحذف هنا فقط ولا تُلغى من برنامج الإداري.')) return;
        try {
          await api(`/admin/accounts/${btn.dataset.deleteAcc}`, { method: 'DELETE' });
          toast('تم حذف الحساب من الشورجة');
          loadAccounts();
          loadInvoices();
          loadPayments();
          loadJournal();
          loadDashboard();
        } catch (err) { toast(err.message); }
      });
    });
  };

  $('accFilters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-acc-filter]');
    if (!chip) return;
    const f = chip.dataset.accFilter || '';
    if (f === 'debt') {
      accDebtOnly = !accDebtOnly;
      chip.classList.toggle('active', accDebtOnly);
      loadAccounts();
      return;
    }
    const edariMap = { 'edari-pending': 'pending', 'edari-synced': 'synced', 'edari-error': 'error' };
    const next = edariMap[f] || '';
    accEdariFilter = accEdariFilter === next ? '' : next;
    $('accFilters')?.querySelectorAll('[data-acc-filter]').forEach((c) => {
      if (c.dataset.accFilter === 'debt') return;
      const key = edariMap[c.dataset.accFilter] || '';
      c.classList.toggle('active', key && key === accEdariFilter);
    });
    loadAccounts();
  });

  $('btnExportAccounts')?.addEventListener('click', () => {
    exportTableCsv($('accountsDataTable'), `accounts-${Date.now()}.csv`);
    toast('تم تصدير الحسابات');
  });
  $('btnExportPayments')?.addEventListener('click', () => {
    exportTableCsv($('paymentsDataTable'), `payments-${Date.now()}.csv`);
    toast('تم تصدير التسديدات');
  });
  $('btnExportJournal')?.addEventListener('click', () => {
    exportTableCsv($('journalDataTable'), `journal-${Date.now()}.csv`);
    toast('تم تصدير القيود');
  });

  window.filterEdariSyncByStatus = function filterEdariSyncByStatus(status) {
    edariStatusFilter = status || '';
    window.edariStatusFilter = edariStatusFilter;
    renderEdariSyncTable();
  };

  $('edariStatusFilters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-edari-status]');
    if (!chip) return;
    edariStatusFilter = chip.dataset.edariStatus || '';
    window.edariStatusFilter = edariStatusFilter;
    $('edariStatusFilters').querySelectorAll('.filter-chip').forEach((c) => {
      c.classList.toggle('active', c === chip);
    });
    renderEdariSyncTable();
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

  function payMethodLabel(m) {
    if (m === 'cash') return 'نقدي';
    if (m === 'credit') return 'آجل';
    if (m === 'partial') return 'جزئي';
    if (m === 'issue') return 'إخراج';
    return esc(m || '—');
  }

  function kindBadgeHtml(k) {
    const cls = k === 'return' ? 'return' : k === 'issue' ? 'issue' : 'sale';
    const lbl = k === 'return' ? 'مرتجع' : k === 'issue' ? 'إخراج' : 'بيع';
    return `<span class="badge-pill ${cls}">${lbl}</span>`;
  }

  function renderBranchPerformanceTable(el, branches, { clickable = false } = {}) {
    if (!el) return;
    if (!branches?.length) {
      el.innerHTML = '<p class="empty-panel">لا توجد فروع</p>';
      return;
    }
    el.innerHTML = `
      <table class="data-table compact">
        <thead><tr>
          <th>الفرع</th><th>الاتصال</th><th>فواتير</th><th>مبيعات</th><th>مرتجعات</th><th>صافي</th><th>آجل</th><th>مزامنة</th><th>أسعار</th>
        </tr></thead>
        <tbody>${branches.map((b) => `
          <tr class="${b.online ? 'row-online' : 'row-offline'}${clickable ? ' clickable-row' : ''}" ${clickable ? `data-branch-id="${b.id}"` : ''}>
            <td><strong>${esc(b.name)}</strong><small class="sub">${esc(b.code)}</small></td>
            <td><span class="status-dot ${b.online ? 'online' : 'offline'}"></span> ${b.online ? 'متصل' : (b.minutesOffline != null ? `منذ ${b.minutesOffline} د` : 'غير متصل')}</td>
            <td>${b.salesCount || 0}</td>
            <td dir="ltr">${fmt(b.salesAmount)}</td>
            <td dir="ltr">${fmt(b.returnsAmount)}</td>
            <td dir="ltr"><strong>${fmt(b.netSales)}</strong></td>
            <td dir="ltr">${fmt(b.dueAmount)}</td>
            <td>${b.pendingSync ? `<span class="badge-pill warn">${b.pendingSync}</span>` : '✓'}</td>
            <td>${b.priceStale ? `<span class="badge-pill warn">v${b.priceVersion}</span>` : `v${b.priceVersion || 0}`}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    if (clickable) {
      el.querySelectorAll('[data-branch-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const sel = $('posMonBranch');
          if (sel) { sel.value = row.dataset.branchId; loadPosMonitor(); }
        });
      });
    }
  }

  function renderBranchHealthAlerts(monitor) {
    const el = $('posMonAlerts');
    if (!el) return;
    const alerts = [];
    (monitor.branches || []).forEach((b) => {
      if (!b.online) {
        alerts.push(`<div class="alert-strip stock"><span>⚠ ${esc(b.name)} غير متصل${b.minutesOffline != null ? ` (منذ ${b.minutesOffline} دقيقة)` : ''}</span><button type="button" class="btn btn-sm" data-filter-branch="${b.id}">تصفية</button></div>`);
      }
      if (b.priceStale) {
        alerts.push(`<div class="alert-strip edari"><span>🏷 ${esc(b.name)} — أسعار قديمة (v${b.priceVersion})</span></div>`);
      }
      if (b.pendingSync > 0) {
        alerts.push(`<div class="alert-strip warehouse"><span>⏳ ${esc(b.name)} — ${b.pendingSync} فاتورة بانتظار المزامنة</span></div>`);
      }
    });
    el.innerHTML = alerts.slice(0, 6).join('');
    el.querySelectorAll('[data-filter-branch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sel = $('posMonBranch');
        if (sel) { sel.value = btn.dataset.filterBranch; loadPosMonitor(); }
      });
    });
  }

  function renderPaymentMix(el, byPayment) {
    if (!el) return;
    const maxAmt = Math.max(...(byPayment || []).map((x) => x.amount), 1);
    el.innerHTML = (byPayment || []).length
      ? (byPayment || []).map((p) => `
        <div class="report-bar">
          <i style="height:${Math.max(8, Math.round(p.amount / maxAmt * 100))}%"></i>
          <b dir="ltr">${fmtPrice(p.amount, p.currency)}</b>
          <span>${payMethodLabel(p.method)}${p.currency ? ` · ${currencyLabel(p.currency)}` : ''} (${p.count})</span>
        </div>`).join('')
      : '<p class="empty-panel">لا توجد مبيعات اليوم</p>';
  }

  function renderHourlyChart(el, hourly) {
    if (!el) return;
    const hours = Array.from({ length: 24 }, (_, i) => {
      const row = (hourly || []).find((h) => Number(h.hour) === i);
      return { hour: i, count: row?.count || 0, amount: row?.amount || 0 };
    });
    const maxAmt = Math.max(...hours.map((h) => h.amount), 1);
    el.innerHTML = `
      <div class="hourly-bars">${hours.map((h) => `
        <div class="hourly-bar-col" title="${h.hour}:00 — ${h.count} فاتورة · ${fmt(h.amount)}">
          <i style="height:${Math.max(4, Math.round(h.amount / maxAmt * 100))}%"></i>
          <span class="hour-lbl">${h.hour}</span>
        </div>`).join('')}
      </div>`;
  }

  function renderActivityFeed(el, recent) {
    if (!el) return;
    if (!recent?.length) {
      el.innerHTML = '<p class="empty-panel">لا توجد فواتير حديثة</p>';
      return;
    }
    el.innerHTML = recent.slice(0, 12).map((inv) => `
      <button type="button" class="activity-item" data-invoice-id="${inv.id}">
        <span class="activity-kind">${kindBadgeHtml(inv.kind)}</span>
        <span class="activity-body">
          <strong>${esc(inv.invoiceNo)}</strong>
          <small>${esc(inv.branchName || 'فرع')} · ${esc(inv.customerName || 'نقدي')}</small>
        </span>
        <span class="activity-amt" dir="ltr">${fmtPrice(inv.total, inv.currency)}</span>
        <span class="activity-time">${esc((inv.createdAt || '').slice(11, 16) || inv.invoiceDate)}</span>
      </button>`).join('');
    el.querySelectorAll('[data-invoice-id]').forEach((btn) => {
      btn.addEventListener('click', () => openInvoice(Number(btn.dataset.invoiceId)));
    });
  }

  function renderPosLiveStrip(monitor) {
    const el = $('posLiveStrip');
    if (!el || currentApp !== 'warehouse') return;
    const t = monitor?.totals || {};
    el.classList.toggle('live-pulse', !!monitor?._fresh);
    el.innerHTML = `
      <div class="live-stat"><span class="lbl">فروع متصلة</span><strong>${t.onlineBranches || 0}/${t.totalBranches || 0}</strong></div>
      <div class="live-stat"><span class="lbl">فواتير اليوم</span><strong>${t.salesCount || 0}</strong></div>
      <div class="live-stat accent"><span class="lbl">صافي المبيعات</span><strong dir="ltr">${fmt(t.netSales)}</strong></div>
      <div class="live-stat"><span class="lbl">متوسط الفاتورة</span><strong dir="ltr">${fmt(t.avgTicket)}</strong></div>
      <div class="live-stat"><span class="lbl">مرتجعات</span><strong>${t.returnsCount || 0}</strong></div>
      <div class="live-stat"><span class="lbl">بانتظار المزامنة</span><strong>${monitor?.pendingSync || 0}</strong></div>`;
  }

  function buildPosMonitorParams() {
    const params = new URLSearchParams({ limit: '80' });
    const branchId = $('posMonBranch')?.value || '';
    const q = ($('posMonSearch')?.value || '').trim();
    const kind = $('posMonKind')?.value || '';
    const payment = $('posMonPayment')?.value || '';
    const edari = $('posMonEdari')?.value || '';
    if (branchId) params.set('branchId', branchId);
    if (q) params.set('q', q);
    if (kind) params.set('kind', kind);
    if (payment) params.set('payment', payment);
    if (edari) params.set('edari', edari);
    return params;
  }

  async function fetchPosMonitor() {
    const data = await api(`/admin/pos-monitor?${buildPosMonitorParams()}`);
    return { monitor: data.monitor || {}, revision: data.revision };
  }

  let posMonTimer = null;
  let lastKnownRevision = 0;
  let lastPosInvoiceIds = new Set();
  let revisionPollTimer = null;

  function setupPosMonAutoRefresh() {
    if (posMonTimer) { clearInterval(posMonTimer); posMonTimer = null; }
    const sec = Number($('posMonRefresh')?.value || 0);
    if (sec > 0) {
      posMonTimer = setInterval(() => {
        if (!$('viewPosMonitor')?.classList.contains('hidden')) loadPosMonitor();
      }, sec * 1000);
    }
  }

  async function refreshDashboardLive() {
    if (currentApp !== 'warehouse') return;
    try {
      const { monitor } = await fetchPosMonitor();
      monitor._fresh = true;
      renderPosLiveStrip(monitor);
      renderBranchPerformanceTable($('branchPerformanceTable'), monitor.branches);
      renderActivityFeed($('recentInvoicesFeed'), monitor.recent);
      renderHourlyChart($('hourlySalesChart'), monitor.hourly);
      setTimeout(() => $('posLiveStrip')?.classList.remove('live-pulse'), 1200);
    } catch { /* */ }
  }

  async function pollDataRevision() {
    try {
      const data = await api('/admin/data-revision');
      const rev = Number(data.revision || 0);
      if (lastKnownRevision && rev > lastKnownRevision) {
        const active = document.querySelector('.nav.active')?.dataset.view;
        if (active === 'dashboard') refreshDashboardLive();
        if (active === 'posMonitor') loadPosMonitor();
        if (active === 'invoices') loadInvoices();
        if (active === 'payments') loadPayments();
        if (active === 'journal') loadJournal();
        if (active === 'accounts') loadAccounts();
        if (active === 'warehousePrep') loadWarehousePrep();
        if (active === 'edariSync') loadEdariSync();
      }
      if (rev) lastKnownRevision = rev;
      const pill = $('dataRevPill');
      if (pill && rev) pill.textContent = `rev ${rev}`;
    } catch { /* */ }
  }

  window.loadPosMonitor = async function loadPosMonitor() {
    if (currentApp !== 'warehouse') return;
    await fetchBranches();
    fillBranchSelect($('posMonBranch'));
    const { monitor, revision } = await fetchPosMonitor();
    if (revision) lastKnownRevision = Number(revision);
    const t = monitor.totals || {};

    renderBranchHealthAlerts(monitor);

    $('posMonitorHero').className = 'kpi-grid premium-kpis pos-monitor-hero';
    $('posMonitorHero').innerHTML = `
      <div class="kpi premium-kpi accent"><div class="ico">📡</div><div class="lbl">فروع متصلة</div><div class="val">${t.onlineBranches || 0} / ${t.totalBranches || 0}</div></div>
      <div class="kpi premium-kpi"><div class="ico">🧾</div><div class="lbl">فواتير اليوم</div><div class="val">${t.salesCount || 0}</div></div>
      <div class="kpi premium-kpi"><div class="ico">💵</div><div class="lbl">مبيعات اليوم</div><div class="val" dir="ltr">${fmt(t.salesAmount)}</div></div>
      <div class="kpi premium-kpi"><div class="ico">📈</div><div class="lbl">صافي اليوم</div><div class="val" dir="ltr">${fmt(t.netSales)}</div></div>
      <div class="kpi premium-kpi"><div class="ico">↩️</div><div class="lbl">مرتجعات</div><div class="val">${t.returnsCount || 0}</div></div>
      <div class="kpi premium-kpi"><div class="ico">📤</div><div class="lbl">إخراج مخزون</div><div class="val">${t.issuesCount || 0}</div></div>
      <div class="kpi premium-kpi"><div class="ico">🧮</div><div class="lbl">متوسط الفاتورة</div><div class="val" dir="ltr">${fmt(t.avgTicket)}</div></div>
      <div class="kpi premium-kpi warn"><div class="ico">⏳</div><div class="lbl">بانتظار المزامنة</div><div class="val">${monitor.pendingSync || 0}</div></div>`;

    renderBranchPerformanceTable($('posMonBranchTable'), monitor.branches, { clickable: true });
    renderHourlyChart($('posMonHourly'), monitor.hourly);
    renderPaymentMix($('posMonPaymentMix'), monitor.byPayment);

    const recent = monitor.recent || [];
    const prevIds = lastPosInvoiceIds;
    const hasNew = recent.some((i) => !prevIds.has(i.id) && prevIds.size > 0);
    lastPosInvoiceIds = new Set(recent.map((i) => i.id));

    $('posMonCount').textContent = `${recent.length} فاتورة`;
    $('posMonInvoiceTable').innerHTML = `
      <table class="data-table striped" id="posMonInvoicesTable">
        <thead><tr>
          <th>الوقت</th><th>الفرع</th><th>الرقم</th><th>النوع</th><th>العميل</th><th>الكاشير</th><th>الدفع</th><th>الإجمالي</th><th>الإداري</th>
        </tr></thead>
        <tbody>${recent.length ? recent.map((i, idx) => `
          <tr class="clickable-row${hasNew && idx < 3 ? ' row-new' : ''}" data-invoice-id="${i.id}">
            <td>${esc((i.createdAt || '').slice(11, 16) || '—')}</td>
            <td>${esc(i.branchName || '—')}</td>
            <td><strong>${esc(i.invoiceNo)}</strong></td>
            <td>${kindBadgeHtml(i.kind)}</td>
            <td>${esc(i.customerName || 'نقدي')}</td>
            <td>${esc(i.cashierName || '—')}</td>
            <td>${payMethodLabel(i.paymentMethod)}</td>
            <td dir="ltr"><strong>${fmtPrice(i.total, i.currency)}</strong></td>
            <td>${edariSyncLabel(i.edariSyncStatus)}</td>
          </tr>`).join('') : '<tr><td colspan="9">لا توجد فواتير</td></tr>'}
        </tbody>
      </table>`;
    $('posMonInvoiceTable').querySelectorAll('[data-invoice-id]').forEach((row) => {
      row.addEventListener('click', () => openInvoice(Number(row.dataset.invoiceId)));
    });

    const now = new Date();
    $('posMonUpdated').textContent = `آخر تحديث: ${now.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    setupPosMonAutoRefresh();
  };

  $('btnPosMonRefresh')?.addEventListener('click', () => loadPosMonitor());
  $('btnExportPosMon')?.addEventListener('click', () => {
    exportTableCsv($('posMonInvoicesTable'), `pos-live-${Date.now()}.csv`);
    toast('تم تصدير سجل نقاط البيع');
  });
  $('posMonBranch')?.addEventListener('change', () => loadPosMonitor());
  $('posMonKind')?.addEventListener('change', () => loadPosMonitor());
  $('posMonPayment')?.addEventListener('change', () => loadPosMonitor());
  $('posMonEdari')?.addEventListener('change', () => loadPosMonitor());
  $('posMonSearch')?.addEventListener('input', debounce(() => loadPosMonitor(), 280));
  $('posMonRefresh')?.addEventListener('change', setupPosMonAutoRefresh);

  PAGE_TITLES.reports = ['تقارير الشورجة', 'مبيعات فروع الشورجة فقط — بدون المندوبين'];
  PAGE_TITLES.posMonitor = ['مراقبة نقاط البيع', 'متابعة حية للفروع والفواتير'];
  PAGE_TITLES.warehousePrep = ['تجهيز الشورجة', 'فواتير فروع الشورجة الجاهزة للترحيل'];
  PAGE_TITLES.delegates = ['المندوبين', 'طلبات المندوبين فقط — منفصلة عن الشورجة'];
  PAGE_TITLES.products = ['المنتجات', 'المخزون والأقسام — بحث وتصدير'];
  PAGE_TITLES.prices = ['الأسعار', 'رفع المنتجات والأسعار إلى نقاط البيع'];
  PAGE_TITLES.journal = ['القيود', 'كل الحركات المحلية — الحذف لا يلغي الإداري'];
  PAGE_TITLES.invoices = ['فواتير الشورجة', 'بحث وفلاتر وتصدير — الحذف محلي فقط'];

  function setupKeyboard() {
    $('btnKbdHelp')?.addEventListener('click', () => $('kbdHelp')?.showModal());

    const paletteViews = () => {
      const names = currentApp === 'delegate'
        ? [['dashboard', 'لوحة المندوبين'], ['delegates', 'فواتير المندوبين'], ['accounts', 'حسابات المندوبين'], ['payments', 'تسديدات'], ['edariSync', 'مزامنة الإداري']]
        : [['dashboard', 'لوحة اليوم'], ['posMonitor', 'مراقبة نقاط البيع'], ['reports', 'التقارير'], ['invoices', 'الفواتير'], ['warehousePrep', 'تجهيز الشورجة'], ['products', 'المنتجات'], ['prices', 'الأسعار'], ['accounts', 'الحسابات'], ['payments', 'التسديدات'], ['journal', 'القيود'], ['edariSync', 'مزامنة الإداري']];
      return names;
    };

    function renderPalette(q = '') {
      const list = $('cmdPaletteList');
      if (!list) return;
      const query = q.trim();
      const items = paletteViews().filter(([, label]) => !query || label.includes(query) || label.toLowerCase().includes(query.toLowerCase()));
      list.innerHTML = items.map(([view, label], i) =>
        `<button type="button" class="cmd-item${i === 0 ? ' active' : ''}" data-view="${view}">${label}</button>`
      ).join('') || '<p class="empty-cell">لا توجد صفحة مطابقة</p>';
      list.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
          $('cmdPalette')?.close();
          goToView(btn.dataset.view);
        });
      });
    }

    function openPalette() {
      renderPalette();
      $('cmdPalette')?.showModal();
      const inp = $('cmdPaletteInput');
      if (inp) { inp.value = ''; inp.focus(); }
    }

    $('cmdPaletteInput')?.addEventListener('input', () => renderPalette($('cmdPaletteInput').value));
    $('cmdPaletteInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('cmdPaletteList')?.querySelector('.cmd-item')?.click();
      }
      if (e.key === 'Escape') $('cmdPalette')?.close();
    });
    $('headerJump')?.addEventListener('focus', openPalette);
    $('headerJump')?.addEventListener('click', openPalette);

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        $('kbdHelp')?.showModal();
      }
      if ((e.key === '/' || e.key === 'F2') && !typing) {
        e.preventDefault();
        const view = document.querySelector('.nav.active')?.dataset.view;
        $(PAGE_SEARCH_MAP[view])?.focus();
      }
      if (e.key === 'Escape') {
        document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      }
    });
  }

  // ——— Init ———
  function initPremium() {
    decorateNav();
    setupAppSwitcher();
    setupHeader();
    setupQuickActions();
    setupKeyboard();
    fetchBranches();
    pollDataRevision();
    if (!revisionPollTimer) revisionPollTimer = setInterval(pollDataRevision, 12000);

    const today = new Date().toISOString().slice(0, 10);
    if ($('reportFrom')) $('reportFrom').value = today;
    if ($('reportTo')) $('reportTo').value = today;
    if ($('invFrom')) $('invFrom').value = today;
    if ($('invTo')) $('invTo').value = today;

    if (token && $('app') && !$('app').classList.contains('hidden')) {
      api('/auth/me').then((d) => {
        currentUser = d.user;
        $('sidebarUserName').textContent = currentUser?.fullName || 'مدير';
      }).catch(() => {});
      const homeView = 'dashboard';
      const navRoot = currentApp === 'delegate' ? '#navDelegate' : '#navWarehouse';
      setTimeout(() => {
        document.querySelector(`${navRoot} .nav[data-view="${homeView}"]`)?.click();
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPremium);
  } else {
    initPremium();
  }
})();
