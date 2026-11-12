#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_HOOK_INPUT = 1024 * 1024;
const MAX_GATE_BODY = 32 * 1024;
const GATE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DISPLAY = 240;

class MemoryAccessError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'MemoryAccessError';
    this.status = status;
  }
}

function configPath(env = process.env) {
  return env.RUTTER_DIRECT_MEMORY_CONFIG || path.join(env.HOME || os.homedir(), '.config', 'rutter-direct-memory', 'config.json');
}

function stateDirectory(env = process.env) {
  return env.RUTTER_DIRECT_MEMORY_STATE_DIR || path.join(env.HOME || os.homedir(), '.config', 'rutter-direct-memory', 'sessions');
}

function readConfig(file = configPath()) {
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new MemoryAccessError('Memory 接入尚未配置或本地配置无法读取。请先运行安装器完成配置。', 400); }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || typeof config.service_url !== 'string' || typeof config.service_id !== 'string'
    || typeof config.memory_user_key !== 'string' || !config.memory_user_key) {
    throw new MemoryAccessError('Memory 接入配置不完整。请运行安装器检查配置。', 400);
  }
  let url;
  try { url = new URL(config.service_url); } catch { throw new MemoryAccessError('Memory 服务地址无效，请检查本地配置。', 400); }
  const localHttp = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', ...(localHttp ? ['http:'] : [])].includes(url.protocol) || url.search || url.hash || !url.pathname.replace(/\/$/, '').endsWith('/v3')) {
    throw new MemoryAccessError('Memory 服务地址必须是 HTTPS 的 /v3 API 地址。', 400);
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(config.service_id) || /[\r\n]/.test(config.memory_user_key)) {
    throw new MemoryAccessError('Memory 接入配置格式无效，请运行安装器检查配置。', 400);
  }
  return { service_url: url.toString().replace(/\/$/, ''), service_id: config.service_id, memory_user_key: config.memory_user_key };
}

function sessionFile(client, sessionId, env = process.env) {
  const digest = crypto.createHash('sha256').update(`${client}\0${sessionId}`).digest('hex');
  return path.join(stateDirectory(env), `${digest}.json`);
}

function readSession(client, sessionId, cwd, env = process.env) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  try {
    const state = JSON.parse(fs.readFileSync(sessionFile(client, sessionId, env), 'utf8'));
    if (state?.client !== client || state?.session_id !== sessionId || state?.cwd !== cwd) return null;
    if (state.mode === 'off') return state;
    if (!['team_id', 'company_id', 'project_id', 'agent_id'].every(key => typeof state[key] === 'string' && state[key])
      || typeof state.task_id !== 'string') return null;
    return state;
  } catch { return null; }
}

