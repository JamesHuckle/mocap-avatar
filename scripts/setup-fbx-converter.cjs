const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const converterDir = path.dirname(require.resolve('fbx2vrma-converter/package.json'));
const script = path.join(converterDir, process.platform === 'win32' ? 'setup.bat' : 'setup.sh');

// The published Unix setup script has CRLF line endings and downloads into cwd.
if (process.platform !== 'win32') {
  fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace(/\r\n/g, '\n'));
}
const setup = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/c', script], {cwd: converterDir, stdio: 'inherit'})
  : spawnSync('bash', [script], {cwd: converterDir, stdio: 'inherit'});
if (setup.error) throw setup.error;
process.exit(setup.status ?? 1);
