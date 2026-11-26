'use strict';

const { estimateCost } = require('../lib/cost');
const { expectObject, num, requireString } = require('./util');

const COST_NOTE = '默认单价是 2026-11-12 官网价快照，token 量与成功率为可替换参数；报告时标注 [估算]。';

function estimate(rawArgs) {
  const args = expectObject(rawArgs);
  const config = requireString(args, 'config').toUpperCase();
  if (!['A', 'A0', 'B', 'C'].includes(config)) {
    throw new Error('config 必须是 A / A0 / B / C');
  }

  const options = {
    n: num(args, 'n', 30, { integer: true, exclusiveMin: 0 }),
    L: num(args, 'L', undefined, { integer: true, exclusiveMin: 0 }),
    rho: num(args, 'rho', undefined, { min: 0, max: 1 }),
    success: num(args, 'success', undefined, { exclusiveMin: 0, max: 1 }),
    inPrice: num(args, 'in_price', undefined, { min: 0 }),
    outPrice: num(args, 'out_price', undefined, { min: 0 }),
    plannerIn: num(args, 'planner_in', undefined, { min: 0 }),
    plannerOut: num(args, 'planner_out', undefined, { min: 0 }),
    fastInPrice: num(args, 'fast_in', undefined, { min: 0 }),
    fastOutPrice: num(args, 'fast_out', undefined, { min: 0 }),
    imageTokens: num(args, 'image_tokens', undefined, { integer: true, min: 0 }),
    history: num(args, 'history', undefined, { integer: true, min: 0 }),
    textTokens: num(args, 'text_tokens', undefined, { integer: true, min: 0 }),
    outTokens: num(args, 'out_tokens', undefined, { integer: true, min: 0 }),
    planIn: num(args, 'plan_in', undefined, { integer: true, min: 0 }),
    planOut: num(args, 'plan_out', undefined, { integer: true, min: 0 }),
    roiIn: num(args, 'roi_in', undefined, { integer: true, min: 0 }),
    roiOut: num(args, 'roi_out', undefined, { integer: true, min: 0 }),
    verIn: num(args, 'ver_in', undefined, { integer: true, min: 0 }),
    verOut: num(args, 'ver_out', undefined, { integer: true, min: 0 }),
    exceptionRate: num(args, 'exception_rate', undefined, { min: 0, max: 1 }),
    codeCost: num(args, 'code_cost', undefined, { min: 0 }),
  };

  const result = estimateCost(config, options);
  const reference = estimateCost('A', { n: result.n });
  result.relativeToA = result.cost / reference.cost;
  result.referenceACost = reference.cost;
  result.note = COST_NOTE;
  return result;
}

module.exports = { estimate };
