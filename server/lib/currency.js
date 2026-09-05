const IQD = 'iqd';
const USD = 'usd';

function normalizeCurrency(value) {
  return String(value || '').trim().toLowerCase() === USD ? USD : IQD;
}

function isUsd(value) {
  return normalizeCurrency(value) === USD;
}

function currencyLabel(value) {
  return isUsd(value) ? 'دولار' : 'دينار';
}

function currencySuffix(value) {
  return isUsd(value) ? '$' : 'د.ع';
}

function isPricedProduct(product) {
  return !!product && (product.priced === true || Number(product.priced) === 1) && Number(product.price) > 0;
}

function roundMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (isUsd(currency)) return Math.round(n * 100) / 100;
  return Math.round(n);
}

function convertAmount(amount, fromCurrency, toCurrency, usdToIqd) {
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  const n = Number(amount) || 0;
  if (from === to) return n;
  const rate = Number(usdToIqd) || 0;
  if (rate <= 0) {
    throw new Error('حدّدوا سعر الصرف (كم دينار للدولار) من لوحة التحكم قبل البيع بعملة مختلفة');
  }
  if (from === USD && to === IQD) return n * rate;
  return n / rate;
}

function saleUnitPrice(product, saleCurrency, usdToIqd) {
  if (!isPricedProduct(product)) return 0;
  return roundMoney(
    convertAmount(product.price, product.priceCurrency || IQD, saleCurrency, usdToIqd),
    saleCurrency
  );
}

function edariCurrCode(currency) {
  return isUsd(currency)
    ? Number(process.env.EDARI_USD_CURR || 1)
    : Number(process.env.EDARI_IQD_CURR || 0);
}

function formatMoney(amount, currency) {
  const cur = normalizeCurrency(currency);
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: cur === USD ? 2 : 0,
    maximumFractionDigits: cur === USD ? 2 : 0
  });
  return cur === USD ? `$${formatted}` : `${formatted} د.ع`;
}

module.exports = {
  IQD,
  USD,
  normalizeCurrency,
  isUsd,
  currencyLabel,
  currencySuffix,
  isPricedProduct,
  roundMoney,
  convertAmount,
  saleUnitPrice,
  edariCurrCode,
  formatMoney
};
