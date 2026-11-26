'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { grid, compare } = require('../tools/verdict');
const { estimate } = require('../tools/cost');
const { analyze } = require('../tools/power');
const { savings } = require('../tools/attention');
const { run } = require('../tools/validate-run');

const FIX = path.resolve(__dirname, 'fixtures');

function approx(actual, expected, eps = 1e-9) {
  assert.ok(Number.isFinite(actual), `实际值不是有限数字：${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `期望 ${expected}，实际 ${actual}，差 ${Math.abs(actual - expected)}`,
  );
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biocua-mcp-'));
}

test('verdict_grid 默认阈值与扫描行数', () => {
  const out = grid({});
  approx(out.ratios.b, 0.057 / 0.022, 1e-12);
  approx(out.ratios.c, 0.035 / 0.022, 1e-12);
  approx(out.thresholds.b, 0.88 / (0.057 / 0.022), 1e-12);
  approx(out.thresholds.c, 0.85 / (0.035 / 0.022), 1e-12);
  approx(out.thresholds.a, 0.90 / (0.658 / 0.022), 1e-12);
  assert.equal(out.rows.length, 15);
  assert.equal(out.scenarios.length, 3);
  assert.equal(out.scenarios[0].requirements.length, 4);
  assert.equal(out.scenarios[0].requirements[0].reachable, true);
});

test('verdict_compare 与内置算例数值一致', () => {
  const out = compare({
    a0: path.join(FIX, 'a0.jsonl'),
    x: [
      { name: 'B', path: path.join(FIX, 'b.jsonl') },
      { name: 'C', path: path.join(FIX, 'c.jsonl') },
    ],
  });

  assert.equal(out.a0.n, 40);
  approx(out.a0.rate, 0.4, 1e-12);
  approx(out.a0.ci.lo, 0.26348326, 1e-8);
  approx(out.a0.ci.hi, 0.55404106, 1e-8);
  approx(out.a0.meanCost, 0.022, 1e-12);
  approx(out.a0.cst, 0.055, 1e-12);

  const b = out.comparisons.find((item) => item.name === 'B');
  assert.equal(b.b, 6);
  assert.equal(b.c, 2);
  assert.equal(b.failA0, 24);
  approx(b.rate, 0.5, 1e-12);
  approx(b.meanCost, 0.057, 1e-12);
  approx(b.cst, 0.114, 1e-12);
  approx(b.mcnemarP, 0.2890625, 1e-12);
  approx(b.q, 0.25, 1e-12);
  approx(b.qStar, 0.4 * (0.057 / 0.022), 1e-12);
  assert.equal(b.hasSpace, false);

  const c = out.comparisons.find((item) => item.name === 'C');
  assert.equal(c.b, 16);
  assert.equal(c.c, 2);
  approx(c.rate, 0.75, 1e-12);
  approx(c.meanCost, 0.035, 1e-12);
  approx(c.cst, 0.035 / 0.75, 1e-12);
  approx(c.mcnemarP, 0.001312255859375, 1e-15);
  approx(c.q, 16 / 24, 1e-12);
  approx(c.qStar, 0.4 * (0.035 / 0.022), 1e-12);
  assert.equal(c.hasSpace, true);
});

test('verdict_compare 支持 base_dir 相对路径', () => {
  const out = compare({
    a0: 'a0.jsonl',
    x: [{ name: 'C', path: 'c.jsonl' }],
    base_dir: FIX,
  });
  assert.equal(out.a0.n, 40);
  assert.equal(out.comparisons[0].name, 'C');
});

test('verdict_compare 拒绝脏数据并统计成本回退', () => {
  const dir = tempDir();
  try {
    const dirty = path.join(dir, 'dirty.jsonl');
    fs.writeFileSync(dirty, `${JSON.stringify({ task_id: 't1', success: 'true' })}\n`);
    assert.throws(
      () => compare({ a0: dirty, x: [{ name: 'B', path: path.join(FIX, 'b.jsonl') }] }),
      /success 必须是布尔值/,
    );

    fs.writeFileSync(dirty, `${JSON.stringify({ task_id: 't1', success: true, cost_usd: -1 })}\n`);
    assert.throws(
      () => compare({ a0: dirty, x: [{ name: 'B', path: path.join(FIX, 'b.jsonl') }] }),
      /cost_usd 必须是非负数字/,
    );

    const a0 = path.join(dir, 'a0.jsonl');
    const x = path.join(dir, 'x.jsonl');
    fs.writeFileSync(a0, [
      JSON.stringify({ task_id: 't1', success: true }),
      JSON.stringify({ task_id: 't2', success: false }),
    ].join('\n'));
    fs.writeFileSync(x, [
      JSON.stringify({ task_id: 't1', success: true }),
      JSON.stringify({ task_id: 't2', success: true }),
    ].join('\n'));
    const out = compare({ a0, x: [{ name: 'X', path: x }] });
    assert.equal(out.a0.costFallbacks, 2);
    assert.equal(out.comparisons[0].costFallbacks, 2);
    approx(out.a0.meanCost, 0.022, 1e-12);
    approx(out.comparisons[0].meanCost, 0.057, 1e-12);
    approx(out.comparisons[0].rate, 1, 1e-12);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cost_estimate 四配置与内置算例一致', () => {
  const a = estimate({ config: 'A' });
  approx(a.cost, 0.65844, 1e-9);
  approx(a.cst, 0.65844 / 0.9, 1e-9);
  approx(a.relativeToA, 1, 1e-12);

  const a0 = estimate({ config: 'A0' });
  approx(a0.cost, 0.021948, 1e-9);

  const b = estimate({ config: 'B', n: 30, L: 5, rho: 0.033, success: 0.88 });
  approx(b.cost, 0.07387272, 1e-8);
  approx(b.cst, 0.07387272 / 0.88, 1e-8);
  assert.equal(b.steps, 6);

  const bOne = estimate({ config: 'B', L: 1, rho: 1 });
  approx(bOne.cost, 0.58077, 1e-5);

  const c = estimate({ config: 'C' });
  approx(c.cost, 0.035212572, 1e-9);
  approx(c.cst, 0.035212572 / 0.85, 1e-9);

  approx(a0.relativeToA, 0.021948 / 0.65844, 1e-12);
});

test('cost_estimate 拒绝越界参数', () => {
  assert.throws(() => estimate({ config: 'B', success: 2 }), /success 必须 ≤ 1/);
  assert.throws(() => estimate({ config: 'B', success: 0 }), /success 必须 > 0/);
  assert.throws(() => estimate({ config: 'B', n: 0 }), /n 必须 > 0/);
  assert.throws(() => estimate({ config: 'B', n: 2.5 }), /n 必须是整数/);
  assert.throws(() => estimate({ config: 'B', L: 0 }), /L 必须 > 0/);
  assert.throws(() => estimate({ config: 'Z' }), /config 必须是 A \/ A0 \/ B \/ C/);
});

test('power_analysis 的 CI 全宽与样本量', () => {
  const p = analyze({ n: 50 });
  approx(p.ciFullWidth, 0.173454, 1e-6);
  approx(p.ciHalfWidth, 0.086727, 1e-6);

  const q = analyze({ detect: 0.175 });
  approx(q.p1, 0.715, 1e-12);
  assert.equal(q.requiredNPerGroup, 81);
  assert.equal(q.requiredNTotal, 162);

  assert.equal(analyze({}).table.length, 6);
  assert.throws(() => analyze({ n: -5 }), /n 必须 > 0/);
  assert.throws(() => analyze({ n: 10.5 }), /n 必须是整数/);
  assert.throws(() => analyze({ detect: 0.95 }), /p0 - detect/);
});

test('attention_savings 与 36.3% 临界一致', () => {
  const out = savings({ n: 30, k: 10 });
  approx(out.roiReplacementRatio, (4916 - 350) / 5816, 1e-12);
  approx(out.roiReplacementRatio, 0.785076, 1e-6);
  approx(out.saving, ((30 - 10) / 30) * ((4916 - 350) / 5816), 1e-12);
  approx(out.saving, 0.523384, 1e-6);
  approx(out.criticalNavigationRatio, 1 - 0.5 / ((4916 - 350) / 5816), 1e-12);
  approx(out.criticalNavigationRatio, 0.363119, 1e-6);
  approx(out.criticalK, 30 * (1 - 0.5 / ((4916 - 350) / 5816)), 1e-12);
  approx(out.currentFrameOnlySaving, (1229 - 350) / 5816, 1e-12);

  assert.throws(() => savings({ n: 10, k: 11 }), /k 必须 ≤ 10/);
  assert.throws(() => savings({ n: 30, k: 10.5 }), /k 必须是整数/);
});

test('validate_run 正例与目录不存在', () => {
  const ok = run({ dir: path.join(FIX, 'run') });
  assert.equal(ok.ok, true);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.warnings.length, 0);
  assert.equal(ok.stats.tasks, 40);
  assert.equal(Object.keys(ok.stats.results).length, 3);

  const missing = run({ dir: path.join(FIX, 'nope') });
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0], /目录不存在/);
});

