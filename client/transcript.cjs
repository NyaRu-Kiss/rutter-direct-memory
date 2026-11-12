'use strict';

const crypto = require('node:crypto');

function digest(client, sessionId, sourceId, role) {
  return crypto.createHash('sha256').update(JSON.stringify([client, sessionId, sourceId, role])).digest('hex');
}

function textBlocks(content, allowedType) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block && block.type === allowedType && typeof block.text === 'string').map(block => block.text).join('\n');
}

function parseTranscript(client, sessionId, input, consentAt) {
  const records = [];
  let incomplete = false;
  let codexSessionMatches = false;
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { incomplete = true; continue; }
    if (client === 'codex' && row.type === 'session_meta') {
      if (row.payload?.id !== sessionId) return { messages: [], incomplete: true };
      codexSessionMatches = true;
    }
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < consentAt) continue;
    let role, content, source, turn;
    if (client === 'codex') {
      const retained = row.metadata?.retained_source;
      if (row.type !== 'response_item' || row.payload?.type !== 'message' || retained?.complete !== true) continue;
      role = row.payload.role;
      if (!['user', 'assistant'].includes(role) || retained.id?.role !== role) continue;
      source = retained.id?.message_id;
      turn = retained.id?.turn_id;
      if (typeof source !== 'string' || !source || typeof turn !== 'string' || !turn) continue;
      content = textBlocks(row.payload.content, role === 'user' ? 'input_text' : 'output_text');
    } else if (client === 'claude') {
      if (row.isSidechain !== false || row.isMeta === true || row.sessionId !== sessionId || !['user', 'assistant'].includes(row.type)) continue;
      role = row.type;
      if (row.message?.role !== role || typeof row.uuid !== 'string' || !row.uuid) continue;
      source = row.uuid;
      content = textBlocks(row.message.content, 'text');
    } else throw new Error('Unsupported client');
    if (!content.trim()) continue;
    records.push({ role, content, direct_event_id: digest(client, sessionId, source, role), timestamp: new Date(timestamp).toISOString(), turn });
  }
  // Stop fires after a turn; only the last assistant text for a turn is the final reply.
  const output = [];
  let pending = null;
  for (const record of records) {
    if (record.role === 'user') {
      if (pending) output.push(pending);
      pending = null;
      output.push(record);
    } else {
      if (pending && client === 'codex' && pending.turn !== record.turn) output.push(pending);
      pending = record;
    }
  }
  if (pending) output.push(pending);
  return { messages: codexSessionMatches || client !== 'codex' ? output.map(({ turn, ...message }) => message) : [], incomplete: incomplete || (client === 'codex' && !codexSessionMatches) };
}

module.exports = { parseTranscript };
