#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const r = await runQuery(`
    SELECT Seq, Num, Name1, Master
    FROM File11n
    WHERE Num IN ('121100','121101','121102','121103','121104','121105','1210911')
       OR Num LIKE '12110%'
    ORDER BY Num`);
  console.log(JSON.stringify(rowObjects(r), null, 2));

  const kids = await runQuery(`SELECT Seq, Num FROM File11n WHERE Master = 2166 ORDER BY Num`);
  console.log('\nchildren sorted by Num:');
  console.log(rowObjects(kids).map((x) => x.Num).join(', '));

  const free = await runQuery(`
    SELECT Seq, Num, Name1, Master FROM File11n
    WHERE Num LIKE '121099%' OR Num IN ('1210991','1210992','1210993','1210994','1210995','1210996')
    ORDER BY Num`);
  console.log('\n121099x existing:');
  console.log(JSON.stringify(rowObjects(free), null, 2));
})();
