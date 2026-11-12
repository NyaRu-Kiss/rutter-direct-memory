#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { parseTranscript } = require('./transcript.cjs');
const { readConfig, configPath, readSession } = require('./hook.cjs');

const MAX_QUEUE = 500;
const MAX_SEEN = 100000;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_MESSAGE = 8192;

function directory(env = process.env) { return path.join(env.HOME || require('node:os').homedir(), '.config', 'rutter-direct-memory'); }
function statePath(env) { return path.join(directory(env), 'upload-state.json'); }
function emptyState() { return { enabled: false, since: 0, queue: [], seen: {}, manually_disabled: false }; }
function configFingerprint(config) {
  return crypto.createHash('sha256').update(JSON.stringify([config.service_url, config.service_id, config.memory_user_key])).digest('hex');
}
function checkIdentity(state, config, env) {
  if (state.fingerprint === configFingerprint(config)) return true;
  state.enabled = false;
  state.manually_disabled = true;
  state.queue = [];
  writeState(env, state);
  return false;
}
function readState(env) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(env), 'utf8'));
    if (typeof state.enabled !== 'boolean' || !Array.isArray(state.queue) || !state.seen || typeof state.seen !== 'object') throw new Error();
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw new Error('本地上传状态无法读取，已停止采集。');
  }
}
function writeState(env, state) {
  const dir = directory(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = statePath(env);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

async function enableForSession(env = process.env) {
  return withLock(env, async () => {
    const config = readConfig(configPath(env));
    const state = readState(env);
    if (state.manually_disabled) throw new Error('Memory 上传已全局关闭，请先运行 upload.cjs --enable。');
    if (state.enabled && !checkIdentity(state, config, env)) throw new Error('Memory 上传配置已改变，请重新选择。');
    if (!state.enabled) {
      state.enabled = true;
      state.since = Date.now();
      state.queue = [];
      state.seen = {};
      state.fingerprint = configFingerprint(config);
      writeState(env, state);
    }
    return Date.now();
  });
}

async function enableAfterInstall(env = process.env) {
  return withLock(env, async () => {
    const fingerprint = configFingerprint(readConfig(configPath(env)));
    const previous = readState(env);
    // Preserve queued messages only when uploading remained enabled for the same identity.
    if (previous.enabled && previous.fingerprint === fingerprint) return;
    writeState(env, { ...emptyState(), enabled: true, since: Date.now(), fingerprint });
  });
}

async function withLock(env, fn) {
  const dir = directory(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, 'upload.lock');
  let acquired = false;
  for (let i = 0; i < 300; i++) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(path.join(lock, 'owner'), String(process.pid), { mode: 0o600 });
      acquired = true;
      break;
    }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 120000) {
          let owner;
          try { owner = Number(fs.readFileSync(path.join(lock, 'owner'), 'utf8')); }
          catch (ownerError) { if (ownerError.code === 'ENOENT') fs.rmdirSync(lock); continue; }
          if (Number.isInteger(owner) && owner > 0) {
            try { process.kill(owner, 0); }
            catch (probeError) {
              if (probeError.code === 'ESRCH') { fs.unlinkSync(path.join(lock, 'owner')); fs.rmdirSync(lock); }
            }
          }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!acquired) throw new Error('上传队列正在使用，请稍后重试。');
  try { return await fn(); } finally { fs.unlinkSync(path.join(lock, 'owner')); fs.rmdirSync(lock); }
}

function splitMessage(message) {
  const chunks = [];
  for (let index = 0; index < message.content.length;) {
    let end = Math.min(index + MAX_MESSAGE, message.content.length);
    if (end < message.content.length && /[\uD800-\uDBFF]/.test(message.content[end - 1])) end--;
    const content = message.content.slice(index, end);
    chunks.push({ ...message, content, direct_event_id: crypto.createHash('sha256').update(`${message.direct_event_id}:${index}`).digest('hex') });
    index = end;
  }
  return chunks;
}

async function flush(state, config, env, fetcher = fetch) {
  if (!checkIdentity(state, config, env)) return 'Memory 连接配置已改变，上传已停止并清除本地待传内容。';
  let attempted = 0;
  while (state.enabled && state.queue.length && attempted++ < 10) {
    const item = state.queue[0];
    let response;
    try {
      response = await fetcher(`${config.service_url}/hierarchy/direct-memory/conversation`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', 'x-tdai-service-id': config.service_id, 'x-tdai-user-key': config.memory_user_key },
        body: JSON.stringify(item),
      });
    } catch { return 'Memory 上传暂时不可用，待传内容已保存在本机。'; }
    if (response.status === 401 || response.status === 403) {
      state.enabled = false;
      state.manually_disabled = true;
      state.queue = [];
      writeState(env, state);
      return 'Memory 上传授权已失效，已停止采集并删除本地待传内容。';
    }
    let data;
    try { data = await response.json(); } catch { return 'Memory 上传响应无效，待传内容已保存在本机。'; }
    if (!response.ok || data?.code !== 0) return 'Memory 上传失败，待传内容已保存在本机。';
    state.queue.shift();
    writeState(env, state);
  }
  return state.queue.length ? 'Memory 待传队列尚未处理完，将在后续事件继续。' : '';
}

