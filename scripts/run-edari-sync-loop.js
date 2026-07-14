#!/usr/bin/env node
/**
 * حلقة مزامنة مستمرة — بديل لتطبيق الإدارة عند تشغيله كخدمة خلفية.
 * الافتراضي: كل 10 ثوانٍ.
 */
const intervalMs = Math.max(5000, Number(process.env.EDARI_SYNC_INTERVAL_MS || 10000));

function runOnce() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [require('path').join(__dirname, 'run-edari-sync-once.js')], {
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await runOnce();
  } finally {
    busy = false;
  }
}

console.log(`Shorja Edari sync loop — every ${intervalMs / 1000}s`);
tick();
setInterval(tick, intervalMs);
