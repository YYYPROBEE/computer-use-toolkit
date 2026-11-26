'use strict';

function redact(text, apiKey) {
  if (!text) return '';
  let value = String(text);
  if (apiKey) {
    value = value.split(apiKey).join('<redacted>');
    value = value.split(`Bearer ${apiKey}`).join('Bearer <redacted>');
  }
  return value;
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

function normalizeUsage(usage) {
  if (!usage) {
    return { inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null };
  }
  const inputTokens = usage.prompt_tokens !== undefined
    ? usage.prompt_tokens
    : (usage.input_tokens !== undefined ? usage.input_tokens : null);
  const outputTokens = usage.completion_tokens !== undefined
    ? usage.completion_tokens
    : (usage.output_tokens !== undefined ? usage.output_tokens : null);
  const totalTokens = usage.total_tokens !== undefined ? usage.total_tokens : null;
  const reasoningTokens = usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens !== undefined
    ? usage.completion_tokens_details.reasoning_tokens
    : (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens !== undefined
      ? usage.output_tokens_details.reasoning_tokens
      : 0);
  return { inputTokens, outputTokens, totalTokens, reasoningTokens };
}

function mockResult(config) {
  return {
    content: JSON.stringify({
      type: 'click',
      x: 500,
      y: 500,
      button: 'left',
      confidence: 0.5,
      reason: 'mock 后端固定返回屏幕中心点击',
    }),
    reasoning: '',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 },
    requestId: 'mock',
    latencyMs: 0,
    model: config.model,
    mock: true,
    finishReason: 'stop',
  };
}

async function callFastModel({ config, messages, maxTokens, temperature, timeoutMs }) {
  if (config.backend === 'mock') return mockResult(config);
  if (!config.apiKey) {
    const envHint = config.envInfo && config.envInfo.file
      ? `（环境文件：${config.envInfo.file}）`
      : '';
    throw new Error(`未配置 API key：设置 CUA_FAST_API_KEY（兼容旧名 BIOCUA_FAST_API_KEY）、QWEN_API_KEY 或 DASHSCOPE_API_KEY${envHint}`);
  }

  const body = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    enable_thinking: false,
  };

  const started = Date.now();
  let response;
  try {
    response = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err && err.name ? err.name : 'Error';
    const message = err && err.message ? err.message : String(err);
    throw new Error(redact(`请求失败：${name}: ${message}`, config.apiKey));
  }

  const latencyMs = Date.now() - started;
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(redact(`API ${response.status}：${truncate(raw, 500)}`, config.apiKey));
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('API 返回的不是 JSON');
  }

  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice && choice.message ? choice.message : {};
  const content = contentToText(message.content);
  const reasoning = typeof message.reasoning_content === 'string'
    ? message.reasoning_content
    : (typeof message.reasoning === 'string' ? message.reasoning : '');

  return {
    content,
    reasoning,
    usage: normalizeUsage(json.usage),
    requestId: json.id || response.headers.get('x-request-id') || null,
    latencyMs,
    model: json.model || config.model,
    mock: false,
    finishReason: choice && choice.finish_reason ? choice.finish_reason : null,
  };
}

module.exports = {
  redact,
  contentToText,
  normalizeUsage,
  callFastModel,
};