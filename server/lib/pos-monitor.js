const db = require('../db');
const { DELEGATE_BRANCH_CODE } = require('./delegate-processed');
const { getLatestVersion } = require('./prices');

function branchOnline(lastSeenAt, minutes = 5) {
  if (!lastSeenAt) return false;
  const t = new Date(String(lastSeenAt).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return false;
  return Date.now() - t.getTime() < minutes * 60 * 1000;
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return null;
  return Math.round((Date.now() - t.getTime()) / 60000);
}

function getPosMonitor({
  branchId = null,
  limit = 30,
  q = '',
  kind = '',
  paymentMethod = '',
  edariStatus = '',
  todayOnly = true
} = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const latestPriceVersion = getLatestVersion();
  const branches = db.prepare(`
    SELECT id, code, name, last_seen_at, price_version
    FROM branches WHERE code != ? ORDER BY id
  `).all(DELEGATE_BRANCH_CODE);

  const branchStats = branches.map((b) => {
    const sales = db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS amount,
        COALESCE(SUM(paid_amount), 0) AS paid, COALESCE(SUM(due_amount), 0) AS due
      FROM invoices WHERE branch_id = ? AND invoice_date = ? AND kind = 'sale'
    `).get(b.id, today);
    const returns = db.prepare(`
      SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS amount
      FROM invoices WHERE branch_id = ? AND invoice_date = ? AND kind = 'return'
    `).get(b.id, today);
    const issues = db.prepare(`
      SELECT COUNT(*) AS c FROM invoices WHERE branch_id = ? AND invoice_date = ? AND kind = 'issue'
    `).get(b.id, today);
    const lastInv = db.prepare(`
      SELECT created_at FROM invoices
      WHERE branch_id = ? AND COALESCE(prep_mode, 'branch') != 'delegate'
      ORDER BY created_at DESC LIMIT 1
    `).get(b.id);
    const pendingBranch = db.prepare(`
      SELECT COUNT(*) AS c FROM invoices
      WHERE branch_id = ? AND sync_status = 'pending' AND COALESCE(prep_mode, 'branch') != 'delegate'
    `).get(b.id);
    const priceVer = b.price_version || 0;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      lastSeenAt: b.last_seen_at,
      priceVersion: priceVer,
      priceStale: priceVer < latestPriceVersion,
      online: branchOnline(b.last_seen_at),
      minutesOffline: branchOnline(b.last_seen_at) ? 0 : minutesSince(b.last_seen_at),
      lastInvoiceAt: lastInv?.created_at || null,
      minutesSinceLastSale: minutesSince(lastInv?.created_at),
      salesCount: sales.c,
      salesAmount: Number(sales.amount),
      paidAmount: Number(sales.paid),
      dueAmount: Number(sales.due),
      returnsCount: returns.c,
      returnsAmount: Number(returns.amount),
      issuesCount: issues.c,
      pendingSync: Number(pendingBranch.c),
      netSales: Number(sales.amount) - Number(returns.amount)
    };
  });

  const recentWhere = ["COALESCE(i.prep_mode, 'branch') != 'delegate'"];
  const recentParams = [];
  if (todayOnly) {
    recentWhere.push('i.invoice_date = ?');
    recentParams.push(today);
  }
  if (branchId) {
    recentWhere.push('i.branch_id = ?');
    recentParams.push(branchId);
  }
  if (kind) {
    recentWhere.push('i.kind = ?');
    recentParams.push(kind);
  }
  if (paymentMethod) {
    recentWhere.push('i.payment_method = ?');
    recentParams.push(paymentMethod);
  }
  if (edariStatus === 'pending') {
    recentWhere.push("COALESCE(i.edari_sync_status, 'none') IN ('pending', 'none', 'hold')");
  } else if (edariStatus === 'synced') {
    recentWhere.push("i.edari_sync_status = 'synced'");
  } else if (edariStatus === 'error') {
    recentWhere.push("i.edari_sync_status = 'error'");
  }
  if (q) {
    recentWhere.push('(i.invoice_no LIKE ? OR i.customer_name LIKE ? OR EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND (l.barcode LIKE ? OR l.name LIKE ?)))');
    const like = `%${q}%`;
    recentParams.push(like, like, like, like);
  }
  const recentRows = db.prepare(`
    SELECT i.*, a.name AS account_name, br.name AS branch_name, u.full_name AS cashier_name
    FROM invoices i
    LEFT JOIN accounts a ON a.id = i.account_id
    LEFT JOIN branches br ON br.id = i.branch_id
    LEFT JOIN users u ON u.id = i.cashier_id
    WHERE ${recentWhere.join(' AND ')}
    ORDER BY i.created_at DESC LIMIT ?
  `).all(...recentParams, Math.min(limit, 100));

  const hourlyWhere = ['invoice_date = ?', "kind = 'sale'", "COALESCE(prep_mode, 'branch') != 'delegate'"];
  const hourlyParams = [today];
  if (branchId) {
    hourlyWhere.push('branch_id = ?');
    hourlyParams.push(branchId);
  }
  const hourly = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
      COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
    FROM invoices WHERE ${hourlyWhere.join(' AND ')}
    GROUP BY hour ORDER BY hour
  `).all(...hourlyParams);

  const payWhere = ['invoice_date = ?', "kind = 'sale'", "COALESCE(prep_mode, 'branch') != 'delegate'"];
  const payParams = [today];
  if (branchId) {
    payWhere.push('branch_id = ?');
    payParams.push(branchId);
  }
  const byPayment = db.prepare(`
    SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
    FROM invoices WHERE ${payWhere.join(' AND ')}
    GROUP BY payment_method ORDER BY amount DESC
  `).all(...payParams);

  const totals = branchStats.reduce((acc, b) => {
    acc.salesCount += b.salesCount;
    acc.salesAmount += b.salesAmount;
    acc.returnsCount += b.returnsCount;
    acc.returnsAmount += b.returnsAmount;
    acc.issuesCount += b.issuesCount;
    acc.netSales += b.netSales;
    acc.onlineBranches += b.online ? 1 : 0;
    acc.offlineBranches += b.online ? 0 : 1;
    acc.stalePriceBranches += b.priceStale ? 1 : 0;
    return acc;
  }, {
    salesCount: 0,
    salesAmount: 0,
    returnsCount: 0,
    returnsAmount: 0,
    issuesCount: 0,
    netSales: 0,
    onlineBranches: 0,
    offlineBranches: 0,
    stalePriceBranches: 0,
    totalBranches: branchStats.length
  });
  totals.avgTicket = totals.salesCount > 0 ? Math.round(totals.salesAmount / totals.salesCount) : 0;

  const pendingSync = db.prepare(`
    SELECT COUNT(*) AS c FROM invoices
    WHERE sync_status = 'pending' AND COALESCE(prep_mode, 'branch') != 'delegate'
  `).get().c;

  return {
    date: today,
    latestPriceVersion,
    branches: branchStats,
    totals,
    pendingSync: Number(pendingSync),
    byPayment: byPayment.map((p) => ({
      method: p.method,
      count: p.count,
      amount: Number(p.amount)
    })),
    recent: recentRows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      branchId: r.branch_id,
      branchName: r.branch_name || '',
      kind: r.kind,
      customerName: r.customer_name || '',
      cashierName: r.cashier_name || '',
      total: Number(r.total || 0),
      paidAmount: Number(r.paid_amount || 0),
      dueAmount: Number(r.due_amount || 0),
      paymentMethod: r.payment_method,
      edariSyncStatus: r.edari_sync_status || 'none',
      invoiceDate: r.invoice_date,
      createdAt: r.created_at
    })),
    hourly: hourly.map((h) => ({
      hour: h.hour,
      count: h.count,
      amount: Number(h.amount)
    }))
  };
}

module.exports = { getPosMonitor, branchOnline };
