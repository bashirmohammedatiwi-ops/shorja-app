#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
delete require.cache[require.resolve('../server/lib/edari-invoices')];

(async () => {
  const mod = require('../server/lib/edari-invoices');
  const { lookupAccountSeqByNum } = require('../server/lib/edari-accounts');

  const seq = await lookupAccountSeqByNum(process.env.EDARI_WALKIN_CUSTOMER_NUM || '121119002');
  console.log('walk-in seq by num:', seq);

  const cashPayload = {
    kind: 'sale',
    paymentMethod: 'cash',
    paidAmount: 50000,
    dueAmount: 0,
    accountId: null
  };
  const creditPayload = {
    kind: 'sale',
    paymentMethod: 'credit',
    paidAmount: 0,
    dueAmount: 50000,
    accountId: 5,
    edariSeq: '2203'
  };

  const resolveCustomerSeq = mod.resolveCustomerSeq || (async (p) => {
    const { runQuery, rowObjects } = require('../server/lib/edari-bridge');
    const r = await runQuery(`SELECT Seq FROM File11n WHERE Num='121119002'`);
    return Number(rowObjects(r)[0]?.Seq || 0);
  });

  if (typeof mod.resolveCustomerSeq === 'function') {
    console.log('cash customer seq:', await mod.resolveCustomerSeq(cashPayload));
    console.log('credit customer seq:', await mod.resolveCustomerSeq(creditPayload));
  } else {
    console.log('resolveCustomerSeq not exported — testing lookup only');
  }
})().catch((e) => { console.error(e); process.exit(1); });