function writeSession(client, sessionId, cwd, selection, env = process.env) {
  const directory = stateDirectory(env);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const file = sessionFile(client, sessionId, env);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  const state = { client, session_id: sessionId, cwd, ...selection, saved_at: new Date().toISOString() };
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function publicError(error) {
  if (error instanceof MemoryAccessError) return error.message.slice(0, MAX_DISPLAY);
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return '连接 Memory 服务超时。请检查网络后重试。';
  return 'Memory 服务暂时不可用。请检查网络和服务状态后重试。';
}

async function requestMemory(config, endpoint, body, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${config.service_url}/hierarchy/direct-memory/${endpoint}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', 'x-tdai-service-id': config.service_id, 'x-tdai-user-key': config.memory_user_key },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new MemoryAccessError('连接 Memory 服务超时。请检查网络后重试。');
    throw new MemoryAccessError('Memory 服务暂时不可用。请检查网络和服务状态后重试。');
  }
  let envelope;
  try { envelope = await response.json(); } catch { throw new MemoryAccessError('Memory 服务返回了无法识别的响应。请重试或取消。'); }
  if (!response.ok || envelope?.code !== 0 || !envelope.data || typeof envelope.data !== 'object') {
    const status = response.status || envelope?.code;
    const message = status === 401 ? 'Memory 用户凭证无效或已过期。请更新本地凭证后重试。'
      : status === 403 ? '所选团队、Agent 或 Task 当前无权访问。请重试或取消。'
        : status === 404 ? '所选项目或资产已不存在。请重新选择或取消。'
          : status === 400 ? 'Memory 请求参数无效。请重试或取消。'
            : 'Memory 服务暂时不可用。请检查网络和服务状态后重试。';
    throw new MemoryAccessError(message, status || 503);
  }
  return envelope.data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function normalizeCatalog(data) {
  if (!Array.isArray(data?.teams)) throw new MemoryAccessError('Memory 服务未返回有效的团队目录。请重试或取消。');
  return data.teams.filter(team => typeof team?.team_id === 'string' && Array.isArray(team.projects) && Array.isArray(team.agents) && Array.isArray(team.tasks))
    .map(team => ({
      team_id: team.team_id, name: String(team.name || team.team_id),
      projects: team.projects.filter(project => typeof project?.project_id === 'string' && typeof project.company_id === 'string')
        .map(project => ({ company_id: project.company_id, project_id: project.project_id, name: String(project.name || project.project_id) })),
      agents: team.agents.filter(agent => typeof agent?.agent_id === 'string')
        .map(agent => ({ agent_id: agent.agent_id, name: String(agent.name || agent.agent_id), description: String(agent.description || '') })),
      tasks: team.tasks.filter(task => typeof task?.task_id === 'string')
        .map(task => ({ task_id: task.task_id, title: String(task.title || task.task_id), status: String(task.status || '') })),
    }));
}

function validateSelection(catalog, selection) {
  const team = catalog.find(item => item.team_id === selection.team_id);
  const project = team?.projects.find(item => item.project_id === selection.project_id && item.company_id === selection.company_id);
  const agent = team?.agents.find(item => item.agent_id === selection.agent_id);
  const taskId = selection.task_id || '';
  const task = taskId ? team?.tasks.find(item => item.task_id === taskId) : null;
  if (!team || !project || !agent || (taskId && !task)) throw new MemoryAccessError('请选择同一团队中有效的项目和 Agent；Task 可留空。', 400);
  return { team_id: team.team_id, company_id: project.company_id, project_id: project.project_id, agent_id: agent.agent_id, task_id: taskId, upload_enabled: selection.upload_enabled === true };
}

function renderPage(catalog, token, uploadDisabled = false) {
  const serialized = safeJsonForHtml(catalog);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"><title>Memory 接入</title><style>body{font:16px system-ui,sans-serif;max-width:680px;margin:4rem auto;padding:0 1rem;color:#202124}label{display:block;margin:1rem 0}select,button{font:inherit;padding:.5rem;max-width:100%}select{display:block;width:100%;margin-top:.3rem}button{margin:.5rem .5rem .5rem 0}#error{color:#9b1c1c}#status{color:#555}.choice{display:flex;gap:.5rem;align-items:center}.choice input{width:1rem;height:1rem}</style><h1>选择本次对话使用的 Memory 资产</h1><p>模型 API Key 不会发送给 Memory 服务。</p><form id="choose"><label>团队<select id="team" required></select></label><label>项目<select id="project" required></select></label><label>Agent<select id="agent" required></select></label><label>Task（可选）<select id="task"></select></label><label class="choice"><input id="upload" type="checkbox"${uploadDisabled ? ' disabled' : ''}>上传本会话的用户文本和最终助手回复到项目 L0</label>${uploadDisabled ? '<p>上传已全局关闭；需运行 upload.cjs --enable 后才能为新会话开启。</p>' : ''}<button>确认选择并加载上下文</button><button type="button" data-action="skip">本次不使用 Memory</button></form><section id="failure" hidden><p id="error"></p><button data-action="retry">重试</button><button data-action="continue">仅本次无 Memory 上下文继续</button><button data-action="skip">本次不使用 Memory</button><button data-action="cancel">取消本次请求</button></section><p id="status" aria-live="polite"></p><script>
let catalog=${serialized};const token=${JSON.stringify(token)};const root='/'+token;const team=document.querySelector('#team'),project=document.querySelector('#project'),agent=document.querySelector('#agent'),task=document.querySelector('#task'),choose=document.querySelector('#choose'),failure=document.querySelector('#failure'),error=document.querySelector('#error'),status=document.querySelector('#status');
function options(el,items,id,label,placeholder,optional=false){const selected=el.value;const first=document.createElement('option');first.value='';first.textContent=placeholder;first.disabled=!optional;el.replaceChildren(first,...items.map(x=>{const o=document.createElement('option');o.value=x[id];o.textContent=x[label];return o}));if([...el.options].some(o=>o.value===selected))el.value=selected;else el.value=''}function selectedTeam(){return catalog.find(x=>x.team_id===team.value)}function refresh(){const t=selectedTeam();options(project,t?.projects||[],'project_id','name','请选择项目');options(agent,t?.agents||[],'agent_id','name','请选择 Agent');options(task,t?.tasks||[],'task_id','title','不关联 Task',true)}function setCatalog(value){catalog=value;options(team,catalog,'team_id','name','请选择团队');refresh()}setCatalog(catalog);team.addEventListener('change',refresh);
choose.addEventListener('submit',async e=>{e.preventDefault();status.textContent='正在读取授权上下文…';const t=selectedTeam(),p=t?.projects.find(x=>x.project_id===project.value);const r=await fetch(root+'/selection',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({team_id:team.value,company_id:p?.company_id,project_id:project.value,agent_id:agent.value,task_id:task.value,upload_enabled:document.querySelector('#upload').checked})});if(r.ok){choose.hidden=true;status.textContent='已提交选择，正在加载上下文…'}else status.textContent=(await r.text()).slice(0,240)});
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async()=>{const r=await fetch(root+'/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.action})});if(r.ok){failure.hidden=true;choose.hidden=true;status.textContent=b.dataset.action==='retry'?'正在重试…':b.dataset.action==='continue'?'正在继续本次请求…':b.dataset.action==='skip'?'本次会话已关闭 Memory':'请求已取消'}else status.textContent=(await r.text()).slice(0,240)}));
async function poll(){try{const s=await (await fetch(root+'/status',{cache:'no-store'})).json();if(s.mode==='error'){failure.hidden=false;choose.hidden=true;error.textContent=s.error;document.querySelector('[data-action="continue"]').hidden=s.allow_continue===false;status.textContent='请明确选择下一步'}else if(s.mode==='select'){if(Array.isArray(s.catalog))setCatalog(s.catalog);failure.hidden=true;choose.hidden=false}else if(s.mode==='loading'){failure.hidden=true;choose.hidden=true;status.textContent='正在加载…'}else if(s.mode==='done'){failure.hidden=true;choose.hidden=true;status.textContent=s.message||'处理完成，可以返回 AI 客户端'}else if(s.mode==='cancelled'){failure.hidden=true;choose.hidden=true;status.textContent='已取消，可以关闭此页面'}}catch{}}setInterval(poll,500);poll();</script></html>`;
}

function createGate({ catalog = [], initialError = null, allowContinue = true, uploadDisabled = false, timeoutMs = GATE_TIMEOUT_MS } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  let pageCatalog = catalog;
  let state = { mode: initialError ? 'error' : 'select', error: initialError || '', allowContinue };
  let resolveSelection;
  let resolveAction;
  let selectionSettled = false;
  let actionPending = null;
  let earlyAction = null;
  let expired = false;
  let server;
  let timer;
  const selection = new Promise(resolve => { resolveSelection = resolve; });
  const action = () => new Promise(resolve => { actionPending = resolve; });
  const setState = next => { state = { ...next }; };
  function json(res, code, body) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_GATE_BODY) { reject(new Error('request too large')); req.destroy(); }
      });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid JSON')); } });
      req.on('error', reject);
    });
  }
  server = http.createServer(async (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return json(res, 403, { error: 'loopback only' });
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = `/${token}`;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'GET' && url.pathname === base) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" });
      return res.end(renderPage(pageCatalog, token, uploadDisabled));
    }
    if (req.method === 'GET' && url.pathname === `${base}/status`) return json(res, 200, {
      mode: state.mode, error: state.error, message: state.message, allow_continue: state.allowContinue !== false,
      ...(state.mode === 'select' ? { catalog: pageCatalog } : {}),
    });
    if (req.method !== 'POST' || ![`${base}/selection`, `${base}/action`].includes(url.pathname)) return json(res, 404, { error: 'not found' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'invalid request' }); }
    if (url.pathname === `${base}/selection`) {
      if (state.mode !== 'select' || selectionSettled) return json(res, 409, { error: 'selection is not available' });
      if (uploadDisabled && body?.upload_enabled === true) return json(res, 400, { error: 'upload is globally disabled' });
      try {
        const selected = validateSelection(catalog, body);
        selectionSettled = true;
        setState({ mode: 'loading' });
        resolveSelection(selected);
        return json(res, 202, { accepted: true });
      } catch (error) { return json(res, 400, { error: publicError(error) }); }
    }
    const actions = { retry: 'retry', continue: 'continue', cancel: 'cancel', skip: 'skip' };
    const selectedAction = actions[body?.action];
    if (!['error', 'select'].includes(state.mode) || !selectedAction || (state.mode === 'select' && selectedAction !== 'skip') || (selectedAction === 'continue' && state.allowContinue === false)) return json(res, 409, { error: 'action is not available' });
    if (selectedAction === 'skip' && !selectionSettled) { selectionSettled = true; resolveSelection({ mode: 'off' }); }
    if (selectedAction === 'retry') setState({ mode: 'loading' });
    else setState({ mode: selectedAction === 'cancel' ? 'cancelled' : 'done', message: selectedAction === 'cancel' ? '' : selectedAction === 'skip' ? '本次会话已关闭 Memory' : '已选择仅本次无 Memory 上下文继续' });
    if (actionPending) {
      const resolve = actionPending;
      actionPending = null;
      resolve(selectedAction);
    } else earlyAction = selectedAction;
    return json(res, 202, { accepted: true });
  });
  return {
    get url() { const address = server.address(); return address ? `http://127.0.0.1:${address.port}/${token}` : ''; },
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      timer = setTimeout(() => {
        expired = true;
        if (actionPending) { const resolve = actionPending; actionPending = null; resolve('cancel'); }
        if (!selectionSettled) { selectionSettled = true; resolveSelection(null); }
        setState({ mode: 'cancelled', message: '等待选择超时，本次请求已取消。' });
        this.close();
      }, timeoutMs);
      timer.unref?.();
      return this;
    },
    waitForSelection: () => selection,
    showSelection(nextCatalog) { pageCatalog = nextCatalog; setState({ mode: 'select' }); },
    showError(message, options = {}) { setState({ mode: 'error', error: String(message).slice(0, MAX_DISPLAY), allowContinue: options.allowContinue ?? allowContinue }); },
    setDone(message = '上下文已加载，可以返回 AI 客户端') { setState({ mode: 'done', message }); },
    async waitForAction() {
      if (expired) return 'cancel';
      if (earlyAction) { const value = earlyAction; earlyAction = null; return value; }
      return action();
    },
    close() {
      clearTimeout(timer);
      if (!server.listening) return;
      server.close();
      // A stalled browser request must not keep the hook process alive.
      const drain = setTimeout(() => server.closeAllConnections(), 100);
      drain.unref?.();
    },
  };
}

