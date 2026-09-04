function pad(n) {
  return String(n).padStart(2, '0');
}

function localStamp(d = new Date()) {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    datetime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}

function resolveInvoiceStamp(data = {}) {
  const fallback = localStamp();
  const dateRaw = String(data.invoiceDate || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : fallback.date;
  const raw = String(data.createdAt || data.localCreatedAt || '').trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/[zZ]$/.test(raw) && !/[+-]\d{2}:\d{2}$/.test(raw)) {
    let datetime = raw.replace('T', ' ').slice(0, 19);
    if (datetime.length === 16) datetime += ':00';
    return { date, datetime };
  }
  return { date, datetime: fallback.datetime };
}

function formatEnglishTime(createdAt) {
  const m = String(createdAt || '').match(/(\d{2}):(\d{2})/);
  if (!m) return '';
  let h = Number(m[1]);
  if (Number.isNaN(h)) return '';
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${pad(h12)}:${min} ${ampm}`;
}

function formatEnglishDate(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(date || '');
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatEnglishDateTime(invoice) {
  const dateEn = formatEnglishDate(invoice.invoiceDate);
  const timeEn = formatEnglishTime(invoice.createdAt);
  return timeEn ? `${dateEn}  ${timeEn}` : dateEn;
}

module.exports = {
  localStamp,
  resolveInvoiceStamp,
  formatEnglishDate,
  formatEnglishTime,
  formatEnglishDateTime
};
