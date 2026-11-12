#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { readConfig } = require('./hook.cjs');

const CODEX_MARKER_START = '# >>> rutter-direct-memory-access (managed)';
const CODEX_MARKER_END = '# <<< rutter-direct-memory-access (managed)';
const HOOK_TIMEOUT_SECONDS = 330;

function paths(home = process.env.HOME || os.homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex')) {
  return {
    home,
    config: path.join(home, '.config', 'rutter-direct-memory', 'config.json'),
    claudeSettings: path.join(home, '.claude', 'settings.json'),
    claudeConfig: path.join(home, '.claude.json'),
    codexConfig: path.join(codexHome, 'config.toml'),
  };
}

function atomicWrite(file, contents, mode = 0o600) {
  const directory = path.dirname(file);
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existed) try { fs.chmodSync(directory, 0o700); } catch {}
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temp, contents, { encoding: 'utf8', mode, flag: 'wx' });
  fs.renameSync(temp, file);
  fs.chmodSync(file, mode);
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupPath = `${file}.backup-${stamp}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  fs.copyFileSync(file, backupPath, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(backupPath, fs.statSync(file).mode & 0o777); } catch {}
  return backupPath;
}

function shellQuote(value) {
  if (/[\r\n]/.test(value)) throw new Error('Hook 路径不能包含换行符。');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
}

function quoteCommandPath(hookPath) {
  if (process.platform === 'win32') {
    if (/[\r\n]/.test(hookPath)) throw new Error('Hook 路径不能包含换行符。');
    return `"${hookPath.replace(/"/g, '\\"')}"`;
  }
  return shellQuote(hookPath);
}

function claudeCommand(hookPath) { return `node ${quoteCommandPath(hookPath)} --client claude`; }
function codexCommand(hookPath) { return `node ${shellQuote(hookPath)} --client codex`; }
function codexWindowsCommand(hookPath) {
  if (/[\r\n]/.test(hookPath)) throw new Error('Hook 路径不能包含换行符。');
  return `node "${hookPath.replace(/"/g, '\\"')}" --client codex`;
}

function prepareClaude(settingsFile, hookPath, previousHookPath) {
  let settings = {};
  let exists = fs.existsSync(settingsFile);
  if (exists) {
    try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { throw new Error(`Claude Code 设置文件不是有效 JSON，未修改：${settingsFile}`); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`Claude Code 设置根节点格式无效，未修改：${settingsFile}`);
  }
  const next = structuredClone(settings);
  next.hooks ??= {};
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) throw new Error('Claude Code hooks 设置格式无效，未修改。');
  const command = claudeCommand(hookPath);
  let changed = !exists;
  for (const event of ['UserPromptSubmit', 'Stop']) {
    next.hooks[event] ??= [];
    if (!Array.isArray(next.hooks[event])) throw new Error(`Claude Code ${event} 必须是数组，未修改。`);
    if (previousHookPath && previousHookPath !== hookPath) {
      const oldCommand = claudeCommand(previousHookPath);
      for (const group of next.hooks[event]) {
        if (!Array.isArray(group?.hooks)) continue;
        for (const item of group.hooks) {
          if (item?.type === 'command' && item.command === oldCommand) { item.command = command; changed = true; }
        }
      }
    }
    const installed = next.hooks[event].some(group => Array.isArray(group?.hooks) && group.hooks.some(item => item?.type === 'command' && item.command === command));
    if (!installed) { next.hooks[event].push({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] }); changed = true; }
  }
  return { changed, next, exists };
}

