#!/usr/bin/env node
'use strict';

const readline = require('readline');
const {
  SERVER_INFO,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  INSTRUCTIONS,
  listTools,
  getTool,
  callTool,
} = require('./tools/registry');

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message) {
  process.stderr.write(`[computer-use-mcp] ${message}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id: id === undefined ? null : id, error });
}

function pickProtocolVersion(params) {
  const requested = params && typeof params.protocolVersion === 'string'
    ? params.protocolVersion
    : null;
  return requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

async function handleMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    replyError(null, -32700, 'JSON 解析失败');
    return;
  }

  if (Array.isArray(message)) {
    replyError(null, -32600, '不支持批量请求');
    return;
  }
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0'
    || typeof message.method !== 'string') {
    replyError(message && message.id, -32600, '无效的 JSON-RPC 请求');
    return;
  }

  const { id, method, params } = message;
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id') && id !== null;

  if (method.startsWith('notifications/')) return;

  if (method === 'initialize') {
    if (!hasId) return;
    reply(id, {
      protocolVersion: pickProtocolVersion(params),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
    return;
  }

  if (method === 'ping') {
    if (hasId) reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    if (hasId) reply(id, { tools: listTools() });
    return;
  }

  if (method === 'tools/call') {
    if (!hasId) return;
    if (!params || typeof params.name !== 'string' || !params.name.trim()) {
      replyError(id, -32602, 'tools/call 需要 params.name');
      return;
    }
    const tool = getTool(params.name);
    if (!tool) {
      replyError(id, -32602, `未知工具：${params.name}`, {
        available: listTools().map((item) => item.name),
      });
      return;
    }
    try {
      const result = await callTool(tool, params.arguments);
      reply(id, result);
    } catch (err) {
      reply(id, {
        content: [{ type: 'text', text: `错误：${err && err.message ? err.message : String(err)}` }],
        isError: true,
      });
    }
    return;
  }

  if (hasId) replyError(id, -32601, `未实现的方法：${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  chain = chain
    .then(() => handleMessage(trimmed))
    .catch((err) => log(`处理消息失败：${err && err.stack ? err.stack : String(err)}`));
});

rl.on('close', () => {
  chain.finally(() => {
    process.exitCode = 0;
  });
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('uncaughtException', (err) => {
  log(`未捕获异常：${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  log(`未处理的 Promise 拒绝：${err && err.stack ? err.stack : String(err)}`);
  process.exit(1);
});
