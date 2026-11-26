'use strict';

const path = require('path');

function expectObject(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('arguments 必须是 JSON 对象');
  }
  return args;
}

function validateNumber(value, key, constraints) {
  const { min, max, exclusiveMin, exclusiveMax, integer } = constraints;
  if (!Number.isFinite(value)) throw new Error(`${key} 必须是有限数字`);
  if (integer && !Number.isInteger(value)) throw new Error(`${key} 必须是整数`);
  if (min !== undefined && value < min) throw new Error(`${key} 必须 ≥ ${min}`);
  if (max !== undefined && value > max) throw new Error(`${key} 必须 ≤ ${max}`);
  if (exclusiveMin !== undefined && value <= exclusiveMin) {
    throw new Error(`${key} 必须 > ${exclusiveMin}`);
  }
  if (exclusiveMax !== undefined && value >= exclusiveMax) {
    throw new Error(`${key} 必须 < ${exclusiveMax}`);
  }
}

function num(args, key, fallback, constraints = {}) {
  const provided = args[key] !== undefined && args[key] !== null;
  if (!provided && fallback === undefined) return undefined;
  if (provided && (typeof args[key] === 'boolean' || args[key] === '')) {
    throw new Error(`${key} 必须是数字`);
  }
  const value = provided ? Number(args[key]) : fallback;
  validateNumber(value, key, constraints);
  return value;
}

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value;
}

function baseDirFrom(args) {
  const value = args.base_dir;
  if (value === undefined || value === null) return process.cwd();
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('base_dir 必须是非空字符串');
  }
  return path.resolve(value);
}

function resolveInputPath(baseDir, value, key) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
}

function jsonReplacer(key, value) {
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return value;
}

module.exports = {
  expectObject,
  num,
  requireString,
  baseDirFrom,
  resolveInputPath,
  jsonReplacer,
};
