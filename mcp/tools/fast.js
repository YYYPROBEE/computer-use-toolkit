'use strict';

const { getFastConfig } = require('./fast/env');
const { readImageFromFile, readImageFromBase64 } = require('./fast/image');
const { ALLOWED_ACTIONS, DEFAULT_ACTIONS, buildMessages, parseAction } = require('./fast/prompt');
const { callFastModel } = require('./fast/client');
const {
  expectObject,
  num,
  requireString,
  baseDirFrom,
} = require('./util');

function parseAllowedActions(raw) {
  if (raw === undefined || raw === null) return [...DEFAULT_ACTIONS];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('allowed_actions 必须是非空数组');
  }
  const actions = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !ALLOWED_ACTIONS.includes(item)) {
      throw new Error(`allowed_actions 含未知动作：${String(item)}（允许：${ALLOWED_ACTIONS.join(', ')}）`);
    }
    if (!actions.includes(item)) actions.push(item);
  }
  return actions;
}

async function propose(rawArgs) {
  const args = expectObject(rawArgs);
  const config = getFastConfig();

  const instruction = requireString(args, 'instruction');
  const uiState = args.ui_state === undefined || args.ui_state === null
    ? ''
    : requireString(args, 'ui_state');
  const hasPath = args.screenshot_path !== undefined && args.screenshot_path !== null;
  const hasBase64 = args.screenshot_base64 !== undefined && args.screenshot_base64 !== null;
  if (hasPath && hasBase64) {
    throw new Error('screenshot_path 与 screenshot_base64 只能二选一');
  }
  if (!hasPath && !hasBase64 && !uiState) {
    throw new Error('至少提供 screenshot_path、screenshot_base64 或 ui_state 之一');
  }
  if (hasBase64 && !args.screenshot_mime) {
    throw new Error('使用 screenshot_base64 时必须提供 screenshot_mime');
  }

  const baseDir = baseDirFrom(args);
  const allowedActions = parseAllowedActions(args.allowed_actions);
  const maxTokens = num(args, 'max_tokens', config.maxTokens, { integer: true, min: 16, max: 2048 });
  const temperature = num(args, 'temperature', 0, { min: 0, max: 1 });
  const timeoutMs = num(args, 'timeout_ms', config.timeoutMs, { integer: true, min: 1000, max: 120000 });

  let image = null;
  if (hasPath) {
    const pathValue = requireString(args, 'screenshot_path');
    image = readImageFromFile(config, baseDir, pathValue);
  } else if (hasBase64) {
    image = readImageFromBase64(
      config,
      requireString(args, 'screenshot_base64'),
      requireString(args, 'screenshot_mime'),
    );
  }
  let detailImage = null;
  if (args.screenshot_detail_path !== undefined && args.screenshot_detail_path !== null) {
    detailImage = readImageFromFile(
      config,
      baseDir,
      requireString(args, 'screenshot_detail_path'),
    );
  }

  const messages = buildMessages({
    instruction,
    uiState,
    history: args.history,
    allowedActions,
    image,
    detailImage,
  });

  const result = await callFastModel({
    config,
    messages,
    maxTokens,
    temperature,
    timeoutMs,
  });

  const thinkingDetected = Boolean(result.reasoning)
    || (result.usage.reasoningTokens !== null && result.usage.reasoningTokens > 0);
  if (!result.content.trim()) {
    throw new Error(thinkingDetected
      ? '模型只返回了 thinking 内容，没有返回动作；enable_thinking=false 可能未生效'
      : '模型返回了空内容');
  }

  const parsed = parseAction(result.content, allowedActions);
  const warnings = [];
  if (image && image.warning) warnings.push(image.warning);
  if (detailImage && detailImage.warning) warnings.push(detailImage.warning);
  if (thinkingDetected) {
    warnings.push('检测到 reasoning_content：enable_thinking=false 可能未被网关执行，思考 token 会按输出计费');
  }
  if (result.mock) warnings.push('mock 后端未调用模型；仅用于离线联调');
  if (result.finishReason === 'length') warnings.push('输出被 max_tokens 截断，动作 JSON 可能不完整');

  let estimatedCostUsd = null;
  if (config.inputPrice !== null && config.outputPrice !== null
    && result.usage.inputTokens !== null && result.usage.outputTokens !== null) {
    estimatedCostUsd = (
      result.usage.inputTokens * config.inputPrice
      + result.usage.outputTokens * config.outputPrice
    ) / 1e6;
  }

  return {
    model: result.model,
    backend: config.backend,
    thinkingRequested: false,
    thinkingDetected,
    action: parsed.action,
    confidence: parsed.confidence,
    reason: parsed.reason,
    memory: parsed.memory,
    latencyMs: result.latencyMs,
    requestId: result.requestId,
    finishReason: result.finishReason,
    usage: result.usage,
    estimatedCostUsd,
    warnings,
  };
}

function status() {
  try {
    const config = getFastConfig();
    return {
      backend: config.backend,
      model: config.model,
      baseUrl: config.baseUrl,
      keyConfigured: Boolean(config.apiKey),
      keySource: config.keySource,
      envFile: config.envInfo.file,
      envFileLoaded: Boolean(config.envInfo.file && !config.envInfo.error),
      envFileError: config.envInfo.error,
      loadedEnvKeys: config.envInfo.loadedKeys,
      imageRoots: config.imageRoots,
      thinkingRequested: false,
      timeoutMs: config.timeoutMs,
      maxTokens: config.maxTokens,
      priceConfigured: config.inputPrice !== null && config.outputPrice !== null,
      note: '只返回配置状态，不发请求、不返回密钥。',
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { propose, status };