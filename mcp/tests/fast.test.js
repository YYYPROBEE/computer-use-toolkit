'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startServer } = require('./support/client');
const { loadEnvFile } = require('../tools/fast/env');
const { parseAction } = require('../tools/fast/prompt');

const FIX = path.resolve(__dirname, 'fixtures');
const TINY = path.join(FIX, 'tiny.png');
const KEY = 'test-key-for-fast-model';

function fakeApi(responder) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch {}
      requests.push({ headers: req.headers, body, raw });
      let response;
      try {
        response = responder(body, req) || {};
      } catch (err) {
        response = { status: 500, body: { error: { message: err.message } } };
      }
      res.writeHead(response.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body || {}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

function closeFake(api) {
  return new Promise((resolve) => api.server.close(resolve));
}

function baseEnv(port, extra = {}) {
  return {
    BIOCUA_FAST_BACKEND: 'api',
    BIOCUA_FAST_BASE_URL: `http://127.0.0.1:${port}/v1/chat/completions`,
    BIOCUA_FAST_API_KEY: KEY,
    BIOCUA_FAST_MODEL: 'deepseek-v4.1-flash',
    BIOCUA_FAST_IMAGE_ROOTS: FIX,
    BIOCUA_FAST_ENV_FILE: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
    BIOCUA_FAST_IN_PRICE: '',
    BIOCUA_FAST_OUT_PRICE: '',
    ...extra,
  };
}

function actionResponse(action, options = {}) {
  const { reasoning, usage } = options;
  return () => ({
    status: 200,
    body: {
      id: 'req_test',
      model: 'deepseek-v4.1-flash',
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify(action),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        },
        finish_reason: 'stop',
      }],
      usage: usage || { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
  });
}

async function call(client, name, args) {
  const result = await client.request('tools/call', { name, arguments: args });
  return {
    result,
    data: result.isError ? null : JSON.parse(result.content[0].text),
  };
}

test('parseAction 取第一个完整 JSON，容忍模型重复输出', () => {
  const parsed = parseAction(
    '{"type":"click","x":10,"y":20,"reason":"a { b }"}{"type":"click","x":30,"y":40}',
    ['click'],
  );
  assert.equal(parsed.action.type, 'click');
  assert.equal(parsed.action.x, 10);
  assert.equal(parsed.action.y, 20);
  assert.equal(parsed.reason, 'a { b }');
});

test('fast_status 与 fast_propose_action：请求体关闭思考并发送图片', async (t) => {
  const api = await fakeApi(actionResponse({
    type: 'click', x: 500, y: 300, button: 'left', confidence: 0.8, reason: '按钮在中央',
  }));
  t.after(() => closeFake(api));
  const client = startServer(baseEnv(api.port));
  t.after(() => client.stop());
  await client.initialize();

  const status = await call(client, 'fast_status', {});
  assert.equal(status.data.backend, 'api');
  assert.equal(status.data.model, 'deepseek-v4.1-flash');
  assert.equal(status.data.keyConfigured, true);
  assert.equal(status.data.keySource, 'BIOCUA_FAST_API_KEY');
  assert.equal(status.data.envFile, null);
  assert.equal(status.data.thinkingRequested, false);

  const { result, data } = await call(client, 'fast_propose_action', {
    instruction: '点击确定',
    screenshot_path: 'tiny.png',
    base_dir: FIX,
    max_tokens: 128,
    temperature: 0,
  });
  assert.equal(result.isError, undefined);
  assert.equal(data.action.type, 'click');
  assert.equal(data.action.x, 500);
  assert.equal(data.action.y, 300);
  assert.equal(data.thinkingDetected, false);
  assert.equal(data.usage.inputTokens, 100);
  assert.equal(data.usage.outputTokens, 20);
  assert.equal(data.estimatedCostUsd, null);

  assert.equal(api.requests.length, 1);
  const request = api.requests[0];
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.equal(request.body.model, 'deepseek-v4.1-flash');
  assert.equal(request.body.enable_thinking, false);
  assert.equal(request.body.stream, false);
  assert.equal(request.body.thinking, undefined);
  assert.equal(request.body.max_tokens, 128);
  const imagePart = request.body.messages[1].content.find((part) => part.type === 'image_url');
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);
  assert.ok(!request.raw.includes(KEY));
});

