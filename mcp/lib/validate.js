'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_KEYS = [
  'run_date', 'env', 'env_version', 'commit', 'seed', 'temperature',
  'models', 'prices', 'retry', 'max_steps',
];
const TASK_KEYS = [
  'task_id', 'instruction', 'domain', 'app', 'max_steps', 'checker',
  'risk', 'split', 'est_minutes',
];
const RESULT_KEYS = [
  'task_id', 'config', 'model', 'success', 'steps', 'retries', 'cost_usd',
  'latency_s', 'input_tokens', 'output_tokens', 'cached_tokens',
  'image_tokens', 'failure_reason', 'trace_path',
];

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`${file}:${i + 1}: JSON 解析失败：${err.message}`);
    }
  }
  return rows;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function missingKeys(obj, keys) {
  return keys.filter((key) => !(key in obj));
}

function parseMaxRetries(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const match = value.match(/max_retries\s*=\s*(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function validateManifest(manifest, label, errors, warnings) {
  if (!isPlainObject(manifest)) {
    errors.push(`${label}: 顶层必须是 JSON 对象`);
    return;
  }
  const missing = missingKeys(manifest, MANIFEST_KEYS);
  if (missing.length) errors.push(`${label}: 缺字段 ${missing.join(', ')}`);
  if (!Number.isFinite(manifest.seed)) errors.push(`${label}: seed 必须是数字`);
  if (!Number.isFinite(manifest.temperature)) errors.push(`${label}: temperature 必须是数字`);
  if (!Number.isFinite(manifest.max_steps) || manifest.max_steps <= 0) {
    errors.push(`${label}: max_steps 必须是正数`);
  }
  const maxRetries = parseMaxRetries(manifest.retry);
  if (maxRetries === null) {
    errors.push(`${label}: retry 必须是非负整数或 max_retries=N 字符串`);
  } else if (maxRetries > 1) {
    errors.push(`${label}: retry=${maxRetries} 超过协议上限 1`);
  }
  if (!isPlainObject(manifest.models)) {
    errors.push(`${label}: models 必须是对象`);
  } else {
    for (const key of ['a0', 'planner', 'fast']) {
      if (!manifest.models[key]) warnings.push(`${label}: models.${key} 未提供`);
    }
  }
  if (!isPlainObject(manifest.prices)) {
    errors.push(`${label}: prices 必须是对象`);
  } else {
    if (!manifest.prices.date) warnings.push(`${label}: prices.date 未提供，成本口径可能不可追溯`);
  }
}

function validateTasks(tasks, label, errors, warnings) {
  if (tasks.length === 0) {
    errors.push(`${label}: 没有任务行`);
    return new Set();
  }
  const ids = new Set();
  for (let i = 0; i < tasks.length; i += 1) {
    const row = tasks[i];
    const pos = `${label} 第 ${i + 1} 行`;
    if (!isPlainObject(row)) {
      errors.push(`${pos}: 必须是 JSON 对象`);
      continue;
    }
    const missing = missingKeys(row, TASK_KEYS);
    if (missing.length) errors.push(`${pos}: 缺字段 ${missing.join(', ')}`);
    if (typeof row.task_id !== 'string' || !row.task_id.trim()) {
      errors.push(`${pos}: task_id 必须是非空字符串`);
    } else if (ids.has(row.task_id)) {
      errors.push(`${pos}: task_id 重复：${row.task_id}`);
    } else {
      ids.add(row.task_id);
    }
    if (row.risk && !['low', 'medium', 'high'].includes(row.risk)) {
      errors.push(`${pos}: risk 必须是 low/medium/high`);
    }
    if (row.split && !['public', 'private'].includes(row.split)) {
      errors.push(`${pos}: split 必须是 public/private`);
    }
    if (typeof row.checker !== 'string' || !row.checker.trim()) {
      errors.push(`${pos}: checker 必须是非空字符串`);
    } else if (row.checker === 'human') {
      warnings.push(`${pos}: checker=human，需按 20% 双人独立评分`);
    }
    if (!Number.isFinite(row.max_steps) || row.max_steps <= 0) {
      errors.push(`${pos}: max_steps 必须是正数`);
    }
    if (!Number.isFinite(row.est_minutes) || row.est_minutes <= 0) {
      errors.push(`${pos}: est_minutes 必须是正数`);
    }
  }
  return ids;
}

function validateResults(rows, label, taskIds, runDir, errors, warnings, maxRetries = 1) {
  if (rows.length === 0) {
    errors.push(`${label}: 没有结果行`);
    return { count: 0 };
  }
  const seen = new Set();
  const configs = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const pos = `${label} 第 ${i + 1} 行`;
    if (!isPlainObject(row)) {
      errors.push(`${pos}: 必须是 JSON 对象`);
      continue;
    }
    const missing = missingKeys(row, RESULT_KEYS);
    if (missing.length) errors.push(`${pos}: 缺字段 ${missing.join(', ')}`);

    if (typeof row.task_id !== 'string' || !row.task_id.trim()) {
      errors.push(`${pos}: task_id 必须是非空字符串`);
    } else {
      if (seen.has(row.task_id)) errors.push(`${pos}: task_id 重复：${row.task_id}`);
      seen.add(row.task_id);
      if (taskIds.size && !taskIds.has(row.task_id)) {
        errors.push(`${pos}: task_id 不在 tasks.jsonl 中：${row.task_id}`);
      }
    }

    if (typeof row.config === 'string') configs.add(row.config);
    else errors.push(`${pos}: config 必须是字符串`);

    if (typeof row.success !== 'boolean') {
      errors.push(`${pos}: success 必须是布尔值（来自 checker，不是模型自述）`);
    }
    if (!Number.isInteger(row.steps) || row.steps <= 0) {
      errors.push(`${pos}: steps 必须是正整数`);
    }
    if (!Number.isInteger(row.retries) || row.retries < 0) {
      errors.push(`${pos}: retries 必须是非负整数`);
    } else if (row.retries > maxRetries) {
      errors.push(`${pos}: retries=${row.retries} 超过 manifest 允许的 ${maxRetries}`);
    }
    if (!Number.isFinite(row.cost_usd) || row.cost_usd < 0) {
      errors.push(`${pos}: cost_usd 必须是非负数字`);
    }
    if (!Number.isFinite(row.latency_s) || row.latency_s <= 0) {
      errors.push(`${pos}: latency_s 必须是正数`);
    }
    for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'image_tokens']) {
      if (!Number.isInteger(row[key]) || row[key] < 0) {
        errors.push(`${pos}: ${key} 必须是非负整数`);
      }
    }
    if (!('failure_reason' in row)) errors.push(`${pos}: 缺少 failure_reason`);
    if (!('trace_path' in row)) errors.push(`${pos}: 缺少 trace_path`);

    if (typeof row.trace_path === 'string' && row.trace_path.trim()) {
      const trace = path.resolve(runDir, row.trace_path);
      const relative = path.relative(runDir, trace);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        errors.push(`${pos}: trace_path 必须位于 run 目录内：${row.trace_path}`);
      } else if (!fs.existsSync(trace)) {
        errors.push(`${pos}: trace_path 不存在：${row.trace_path}`);
      }
    } else if (row.trace_path === null || row.trace_path === undefined) {
      warnings.push(`${pos}: trace_path 为空，M3 轨迹指标不可算`);
    }
  }

  if (configs.size > 1) {
    warnings.push(`${label}: 同一文件含多个 config（${[...configs].join(', ')}），配对时必须分开`);
  }

  if (taskIds.size) {
    const missing = [...taskIds].filter((id) => !seen.has(id));
    if (missing.length) {
      errors.push(`${label}: 任务覆盖不全，缺 ${missing.length}/${taskIds.size} 个，例如 ${missing.slice(0, 5).join(', ')}`);
    }
  }
  return { count: rows.length };
}

function collectResultsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, 'results.jsonl');
    if (fs.existsSync(candidate)) files.push(candidate);
  }
  const root = path.join(dir, 'results.jsonl');
  if (fs.existsSync(root)) files.push(root);
  return files.sort();
}

function validateRun(dir) {
  const errors = [];
  const warnings = [];
  const stats = { tasks: 0, results: {} };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    errors.push(`目录不存在：${dir}`);
    return { dir, errors, warnings, stats, ok: false };
  }

  let maxRetries = 1;
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    errors.push('缺 manifest.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      validateManifest(manifest, 'manifest.json', errors, warnings);
      const parsedRetries = parseMaxRetries(manifest.retry);
      if (parsedRetries !== null) maxRetries = parsedRetries;
    } catch (err) {
      errors.push(`manifest.json 解析失败：${err.message}`);
    }
  }

  let taskIds = new Set();
  const tasksPath = path.join(dir, 'tasks.jsonl');
  if (!fs.existsSync(tasksPath)) {
    errors.push('缺 tasks.jsonl');
  } else {
    try {
      const tasks = readJsonl(tasksPath);
      stats.tasks = tasks.length;
      taskIds = validateTasks(tasks, 'tasks.jsonl', errors, warnings);
    } catch (err) {
      errors.push(err.message);
    }
  }

  const resultsFiles = collectResultsFiles(dir);
  if (resultsFiles.length === 0) {
    errors.push('未找到任何 */results.jsonl');
  }
  for (const file of resultsFiles) {
    const label = path.relative(dir, file).replace(/\\/g, '/');
    try {
      const rows = readJsonl(file);
      const info = validateResults(rows, label, taskIds, dir, errors, warnings, maxRetries);
      stats.results[label] = info.count;
    } catch (err) {
      errors.push(err.message);
    }
  }

  return { dir, errors, warnings, stats, ok: errors.length === 0 };
}

module.exports = {
  MANIFEST_KEYS,
  TASK_KEYS,
  RESULT_KEYS,
  readJsonl,
  validateManifest,
  validateTasks,
  validateResults,
  validateRun,
};
