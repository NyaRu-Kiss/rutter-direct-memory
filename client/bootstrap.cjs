#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const names = ['hook.cjs', 'install.cjs', 'mcp.cjs', 'transcript.cjs', 'upload.cjs'];

function baseUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS server URL, or HTTP on localhost.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

async function download(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const size = Number(response.headers.get('content-length'));
  if (size > limit) throw new Error('Download exceeds size limit.');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new Error('Download exceeds size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the installer in an interactive terminal.');
  const base = baseUrl(process.argv[2]);
  const manifest = JSON.parse((await download(`${base}/direct-memory-client/manifest.json`, 16384)).toString('utf8'));
  if (!/^[a-f0-9]{20}$/.test(manifest.version) || !manifest.files || Object.keys(manifest.files).length !== names.length || names.some(name => !/^[a-f0-9]{64}$/.test(manifest.files[name] || ''))) throw new Error('Invalid package manifest.');
  const root = path.join(process.env.HOME || os.homedir(), '.config', 'rutter-direct-memory', 'releases');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(root, '.download-'));
  try {
    for (const name of names) {
      const data = await download(`${base}/direct-memory-client/${name}`, 10 * 1024 * 1024);
      if (crypto.createHash('sha256').update(data).digest('hex') !== manifest.files[name]) throw new Error(`Checksum mismatch: ${name}`);
      fs.writeFileSync(path.join(stage, name), data, { mode: 0o600, flag: 'wx' });
    }
    const release = path.join(root, manifest.version);
    if (fs.existsSync(release)) {
      for (const name of names) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex');
        if (hash !== manifest.files[name]) throw new Error('Existing release has unexpected contents; remove it before retrying.');
      }
    } else fs.renameSync(stage, release);
    const result = spawnSync(process.execPath, [path.join(release, 'install.cjs'), ...process.argv.slice(3)], { stdio: 'inherit', env: { ...process.env, RUTTER_DIRECT_MEMORY_SERVER: base } });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { baseUrl, download };
