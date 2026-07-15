const path = require('path');
const fs = require('fs');
const Module = require('module');

let registered = false;

/** سكربتات Edari في resources/edari تحتاج node_modules من app.asar أو edari/node_modules */
function registerEdariModulePaths(app) {
  if (registered) return;
  if (!app?.isPackaged) return;

  const candidates = [
    path.join(process.resourcesPath, 'edari', 'node_modules'),
    path.join(app.getAppPath(), 'node_modules')
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir) && !Module.globalPaths.includes(dir)) {
      Module.globalPaths.unshift(dir);
    }
  }
  registered = true;
}

module.exports = { registerEdariModulePaths };
