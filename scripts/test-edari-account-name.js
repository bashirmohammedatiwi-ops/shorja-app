const { buildEdariAccountName } = require('../server/lib/edari-accounts');

const cases = [
  {
    in: { name: 'سلمان داود سلمان', phone: '07701234567', address: 'بغداد - الكرادة' },
    out: 'سلمان داود سلمان - بغداد - الكرادة - 07701234567'
  },
  {
    in: { name: 'الزبون ابو غسان الحياة', phone: '07735567008', address: '' },
    out: 'ابو غسان الحياة - 07735567008'
  },
  {
    in: { name: 'كوزمتك منعم', phone: '07740442211', address: 'بغداد - مدينة الصدر - سوق الرضوي' },
    out: 'كوزمتك منعم - بغداد - مدينة الصدر - سوق الرضوي - 07740442211'
  }
];

for (const c of cases) {
  const got = buildEdariAccountName(c.in);
  console.log(got === c.out ? 'OK' : 'FAIL', got);
}