function openGate(url, stderr = process.stderr) {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => stderr.write(`请在浏览器打开本机选择页面：${url}\n`));
    child.unref();
  } catch { stderr.write(`请在浏览器打开本机选择页面：${url}\n`); }
}

function formatContext(context) {
  const lines = ['<memory-context>', `Team: ${context.team?.name || context.team?.team_id || ''}`, `Project: ${context.project?.name || context.project?.project_id || ''}`];
  if (context.agent?.prompt) lines.push(`\nAgent instructions:\n${context.agent.prompt}`);
  if (context.task?.title || context.task?.description) lines.push(`\nTask:\n${[context.task.title, context.task.description].filter(Boolean).join('\n')}`);
  lines.push('\nProject and team knowledge:');
  if (Array.isArray(context.knowledge) && context.knowledge.length) {
    for (const item of context.knowledge) lines.push(`- [${item.type || 'knowledge'}] ${item.name || ''}: ${item.summary || ''}`);
  } else lines.push('- No authorized knowledge items are available.');
  lines.push('\nRelevant authorized memories:');
  if (Array.isArray(context.memories) && context.memories.length) {
    for (const item of context.memories) lines.push(`- ${item.content || ''}`);
  } else lines.push('- No relevant authorized memories were found.');
  lines.push('</memory-context>');
  return lines.join('\n');
}

