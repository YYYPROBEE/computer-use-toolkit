'use strict';

const fs = require('fs');
const path = require('path');

// 通用前缀优先，旧品牌前缀继续兼容；两者同时存在时以 CUA_FAST_ 为准。
const SETTING_PREFIXES = Object.freeze(['CUA_FAST_', 'BIOCUA_FAST_']);
const ALLOWED_KEY = /^(QWEN_API_KEY|DASHSCOPE_API_KEY|(?:CUA|BIOCUA)_FAST_[A-Z0-9_]+)$/;
const API_KEY_NAMES = Object.freeze([
  'CUA_FAST_API_KEY',
  'BIOCUA_FAST_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
]);
// 默认值是占位示例；真实调用必须显式配置 CUA_FAST_BASE_URL 与 CUA_FAST_MODEL。
const DEFAULT_BASE_URL = 'https://your-gateway.example/v1/chat/completions';
const DEFAULT_MODEL = 'your-model';

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** 返回实际生效的变量名：CUA_FAST_<suffix> 优先，其次 BIOCUA_FAST_<suffix>。 */
function settingName(suffix) {
  for (const prefix of SETTING_PREFIXES) {
    const name = `${prefix}${suffix}`;
    const raw = process.env[name];
    if (raw !== undefined && raw !== null && raw !== '') return name;
  }
  return `${SETTING_PREFIXES[0]}${suffix}`;
}

/** 读取配置值；两个前缀都为空时返回 fallback。 */
function setting(suffix, fallback = '') {
  const raw = process.env[settingName(suffix)];
  return raw === undefined || raw === null || raw === '' ? fallback : raw;
}

function parsePrice(suffix) {
  const name = settingName(suffix);
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 必须是非负数字（USD / M tokens）`);
  }
  return value;
}

function parseRoots(raw) {
  if (!raw) return [];
  return raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseInteger(suffix, fallback, min, max) {
  const name = settingName(suffix);
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} 必须是数字`);
  return clamp(Math.round(value), min, max);
}

function loadEnvFile(file, target = process.env) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const loadedKeys = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!ALLOWED_KEY.test(key)) continue;
    if (target[key] !== undefined && target[key] !== '') continue;
    target[key] = unquote(match[2]);
    loadedKeys.push(key);
  }
  return loadedKeys;
}

let envState = null;

function ensureEnv() {
  if (envState) return envState;

  const file = setting('ENV_FILE');
  const state = {
    file: file || null,
    loadedKeys: [],
    error: null,
  };

  if (file) {
    const resolved = path.isAbsolute(file)
      ? file
      : path.resolve(__dirname, '..', '..', file);
    state.file = resolved;
    try {
      state.loadedKeys = loadEnvFile(resolved);
    } catch (err) {
      state.error = err.message;
    }
  }

  envState = state;
  return state;
}

function getFastConfig() {
  const envInfo = ensureEnv();
  const backend = String(setting('BACKEND', 'api')).trim().toLowerCase();
  if (!['api', 'mock'].includes(backend)) {
    throw new Error(`${settingName('BACKEND')} 必须是 api 或 mock`);
  }

  let apiKey = '';
  let keySource = null;
  for (const name of API_KEY_NAMES) {
    if (process.env[name]) {
      apiKey = process.env[name];
      keySource = name;
      break;
    }
  }

  const baseUrlName = settingName('BASE_URL');
  const baseUrl = String(setting('BASE_URL', DEFAULT_BASE_URL)).trim();
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${baseUrlName} 不是合法 URL：${baseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${baseUrlName} 必须是 http(s)`);
  }

  const timeoutMs = parseInteger('TIMEOUT_MS', 20000, 1000, 120000);
  const maxTokens = parseInteger('MAX_TOKENS', 256, 16, 2048);

  return {
    backend,
    apiKey,
    keySource,
    baseUrl,
    model: String(setting('MODEL', DEFAULT_MODEL)).trim(),
    timeoutMs,
    maxTokens,
    imageRoots: parseRoots(setting('IMAGE_ROOTS')),
    inputPrice: parsePrice('IN_PRICE'),
    outputPrice: parsePrice('OUT_PRICE'),
    thinking: false,
    envInfo,
  };
}

function resetEnvForTests() {
  envState = null;
}

module.exports = {
  loadEnvFile,
  getFastConfig,
  resetEnvForTests,
  settingName,
  SETTING_PREFIXES,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
};