function removeClaude(settingsFile, hookPath) {
  if (!fs.existsSync(settingsFile)) return { changed: false };
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { throw new Error(`Claude Code 设置文件不是有效 JSON，未修改：${settingsFile}`); }
  const command = claudeCommand(hookPath);
  let changed = false;
  for (const event of ['UserPromptSubmit', 'Stop']) {
    const list = settings?.hooks?.[event];
    if (!Array.isArray(list)) continue;
    const nextList = list.map(group => ({ ...group, hooks: Array.isArray(group?.hooks) ? group.hooks.filter(item => !(item?.type === 'command' && item.command === command)) : group?.hooks }))
      .filter(group => !Array.isArray(group?.hooks) || group.hooks.length > 0);
    if (JSON.stringify(list) === JSON.stringify(nextList)) continue;
    changed = true;
    if (nextList.length) settings.hooks[event] = nextList; else delete settings.hooks[event];
  }
  return { changed, next: settings, exists: true };
}

function inspectCodexConfig(source) {
  if (/^\s*hooks\s*=/m.test(source)) throw new Error('Codex config.toml 使用了 inline hooks 表，安装器无法安全合并；未修改。请手动把 UserPromptSubmit Hook 合并进现有 hooks 设置。');
  const lines = source.split(/\r?\n/);
  let section = '';
  for (const line of lines) {
    const table = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/);
    if (table) {
      section = table[1].trim();
      if (['hooks.UserPromptSubmit', 'hooks.UserPromptSubmit.hooks', 'hooks.Stop', 'hooks.Stop.hooks'].includes(section)) {
        throw new Error('Codex config.toml 已有 UserPromptSubmit Hook，安装器不会重复或猜测合并；未修改。请先手动合并 Hook。');
      }
    }
    if (/^\s*hooks\.(UserPromptSubmit|Stop)\s*=/.test(line) || (section === 'hooks' && /^\s*(UserPromptSubmit|Stop)\s*=/.test(line))) {
      throw new Error('Codex config.toml 已定义 UserPromptSubmit 的 inline 配置，安装器不会覆盖或猜测合并；未修改。请先手动合并 Hook。');
    }
  }
}

function prepareCodex(configFile, hookPath) {
  const exists = fs.existsSync(configFile);
  const source = exists ? fs.readFileSync(configFile, 'utf8') : '';
  const block = source.match(new RegExp(`${escapeRegex(CODEX_MARKER_START)}[\\s\\S]*?${escapeRegex(CODEX_MARKER_END)}`))?.[0];
  const base = block ? source.replace(block, '') : source;
  inspectCodexConfig(base);
  const command = codexCommand(hookPath);
  const windowsCommand = process.platform === 'win32' ? `commandWindows = ${JSON.stringify(codexWindowsCommand(hookPath))}\n` : '';
  if (/^\s*\[mcp_servers\.rutter_direct_memory\]/m.test(base)) throw new Error('Codex 已存在 rutter_direct_memory MCP 配置，未修改。');
  const mcpPath = path.join(path.dirname(hookPath), 'mcp.cjs');
  const addition = `${CODEX_MARKER_START}\n[mcp_servers.rutter_direct_memory]\ncommand = "node"\nargs = [${JSON.stringify(mcpPath)}, "codex"]\n\n[[hooks.UserPromptSubmit]]\nstatusMessage = "Loading authorized Memory context"\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\n${windowsCommand}timeout = ${HOOK_TIMEOUT_SECONDS}\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)}\n${windowsCommand}timeout = ${HOOK_TIMEOUT_SECONDS}\n${CODEX_MARKER_END}`;
  const next = block ? source.replace(block, addition) : `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${addition}\n`;
  return { changed: next !== source, next, exists };
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function prepareClaudeMcp(file, hookPath, remove = false) {
  const exists = fs.existsSync(file);
  let config = {};
  if (exists) { try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Claude 配置不是有效 JSON，未修改。'); } }
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.mcpServers && (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)))) throw new Error('Claude MCP 配置格式无效，未修改。');
  const name = 'rutter_direct_memory';
  const entry = { type: 'stdio', command: 'node', args: [path.join(path.dirname(hookPath), 'mcp.cjs'), 'claude'] };
  const current = config.mcpServers?.[name];
  let previousHookPath;
  if (current && JSON.stringify(current) !== JSON.stringify(entry)) {
    const previous = current.type === 'stdio' && current.command === 'node' && Array.isArray(current.args) && current.args.length === 2 && current.args[1] === 'claude' && typeof current.args[0] === 'string' && path.basename(current.args[0]) === 'mcp.cjs' ? current.args[0] : '';
    const previousDir = previous && path.dirname(previous);
    const recognized = previousDir && (path.basename(previousDir) === 'direct-memory-access' || path.basename(path.dirname(previousDir)) === 'releases');
    if (!recognized) throw new Error('Claude 已存在不同的 rutter_direct_memory MCP 配置，未修改。');
    previousHookPath = path.join(previousDir, 'hook.cjs');
  }
  if (remove) { if (!current) return { changed: false }; delete config.mcpServers[name]; if (!Object.keys(config.mcpServers).length) delete config.mcpServers; }
  else { config.mcpServers ??= {}; config.mcpServers[name] = entry; }
  return { changed: remove || !current || Boolean(previousHookPath), next: config, exists, previousHookPath };
}