function hookResult(client, context, blockedMessage = '') {
  if (blockedMessage) return client === 'claude'
    ? { decision: 'block', reason: blockedMessage }
    : { continue: false, stopReason: blockedMessage };
  if (!context) return {};
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatContext(context) } };
}

async function runHook({ client, event, env = process.env, fetcher = fetch, gateFactory = createGate, browser = openGate, stderr = process.stderr }) {
  if (!['codex', 'claude'].includes(client)) throw new MemoryAccessError('不支持的客户端。');
  if (!event || event.hook_event_name !== 'UserPromptSubmit') return {};
  const sessionId = event.session_id;
  const cwd = typeof event.cwd === 'string' && event.cwd ? path.resolve(event.cwd) : '';
  const prompt = typeof event.prompt === 'string' ? event.prompt : '';
  if (!sessionId || !cwd || !prompt.trim()) throw new MemoryAccessError('客户端未提供稳定会话、工作目录或提示信息。为避免错绑项目，本次请求已阻止。', 400);

  let saved = readSession(client, sessionId, cwd, env);
  if (saved?.mode === 'off') return {};
  const config = readConfig(configPath(env));
  let selection = saved && { team_id: saved.team_id, company_id: saved.company_id, project_id: saved.project_id, agent_id: saved.agent_id, task_id: saved.task_id, upload_enabled: saved.upload_enabled === true };
  let catalog = [];
  let gate = null;
  async function startGate(options) {
    const uploadDisabled = require('./upload.cjs').readState(env).manually_disabled === true;
    gate = await gateFactory({ ...options, uploadDisabled }).start();
    browser(gate.url, stderr);
    return gate;
  }
  async function readCatalog() {
    return normalizeCatalog(await requestMemory(config, 'catalog', {}, fetcher));
  }
  try {
    if (!selection) {
      let catalogError = null;
      for (;;) {
        try { catalog = await readCatalog(); catalogError = catalog.some(team => team.projects.length && team.agents.length) ? null : '当前账号没有可选择的团队、项目或 Agent。请更新授权资产后重试。'; }
        catch (error) { catalogError = publicError(error); }
        if (!catalogError) break;
        if (!gate) await startGate({ catalog: [], initialError: catalogError, allowContinue: false });
        else gate.showError(catalogError, { allowContinue: false });
        const decision = await gate.waitForAction();
        if (decision === 'cancel' || !decision) return hookResult(client, null, 'Memory 资产选择未完成，本次请求已取消。');
        if (decision === 'skip') { writeSession(client, sessionId, cwd, { mode: 'off' }, env); return {}; }
        if (decision === 'continue') return hookResult(client, null);
      }
      if (!gate) await startGate({ catalog });
      else gate.showSelection(catalog);
      selection = await gate.waitForSelection();
      if (!selection) return hookResult(client, null, 'Memory 资产选择等待超时，本次请求已取消。');
      if (selection.mode === 'off') { writeSession(client, sessionId, cwd, { mode: 'off' }, env); return {}; }
      writeSession(client, sessionId, cwd, selection, env);
    }

    for (;;) {
      try {
        const context = await requestMemory(config, 'context', { ...selection, session_id: sessionId, query: prompt }, fetcher);
        if (!Array.isArray(context.knowledge) || !Array.isArray(context.memories)
          || !context.agent || typeof context.agent.prompt !== 'string'
          || (context.task !== null && (!context.task || typeof context.task.title !== 'string'))) throw new MemoryAccessError('Memory 服务未返回完整上下文。请重试或取消。');
        if (typeof context.session_binding === 'string' && /^[a-f0-9]{64}$/.test(context.session_binding)) {
          let uploadEnabledAt = saved?.upload_enabled_at || 0;
          if (selection.upload_enabled && !uploadEnabledAt) {
            uploadEnabledAt = await require('./upload.cjs').enableForSession(env);
          }
          writeSession(client, sessionId, cwd, { ...selection, session_binding: context.session_binding, upload_enabled_at: uploadEnabledAt }, env);
        }
        gate?.setDone();
        return hookResult(client, context);
      } catch (error) {
        if (!gate) await startGate({ catalog: [], initialError: publicError(error) });
        else gate.showError(publicError(error));
        const decision = await gate.waitForAction();
        if (decision === 'retry') continue;
        if (decision === 'skip') { writeSession(client, sessionId, cwd, { mode: 'off' }, env); return {}; }
        if (decision === 'continue') return hookResult(client, null);
        return hookResult(client, null, 'Memory 上下文未加载，本次请求已取消。');
      }
    }
  } finally { gate?.close(); }
}