async function capture({ client, event, env = process.env, fetcher = fetch }) {
  if (event?.hook_event_name !== 'Stop' || !['codex', 'claude'].includes(client)) return '';
  return withLock(env, async () => {
    const state = readState(env);
    if (!state.enabled) return '';
    const config = readConfig(configPath(env));
    if (!checkIdentity(state, config, env)) return 'Memory 连接配置已改变，上传已停止并清除本地待传内容。';
    if (typeof event.session_id !== 'string' || !event.session_id || typeof event.cwd !== 'string' || typeof event.transcript_path !== 'string') return 'Memory 未采集：客户端未提供会话记录。';
    const session = readSession(client, event.session_id, path.resolve(event.cwd), env);
    if (session?.mode === 'off' || !session?.upload_enabled_at || session.upload_enabled_at < state.since) return '';
    if (!session) return 'Memory 未采集：当前会话尚未关联项目。';
    if (typeof session.session_binding !== 'string' || !/^[a-f0-9]{64}$/.test(session.session_binding)) return 'Memory 未采集：尚未取得服务端会话绑定。';
    let parsed;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const stat = fs.statSync(event.transcript_path);
        if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) return 'Memory 未采集：会话记录超过大小限制。';
        parsed = parseTranscript(client, event.session_id, fs.readFileSync(event.transcript_path, 'utf8'), state.since);
        const expected = typeof event.last_assistant_message === 'string' ? event.last_assistant_message : '';
        const lastAssistant = [...parsed.messages].reverse().find(message => message.role === 'assistant');
        if (!parsed.incomplete && (!expected || lastAssistant?.content === expected)) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      parsed = undefined;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!parsed || parsed.incomplete) return 'Memory 未采集：会话记录尚未完整写入，将在后续事件重试。';
    const prior = await flush(state, config, env, fetcher);
    if (!state.enabled) return prior;
    const selection = Object.fromEntries(['team_id', 'company_id', 'project_id', 'agent_id', 'task_id'].map(key => [key, session[key]]));
    let full = false;
    let seenCount = Object.keys(state.seen).length;
    for (const message of parsed.messages) {
      const chunks = splitMessage(message);
      const unseen = chunks.filter(chunk => !state.seen[chunk.direct_event_id]);
      if (state.queue.length + unseen.length > MAX_QUEUE || seenCount + unseen.length > MAX_SEEN) { full = true; break; }
      for (const chunk of unseen) {
        state.queue.push({ ...selection, session_id: event.session_id, session_binding: session.session_binding, messages: [chunk] });
        state.seen[chunk.direct_event_id] = true;
        seenCount++;
      }
    }
    writeState(env, state);
    const error = await flush(state, config, env, fetcher);
    if (full) return `Memory 待传队列已满，尚未入队的内容将在后续事件重试。${error || ''}`;
    return error || (prior && state.queue.length ? prior : '');
  });
}

async function setConsent(enabled, env = process.env) {
  return withLock(env, async () => {
    const previous = readState(env);
    if (enabled && previous.enabled) throw new Error('自动上传已开启；原待传队列未更改。');
    const state = emptyState();
    state.enabled = enabled;
    state.manually_disabled = !enabled;
    state.since = enabled ? Date.now() : 0;
    if (enabled) state.fingerprint = configFingerprint(readConfig(configPath(env)));
    writeState(env, state);
  });
}

async function retry(env = process.env, fetcher = fetch) {
  return withLock(env, async () => {
    const state = readState(env);
    if (!state.enabled) return '自动上传未开启。';
    return flush(state, readConfig(configPath(env)), env, fetcher);
  });
}

async function main() {
  const action = process.argv[2];
  if (action === '--enable') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('开启上传需要交互式终端。');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('将主会话的用户文本和最终助手回复上传至配置的 Memory 服务并保存为项目 L0，供记忆处理使用。不上传工具、子 Agent 和思考过程。输入 YES 明确同意：');
    rl.close();
    if (answer !== 'YES') throw new Error('未开启上传。');
    await setConsent(true);
    process.stdout.write('已开启自动上传。\n');
  } else if (action === '--disable') {
    await setConsent(false);
    process.stdout.write('已关闭上传并清除本地待传队列；已上传数据仍保存在 Memory。\n');
  } else if (action === '--status') {
    const state = readState();
    process.stdout.write(`自动上传：${state.enabled ? '开启' : '关闭'}；待传：${state.queue.length} 条。\n`);
  } else if (action === '--retry') {
    const warning = await retry();
    process.stdout.write(`${warning || '待传队列已处理。'}\n`);
  } else throw new Error('用法：node upload.cjs --enable|--disable|--status|--retry');
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { readState, writeState, setConsent, enableForSession, enableAfterInstall, capture, flush, retry, splitMessage, statePath };
