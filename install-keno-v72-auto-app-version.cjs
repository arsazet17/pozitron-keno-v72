'use strict';

const fs = require('fs');

const wfOld = '.github/workflows/auto-version.yml';
if (fs.existsSync(wfOld)) {
  fs.rmSync(wfOld);
  console.log('REMOVE old auto-version.yml');
}

console.log('PASS installer cleanup');