test('screenshot_base64 与 MIME 一致性校验', async (t) => {
  const api = await fakeApi(actionResponse({ type: 'wait', ms: 100 }));
  t.after(() => closeFake(api));
  const client = startServer(baseEnv(api.port));
  t.after(() => client.stop());
  await client.initialize();

  const base64 = fs.readFileSync(TINY).toString('base64');
  const ok = await call(client, 'fast_propose_action', {
    instruction: '等待',
    screenshot_base64: base64,
    screenshot_mime: 'image/png',
  });
  assert.equal(ok.data.action.type, 'wait');
  const imagePart = api.requests[0].body.messages[1].content.find((part) => part.type === 'image_url');
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);

  const bad = await call(client, 'fast_propose_action', {
    instruction: '等待',
    screenshot_base64: base64,
    screenshot_mime: 'image/jpeg',
  });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /不一致/);
  assert.equal(api.requests.length, 1);
});

test('思考泄漏会被检测且不回显 reasoning', async (t) => {
  const api = await fakeApi(actionResponse(
    { type: 'click', x: 10, y: 20 },
    {
      reasoning: 'THINKING_SECRET_TEXT',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
        completion_tokens_details: { reasoning_tokens: 10 },
      },
    },
  ));
  t.after(() => closeFake(api));
  const client = startServer(baseEnv(api.port));
  t.after(() => client.stop());
  await client.initialize();

  const { data } = await call(client, 'fast_propose_action', {
    instruction: '点击按钮',
    ui_state: '按钮：确定',
  });
  assert.equal(data.thinkingDetected, true);
  assert.equal(data.usage.reasoningTokens, 10);
  assert.ok(data.warnings.some((warning) => warning.includes('reasoning_content')));
  assert.ok(!JSON.stringify(data).includes('THINKING_SECRET_TEXT'));
});

test('未允许动作与非法 JSON 均被拒绝', async (t) => {
  let mode = 'shell';
  const api = await fakeApi(() => {
    if (mode === 'shell') {
      return actionResponse({ type: 'shell', cmd: 'whoami' })();
    }
    return {
      status: 200,
      body: {
        choices: [{ message: { role: 'assistant', content: 'not json' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
    };
  });
  t.after(() => closeFake(api));
  const client = startServer(baseEnv(api.port));
  t.after(() => client.stop());
  await client.initialize();

  const shell = await call(client, 'fast_propose_action', { instruction: '执行命令', ui_state: '桌面' });
  assert.equal(shell.result.isError, true);
  assert.match(shell.result.content[0].text, /未允许的动作/);

  mode = 'bad';
  const bad = await call(client, 'fast_propose_action', { instruction: '点击', ui_state: '桌面' });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /不是合法 JSON/);
});

test('截图输入缺失、冲突与缺 MIME 的边界', async (t) => {
  const client = startServer({
    BIOCUA_FAST_BACKEND: 'mock',
    BIOCUA_FAST_ENV_FILE: '',
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
  });
  t.after(() => client.stop());
  await client.initialize();

  const missing = await call(client, 'fast_propose_action', { instruction: '点击' });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /至少提供/);

  const both = await call(client, 'fast_propose_action', {
    instruction: '点击',
    screenshot_path: 'tiny.png',
    screenshot_base64: 'AAAA',
    base_dir: FIX,
  });
  assert.equal(both.result.isError, true);
  assert.match(both.result.content[0].text, /二选一/);

  const noMime = await call(client, 'fast_propose_action', {
    instruction: '点击',
    screenshot_base64: 'AAAA',
  });
  assert.equal(noMime.result.isError, true);
  assert.match(noMime.result.content[0].text, /screenshot_mime/);
});

test('截图目录约束与未设置根目录时的警告', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biocua-mcp-img-'));
  const outside = path.join(dir, 'tiny.png');
  fs.copyFileSync(TINY, outside);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const strict = startServer({
    BIOCUA_FAST_BACKEND: 'mock',
    BIOCUA_FAST_IMAGE_ROOTS: FIX,
    BIOCUA_FAST_ENV_FILE: '',
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
  });
  t.after(() => strict.stop());
  await strict.initialize();
  const blocked = await call(strict, 'fast_propose_action', {
    instruction: '点击',
    screenshot_path: outside,
  });
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /BIOCUA_FAST_IMAGE_ROOTS/);

  const loose = startServer({
    BIOCUA_FAST_BACKEND: 'mock',
    BIOCUA_FAST_IMAGE_ROOTS: '',
    BIOCUA_FAST_ENV_FILE: '',
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
  });
  t.after(() => loose.stop());
  await loose.initialize();
  const allowed = await call(loose, 'fast_propose_action', {
    instruction: '点击',
    screenshot_path: outside,
  });
  assert.equal(allowed.data.backend, 'mock');
  assert.ok(allowed.data.warnings.some((warning) => warning.includes('未设置 CUA_FAST_IMAGE_ROOTS')));
});