function removeCodex(configFile) {
  if (!fs.existsSync(configFile)) return { changed: false };
  const source = fs.readFileSync(configFile, 'utf8');
  const expression = new RegExp(`(?:\\r?\\n)?${escapeRegex(CODEX_MARKER_START)}[\\s\\S]*?${escapeRegex(CODEX_MARKER_END)}\\s*`);
  const next = source.replace(expression, '\n').replace(/\n{3,}/g, '\n\n');
  return { changed: next !== source, next, exists: true };
}

function validateNewConfig(config) {
  const url = new URL(config.service_url);
  const localHttp = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', ...(localHttp ? ['http:'] : [])].includes(url.protocol) || url.search || url.hash || !url.pathname.replace(/\/$/, '').endsWith('/v3')) {
    throw new Error('服务地址必须是 HTTPS 的 /v3 API 地址；仅 localhost 可使用 HTTP。');
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(config.service_id)) throw new Error('Service ID 只能包含字母、数字、下划线和连字符。');
  if (!config.memory_user_key || /[\r\n]/.test(config.memory_user_key)) throw new Error('Memory 用户凭证不能为空或包含换行。');
}

function promptLine(label, { hidden = false } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.reject(new Error('首次配置需要交互式终端；请在 TTY 中重新运行安装器。'));
  return new Promise((resolve, reject) => {
    if (!hidden) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(label, answer => { rl.close(); resolve(answer.trim()); });
      return;
    }
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = '';
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    const finish = (error, answer) => {
      stdin.off('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      process.stdout.write('\n');
      error ? reject(error) : resolve(answer);
    };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('配置已取消。'));
        if (char === '\r' || char === '\n') return finish(null, value);
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function configureInteractive(configFile) {
  process.stdout.write('首次配置：Memory 用户凭证仅保存在本机，不会发送给模型。\n');
  const defaultUrl = process.env.RUTTER_DIRECT_MEMORY_SERVER ? `${process.env.RUTTER_DIRECT_MEMORY_SERVER}/v3` : '';
  const serviceUrl = await promptLine(defaultUrl ? `Memory API 地址（回车使用 ${defaultUrl}）：` : 'Memory API 地址（HTTPS，包含 /v3）：') || defaultUrl;
  const serviceId = await promptLine('Service ID：');
  const userKey = await promptLine('Memory 用户凭证（输入时不显示）：', { hidden: true });
  const config = { service_url: serviceUrl.replace(/\/$/, ''), service_id: serviceId, memory_user_key: userKey };
  validateNewConfig(config);
  atomicWrite(configFile, `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

function writePrepared(file, prepared) {
  if (!prepared.changed) return null;
  const backupPath = backup(file);
  const mode = prepared.exists ? fs.statSync(file).mode & 0o777 : 0o600;
  atomicWrite(file, typeof prepared.next === 'string' ? prepared.next : `${JSON.stringify(prepared.next, null, 2)}\n`, mode);
  return backupPath;
}

function install({ client = 'both', hookPath = path.join(__dirname, 'hook.cjs'), home, codexHome } = {}) {
  const filePaths = paths(home, codexHome);
  if (!['both', 'codex', 'claude'].includes(client)) throw new Error('client 必须为 both、codex 或 claude。');
  const plans = [];
  if (client === 'both' || client === 'claude') {
    const mcp = prepareClaudeMcp(filePaths.claudeConfig, hookPath);
    plans.push([filePaths.claudeSettings, prepareClaude(filePaths.claudeSettings, hookPath, mcp.previousHookPath)]);
    plans.push([filePaths.claudeConfig, mcp]);
  }
  if (client === 'both' || client === 'codex') plans.push([filePaths.codexConfig, prepareCodex(filePaths.codexConfig, hookPath)]);
  const backups = [];
  for (const [file, prepared] of plans) {
    const saved = writePrepared(file, prepared);
    if (saved) backups.push(saved);
  }
  return { config: filePaths.config, changed: plans.filter(([, plan]) => plan.changed).map(([file]) => file), backups };
}

function uninstall({ client = 'both', hookPath = path.join(__dirname, 'hook.cjs'), home, codexHome } = {}) {
  const filePaths = paths(home, codexHome);
  if (!['both', 'codex', 'claude'].includes(client)) throw new Error('client 必须为 both、codex 或 claude。');
  const plans = [];
  if (client === 'both' || client === 'claude') {
    const mcp = prepareClaudeMcp(filePaths.claudeConfig, hookPath, true);
    plans.push([filePaths.claudeSettings, removeClaude(filePaths.claudeSettings, mcp.previousHookPath || hookPath)]);
    plans.push([filePaths.claudeConfig, mcp]);
  }
  if (client === 'both' || client === 'codex') plans.push([filePaths.codexConfig, removeCodex(filePaths.codexConfig)]);
  const backups = [];
  for (const [file, prepared] of plans) {
    const saved = writePrepared(file, prepared);
    if (saved) backups.push(saved);
  }
  return { changed: plans.filter(([, plan]) => plan.changed).map(([file]) => file), backups };
}

function parseArgs(args) {
  const parsed = { client: 'both', uninstall: false, reconfigure: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--client') parsed.client = args[++i];
    else if (args[i].startsWith('--client=')) parsed.client = args[i].slice(9);
    else if (args[i] === '--uninstall') parsed.uninstall = true;
    else if (args[i] === '--reconfigure') parsed.reconfigure = true;
    else if (args[i] === '--help' || args[i] === '-h') parsed.help = true;
    else throw new Error(`未知参数：${args[i]}`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('用法：node install.cjs [--client both|codex|claude] [--reconfigure] [--uninstall]\n首次安装会交互式收集 Memory API 地址、Service ID 和 Memory 用户凭证；凭证不回显并以 0600 权限保存。\n');
    return;
  }
  const filePaths = paths();
  if (args.uninstall) {
    const result = uninstall({ client: args.client });
    process.stdout.write(`已移除 Hook：${result.changed.length ? result.changed.join(', ') : '没有需要移除的配置'}\n`);
    return;
  }
  if (args.reconfigure || !fs.existsSync(filePaths.config)) await configureInteractive(filePaths.config);
  readConfig(filePaths.config);
  const result = install({ client: args.client });
  process.stdout.write(`已安装 ${args.client} Hook。Memory 凭证保存在 ${filePaths.config}（仅当前用户可读）。\n`);
  if (result.backups.length) process.stdout.write(`原设置已备份：${result.backups.join(', ')}\n`);
  process.stdout.write('下次运行 Codex 时，若出现 Hook 信任确认，请检查命令路径后在客户端确认；安装器不会绕过该确认。\n');
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { paths, atomicWrite, backup, shellQuote, quoteCommandPath, claudeCommand, codexCommand, codexWindowsCommand, prepareClaude, removeClaude,
  inspectCodexConfig, prepareCodex, removeCodex, validateNewConfig, install, uninstall, parseArgs };
