'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER = path.resolve(__dirname, '..', '..', 'server.js');
const CWD = path.resolve(__dirname, '..', '..');

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: CWD,
    env: { ...process.env, ...extraEnv },
  });
  const pending = new Map();
  const messages = [];
  const rawLines = [];
  const stderr = [];
  let nextId = 1;
  let closed = false;

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    rawLines.push(line);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    messages.push(message);
    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message);
        error.rpc = message.error;
        entry.reject(error);
      } else {
        entry.resolve(message.result);
      }
    }
  });
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`请求超时：${method}`));
        }
      }, 5000);
      timer.unref();
    });
  }

  function notify(method, params) {
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  function sendRaw(text) {
    child.stdin.write(`${text}\n`);
  }

  async function initialize() {
    const result = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'computer-use-mcp-test', version: '0.0.1' },
    });
    notify('notifications/initialized');
    return result;
  }

  function stop() {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.stdin.end();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      timer.unref();
    });
  }

  return {
    child,
    request,
    notify,
    sendRaw,
    initialize,
    stop,
    messages,
    rawLines,
    stderr,
  };
}

module.exports = { startServer };