function parseClient(args) {
  const index = args.indexOf('--client');
  if (index >= 0) return args[index + 1];
  const value = args.find(item => item.startsWith('--client='));
  return value?.slice('--client='.length);
}

async function main() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_HOOK_INPUT) throw new MemoryAccessError('Hook 输入过大，本次请求已阻止。', 400);
    chunks.push(chunk);
  }
  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const client = parseClient(process.argv.slice(2));
  if (event.hook_event_name === 'Stop') {
    try {
      const warning = await require('./upload.cjs').capture({ client, event });
      if (warning) process.stderr.write(`${warning}\n`);
    } catch { process.stderr.write('Memory 对话上传未完成，请检查本地上传状态。\n'); }
    process.stdout.write('{}\n');
    return;
  }
  const result = await runHook({ client, event });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    const client = parseClient(process.argv.slice(2));
    process.stderr.write(`${publicError(error)}\n`);
    process.stdout.write(`${JSON.stringify(hookResult(client, null, publicError(error)))}\n`);
    process.exitCode = 0;
  });
}

module.exports = { MemoryAccessError, configPath, stateDirectory, readConfig, sessionFile, readSession, writeSession,
  requestMemory, normalizeCatalog, validateSelection, formatContext, hookResult, createGate, runHook, publicError };
