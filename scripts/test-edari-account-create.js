/**
 * اختبار إنشاء حساب زبون في إداري تحت 12111 (زبائن محل الشورجه).
 * يتطلب Windows + ODBC NexusDB فعّال (EDARI_WRITE_ENABLED=1).
 */
require('dotenv').config();
const { createEdariCustomerAccount, getEdariParentInfo } = require('../server/lib/edari-accounts');

(async () => {
  const parent = await getEdariParentInfo();
  console.log('Parent:', JSON.stringify(parent, null, 2));
  const name = process.argv[2] || `اختبار شورجة ${new Date().toISOString().slice(0, 16)}`;
  const result = await createEdariCustomerAccount({
    name,
    phone: process.argv[3] || '',
    notes: 'shorja-app test'
  });
  console.log('Create:', JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
})().catch((err) => {
  console.error('ERR', err.message);
  process.exit(1);
});
