#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const files = ['hook.cjs', 'install.cjs', 'mcp.cjs', 'transcript.cjs', 'upload.cjs'];

function installBundle(bundle, env = process.env) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  if (!/^[a-f0-9]{20}$/.test(manifest.version) || !manifest.files || Object.keys(manifest.files).length !== files.length
    || files.some(file => !/^[a-f0-9]{64}$/.test(manifest.files[file] || ''))) throw new Error('Invalid client package manifest.');
  const payload = files.map(file => {
    const data = fs.readFileSync(path.join(bundle, file));
    if (crypto.createHash('sha256').update(data).digest('hex') !== manifest.files[file]) throw new Error(`Checksum mismatch: ${file}`);
    return [file, data];
  });
  const root = path.join(env.HOME || os.homedir(), '.config', 'rutter-direct-memory', 'releases');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const release = path.join(root, manifest.version);
  if (fs.existsSync(release)) {
    for (const [file] of payload) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(release, file))).digest('hex');
      if (hash !== manifest.files[file]) throw new Error('Existing release has unexpected contents; remove it before retrying.');
    }
    return release;
  }
  const stage = fs.mkdtempSync(path.join(root, '.package-'));
  try {
    for (const [file, data] of payload) fs.writeFileSync(path.join(stage, file), data, { mode: 0o600, flag: 'wx' });
    fs.renameSync(stage, release);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  return release;
}

function main(argv = process.argv.slice(2), { bundle = path.resolve(__dirname, '../client'), env = process.env } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  let server;
  const forwarded = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--server') {
      server = argv[++index];
      if (!server || server.startsWith('--')) throw new Error('--server requires a Memory server URL.');
    } else if (arg.startsWith('--server=')) server = arg.slice(9);
    else forwarded.push(arg);
  }
  const installer = require(path.join(bundle, 'install.cjs'));
  const args = installer.parseArgs(forwarded);
  if (!['both', 'codex', 'claude'].includes(args.client)) throw new Error('client must be both, codex or claude.');
  if (args.help) {
    process.stdout.write('Usage: rutter-direct-memory [--server https://memory.example.com] [--client both|codex|claude] [--reconfigure] [--uninstall]\nInstalls Hook and MCP from this package. Requires a Memory user credential; no model API key or SSH password.\n');
    return 0;
  }
  if (server !== undefined) server = require(path.join(bundle, 'bootstrap.cjs')).baseUrl(server);
  const release = installBundle(bundle, env);
  const result = spawnSync(process.execPath, [path.join(release, 'install.cjs'), ...forwarded], {
    stdio: 'inherit', env: { ...env, ...(server ? { RUTTER_DIRECT_MEMORY_SERVER: server } : {}) },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { installBundle, main };