test('env 文件只加载白名单键', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biocua-mcp-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, [
    'QWEN_API_KEY=from-file',
    'GITHUB_TOKEN=should-not-load',
    'SSH_HOST=should-not-load',
    'BIOCUA_FAST_MODEL=qwen3.8-flash',
  ].join('\n'));
  try {
    const target = {};
    const keys = loadEnvFile(file, target);
    assert.deepEqual(keys.sort(), ['BIOCUA_FAST_MODEL', 'QWEN_API_KEY']);
    assert.equal(target.QWEN_API_KEY, 'from-file');
    assert.equal(target.BIOCUA_FAST_MODEL, 'qwen3.8-flash');
    assert.equal(target.GITHUB_TOKEN, undefined);
    assert.equal(target.SSH_HOST, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('通过 BIOCUA_FAST_ENV_FILE 加载 QWEN_API_KEY', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biocua-mcp-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, [
    'QWEN_API_KEY=from-file',
    'BIOCUA_FAST_BACKEND=mock',
    'BIOCUA_FAST_MODEL=qwen3.8-flash',
  ].join('\n'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const client = startServer({
    BIOCUA_FAST_ENV_FILE: file,
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
    BIOCUA_FAST_BACKEND: '',
    BIOCUA_FAST_MODEL: '',
  });
  t.after(() => client.stop());
  await client.initialize();

  const status = await call(client, 'fast_status', {});
  assert.equal(status.data.backend, 'mock');
  assert.equal(status.data.model, 'qwen3.8-flash');
  assert.equal(status.data.keyConfigured, true);
  assert.equal(status.data.keySource, 'QWEN_API_KEY');
  assert.equal(status.data.envFileLoaded, true);
  assert.ok(status.data.loadedEnvKeys.includes('QWEN_API_KEY'));
  assert.ok(status.data.loadedEnvKeys.includes('BIOCUA_FAST_BACKEND'));
});

test('缺少密钥时状态与调用都给出明确错误', async (t) => {
  const client = startServer({
    BIOCUA_FAST_BACKEND: 'api',
    BIOCUA_FAST_ENV_FILE: '',
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
  });
  t.after(() => client.stop());
  await client.initialize();

  const status = await call(client, 'fast_status', {});
  assert.equal(status.data.keyConfigured, false);
  assert.equal(status.data.keySource, null);

  const result = await call(client, 'fast_propose_action', {
    instruction: '点击',
    ui_state: '桌面',
  });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /未配置 API key/);
});

test('mock 后端不联网并明确标注', async (t) => {
  const client = startServer({
    BIOCUA_FAST_BACKEND: 'mock',
    BIOCUA_FAST_ENV_FILE: '',
    BIOCUA_FAST_API_KEY: '',
    QWEN_API_KEY: '',
    DASHSCOPE_API_KEY: '',
  });
  t.after(() => client.stop());
  await client.initialize();

  const { data } = await call(client, 'fast_propose_action', {
    instruction: '点击',
    ui_state: '桌面',
  });
  assert.equal(data.backend, 'mock');
  assert.equal(data.action.type, 'click');
  assert.ok(data.warnings.some((warning) => warning.includes('mock 后端')));
});

test('API 错误文本中的密钥会被脱敏', async (t) => {
  const api = await fakeApi(() => ({
    status: 401,
    body: { error: { message: `invalid key ${KEY}` } },
  }));
  t.after(() => closeFake(api));
  const client = startServer(baseEnv(api.port));
  t.after(() => client.stop());
  await client.initialize();

  const { result } = await call(client, 'fast_propose_action', {
    instruction: '点击',
    ui_state: '桌面',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /API 401/);
  assert.ok(!result.content[0].text.includes(KEY));
  assert.match(result.content[0].text, /<redacted>/);
});

test('CUA_FAST_ 前缀优先于旧 BIOCUA_FAST_ 前缀', async (t) => {
  const overrideRoot = path.join(FIX, 'screens');
  const client = startServer(baseEnv(1, {
    CUA_FAST_BACKEND: 'mock',
    CUA_FAST_MODEL: 'preferred-model',
    CUA_FAST_IMAGE_ROOTS: overrideRoot,
  }));
  t.after(() => client.stop());
  await client.initialize();

  const status = await call(client, 'fast_status', {});
  assert.equal(status.data.backend, 'mock');
  assert.equal(status.data.model, 'preferred-model');
  assert.deepEqual(status.data.imageRoots, [overrideRoot]);
  // 密钥只由旧前缀提供时，仍按实际变量名回报，避免误导
  assert.equal(status.data.keySource, 'BIOCUA_FAST_API_KEY');
});