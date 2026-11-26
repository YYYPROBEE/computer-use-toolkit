'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./support/client');

test('握手、能力与工具列表', async (t) => {
  const client = startServer();
  t.after(() => client.stop());

  const init = await client.initialize();
  assert.equal(init.serverInfo.name, 'computer-use-mcp');
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.ok(init.capabilities.tools);
  assert.equal(init.capabilities.tools.listChanged, false);
  assert.ok(typeof init.instructions === 'string' && init.instructions.length > 20);

  const { tools } = await client.request('tools/list', {});
  assert.equal(tools.length, 8);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      'attention_savings',
      'cost_estimate',
      'fast_propose_action',
      'fast_status',
      'power_analysis',
      'validate_run',
      'verdict_compare',
      'verdict_grid',
    ],
  );
  for (const tool of tools) {
    assert.ok(tool.description.length > 10, `${tool.name} 描述过短`);
    assert.equal(tool.inputSchema.type, 'object');
    if (tool.name === 'fast_propose_action') {
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.equal(tool.annotations.openWorldHint, true);
    } else {
      assert.equal(tool.annotations.readOnlyHint, true);
    }
  }

  const ping = await client.request('ping');
  assert.deepEqual(ping, {});
});

test('unsupported protocolVersion 回落到最新支持版本', async (t) => {
  const client = startServer();
  t.after(() => client.stop());
  const result = await client.request('initialize', {
    protocolVersion: '2030-01-01',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  assert.equal(result.protocolVersion, '2025-06-18');
});

test('未知工具是协议错误，工具执行错误是 isError 结果', async (t) => {
  const client = startServer();
  t.after(() => client.stop());
  await client.initialize();

  await assert.rejects(
    client.request('tools/call', { name: 'nope', arguments: {} }),
    (err) => err.rpc && err.rpc.code === -32602,
  );

  const missing = await client.request('tools/call', {
    name: 'verdict_compare',
    arguments: { a0: 'Z:/definitely/not/here.jsonl', x: [{ name: 'B', path: 'b.jsonl' }] },
  });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /文件不存在/);
});

test('未知方法与畸形 JSON 的错误码', async (t) => {
  const client = startServer();
  t.after(() => client.stop());
  await client.initialize();

  await assert.rejects(
    client.request('resources/list'),
    (err) => err.rpc && err.rpc.code === -32601,
  );

  client.sendRaw('{not json');
  await client.request('ping');
  const parseError = client.messages.find((message) => message.error && message.error.code === -32700);
  assert.ok(parseError, '应返回 -32700');
  assert.equal(parseError.id, null);
});

test('通知不产生响应，stdout 全部是合法 JSON-RPC', async (t) => {
  const client = startServer();
  t.after(() => client.stop());
  await client.initialize();

  client.notify('notifications/anything', { value: 1 });
  await client.request('ping');

  for (const line of client.rawLines) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    assert.ok(Object.prototype.hasOwnProperty.call(message, 'id'));
  }
});

test('tools/call 走完整链路返回可解析 JSON', async (t) => {
  const client = startServer();
  t.after(() => client.stop());
  await client.initialize();

  const result = await client.request('tools/call', {
    name: 'verdict_grid',
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  const data = JSON.parse(result.content[0].text);
  assert.ok(Math.abs(data.thresholds.b - (0.88 / (0.057 / 0.022))) < 1e-12);
  assert.equal(data.rows.length, 15);
});
