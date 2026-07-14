const { runQuery, rowObjects } = require('../server/lib/edari-bridge');

(async () => {
  const tables = ['FileCap', 'FileGDt', 'FileCnst', 'FileBlBk', 'FilePOS4', 'FilePOS5'];
  for (const t of tables) {
    const r = await runQuery(`SELECT TOP 3 * FROM ${t}`);
    console.log(`\n=== ${t} ===`);
    if (!r.ok) console.log('ERR', String(r.error).slice(0, 200));
    else {
      const rows = rowObjects(r);
      console.log('cols sample', rows[0] ? Object.keys(rows[0]) : []);
      console.log(JSON.stringify(rows, null, 2));
    }
  }
  const max15 = await runQuery('SELECT MAX(Seq) AS m FROM File15n');
  const max12 = await runQuery('SELECT MAX(Seq) AS m FROM File12n');
  console.log('\nmax File15n', rowObjects(max15));
  console.log('max File12n', rowObjects(max12));
})().catch((e) => { console.error(e.message); process.exit(1); });
