'use strict';

const { ciFullWidth, requiredN } = require('../lib/stats');
const { expectObject, num } = require('./util');

function analyze(rawArgs) {
  const args = expectObject(rawArgs);
  const p0 = num(args, 'p0', 0.89, { exclusiveMin: 0, exclusiveMax: 1 });
  const n = num(args, 'n', undefined, { integer: true, exclusiveMin: 0 });
  const detect = num(args, 'detect', undefined, { exclusiveMin: 0, exclusiveMax: 1 });

  const out = { p0 };
  if (n !== undefined) {
    out.n = n;
    out.ciFullWidth = ciFullWidth(n, p0);
    out.ciHalfWidth = out.ciFullWidth / 2;
  }
  if (detect !== undefined) {
    const p1 = p0 - detect;
    if (!(p1 > 0 && p1 < 1)) throw new Error('p0 - detect 必须在 (0,1) 内');
    out.detect = detect;
    out.p1 = p1;
    out.requiredNPerGroup = requiredN(p0, p1);
    out.requiredNTotal = out.requiredNPerGroup * 2;
  }
  if (n === undefined && detect === undefined) {
    out.table = [30, 50, 100, 400, 1700, 3800].map((size) => ({
      n: size,
      ciFullWidth: ciFullWidth(size, p0),
    }));
    out.note = 'table 是 95% CI 全宽，不是 80% power 的最小可检测差异；后者用 detect。';
  }
  return out;
}

module.exports = { analyze };
