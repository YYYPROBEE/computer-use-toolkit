'use strict';

const fs = require('fs');
const { wilson, mcnemarExact } = require('../lib/stats');
const { readJsonl } = require('../lib/validate');
const {
  expectObject,
  num,
  requireString,
  baseDirFrom,
  resolveInputPath,
} = require('./util');

const DEFAULT_SUCCESS_B = 0.88;
const DEFAULT_SUCCESS_C = 0.85;
const DEFAULT_SUCCESS_A = 0.90;

function cst(cost, rate) {
  return rate > 0 ? cost / rate : Infinity;
}

function loadResults(file) {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`);
  if (!fs.statSync(file).isFile()) throw new Error(`不是文件：${file}`);
  const rows = readJsonl(file);
  const map = new Map();
  let duplicates = 0;
  let costFallbacks = 0;
  for (const row of rows) {
    if (!row || typeof row.task_id !== 'string' || !row.task_id.trim()) {
      throw new Error(`${file}: 每行必须有非空字符串 task_id`);
    }
    if (typeof row.success !== 'boolean') {
      throw new Error(`${file}: task ${row.task_id} 的 success 必须是布尔值`);
    }
    if (row.cost_usd === undefined || row.cost_usd === null || row.cost_usd === '') {
      costFallbacks += 1;
    } else if (!Number.isFinite(Number(row.cost_usd)) || Number(row.cost_usd) < 0) {
      throw new Error(`${file}: task ${row.task_id} 的 cost_usd 必须是非负数字`);
    }
    if (map.has(row.task_id)) duplicates += 1;
    map.set(row.task_id, row);
  }
  return { map, duplicates, costFallbacks, file };
}

function averageCost(rows, fallback) {
  if (rows.length === 0) return NaN;
  let sum = 0;
  for (const row of rows) {
    const value = row.cost_usd === undefined || row.cost_usd === null || row.cost_usd === ''
      ? NaN
      : Number(row.cost_usd);
    sum += Number.isFinite(value) ? value : fallback;
  }
  return sum / rows.length;
}

function grid(rawArgs) {
  const args = expectObject(rawArgs);
  const costA0 = num(args, 'cost_a0', 0.022, { exclusiveMin: 0 });
  const costB = num(args, 'cost_b', 0.057, { exclusiveMin: 0 });
  const costC = num(args, 'cost_c', 0.035, { exclusiveMin: 0 });
  const costA = num(args, 'cost_a', 0.658, { exclusiveMin: 0 });
  const min = num(args, 'min', 0.20, { exclusiveMin: 0, max: 1 });
  const max = num(args, 'max', 0.90, { exclusiveMin: 0, max: 1 });
  const step = num(args, 'step', 0.05, { exclusiveMin: 0, max: 1 });
  if (min > max) throw new Error('min 不能大于 max');

  const rB = costB / costA0;
  const rC = costC / costA0;
  const rA = costA / costA0;
  const thresholdB = DEFAULT_SUCCESS_B / rB;
  const thresholdC = DEFAULT_SUCCESS_C / rC;
  const thresholdA = DEFAULT_SUCCESS_A / rA;

  const rows = [];
  for (let r = min; r <= max + 1e-9; r += step) {
    rows.push({
      rA0: r,
      cstA0: cst(costA0, r),
      cstB: cst(costB, DEFAULT_SUCCESS_B),
      cstC: cst(costC, DEFAULT_SUCCESS_C),
      spaceB: r < thresholdB,
      spaceC: r < thresholdC,
      qStarB: r * rB,
      qStarC: r * rC,
    });
  }

  const scenarios = [1.6, 2.6, 3.4].map((r) => ({
    r,
    requirements: [0.20, 0.30, 0.40, 0.60].map((rA0) => ({
      rA0,
      qStar: rA0 * r,
      reachable: rA0 * r <= 1,
    })),
  }));

  return {
    costs: { a0: costA0, b: costB, c: costC, a: costA },
    ratios: { b: rB, c: rC, a: rA },
    thresholds: { b: thresholdB, c: thresholdC, a: thresholdA },
    rows,
    scenarios,
    note: 'q* = R_A0 × r 是级联在 CST 上打平 A0 单独所需的最小升级成功率；q* > 1 表示级联不可能更便宜。',
  };
}

function compare(rawArgs) {
  const args = expectObject(rawArgs);
  const baseDir = baseDirFrom(args);
  const a0Path = resolveInputPath(baseDir, requireString(args, 'a0'), 'a0');
  const costA0Default = num(args, 'cost_a0', 0.022, { exclusiveMin: 0 });
  const costXDefault = num(args, 'cost_x', 0.057, { exclusiveMin: 0 });
  if (!Array.isArray(args.x) || args.x.length === 0) {
    throw new Error('x 必须是至少含一项的数组');
  }
  const xs = args.x.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`x[${index}] 必须是对象 { name, path }`);
    }
    const name = requireString(item, 'name');
    const file = requireString(item, 'path');
    return { name, path: resolveInputPath(baseDir, file, `x[${index}].path`) };
  });

  const a0 = loadResults(a0Path);
  const n = a0.map.size;
  if (n === 0) throw new Error('A0 文件没有数据行');
  const a0Rows = [...a0.map.values()];
  const k = a0Rows.filter((row) => row.success === true).length;
  const rate = k / n;
  const ciA0 = wilson(k, n);
  const meanA0 = averageCost(a0Rows, costA0Default);
  const cstA0 = cst(meanA0, rate);

  const result = {
    a0: {
      n,
      successes: k,
      rate,
      ci: ciA0,
      meanCost: meanA0,
      cst: cstA0,
      duplicates: a0.duplicates,
      costFallbacks: a0.costFallbacks,
    },
    comparisons: [],
  };

  for (const x of xs) {
    const loaded = loadResults(x.path);
    const common = [...a0.map.keys()].filter((id) => loaded.map.has(id)).sort();
    if (common.length === 0) throw new Error(`${x.name}: 与 A0 没有可配对的 task_id`);
    const rowsX = common.map((id) => loaded.map.get(id));
    const kx = rowsX.filter((row) => row.success === true).length;
    const rx = kx / common.length;
    const ciX = wilson(kx, common.length);
    const meanX = averageCost(rowsX, costXDefault);
    const cstX = cst(meanX, rx);
    const b = common.filter((id) => a0.map.get(id).success !== true && loaded.map.get(id).success === true).length;
    const c = common.filter((id) => a0.map.get(id).success === true && loaded.map.get(id).success !== true).length;
    const failA0 = common.filter((id) => a0.map.get(id).success !== true).length;
    const q = failA0 > 0 ? b / failA0 : NaN;
    const qCi = failA0 > 0 ? wilson(b, failA0) : null;
    const r = meanX / meanA0;
    const qStar = rate * r;
    const space = rate < rx / r;
    const marginal = rx > rate ? (cstX - cstA0) / (rx - rate) : null;

    result.comparisons.push({
      name: x.name,
      n: common.length,
      successes: kx,
      rate: rx,
      ci: ciX,
      meanCost: meanX,
      cst: cstX,
      b,
      c,
      mcnemarP: mcnemarExact(b, c),
      failA0,
      q,
      qCi,
      r,
      qStar,
      hasSpace: space,
      marginalCostPerExtraSuccess: marginal,
      duplicates: loaded.duplicates,
      costFallbacks: loaded.costFallbacks,
      pairedWarning: common.length < n ? `仅 ${common.length}/${n} 个 task_id 配对` : null,
    });
  }

  return result;
}

module.exports = { grid, compare };
