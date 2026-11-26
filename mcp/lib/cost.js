'use strict';

const DEFAULTS = {
  A: {
    inPrice: 3.0,
    outPrice: 15.0,
    textTokens: 900,
    imageTokens: 1229,
    history: 3,
    outTokens: 300,
    success: 0.90,
  },
  A0: {
    inPrice: 0.10,
    outPrice: 0.50,
    textTokens: 900,
    imageTokens: 1229,
    history: 3,
    outTokens: 300,
    success: 0.90,
  },
  B: {
    plannerIn: 3.0,
    plannerOut: 15.0,
    rho: 0.033,
    planIn: 1377,
    planOut: 500,
    roiIn: 926,
    roiOut: 30,
    verIn: 1000,
    verOut: 100,
    L: 5,
    success: 0.88,
  },
  C: {
    plannerIn: 3.0,
    plannerOut: 15.0,
    rho: 0.033,
    planIn: 1377,
    planOut: 500,
    roiIn: 926,
    roiOut: 30,
    L: 10,
    exceptionRate: 0.10,
    codeCostPerAction: 0,
    success: 0.85,
  },
};

function numberOr(value, fallback) {
  return value === undefined || value === null || Number.isNaN(Number(value))
    ? fallback
    : Number(value);
}

function estimateCost(config, options = {}) {
  const key = String(config || '').toUpperCase();
  if (!DEFAULTS[key]) {
    throw new Error(`未知配置：${config}（可选 A / A0 / B / C）`);
  }
  const d = DEFAULTS[key];
  const n = numberOr(options.n, 30);
  if (!(n > 0)) throw new Error('n 必须为正数');

  let result;
  if (key === 'A' || key === 'A0') {
    const imageTokens = numberOr(options.imageTokens, d.imageTokens);
    const history = numberOr(options.history, d.history);
    const textTokens = numberOr(options.textTokens, d.textTokens);
    const outTokens = numberOr(options.outTokens, d.outTokens);
    const inPrice = numberOr(options.inPrice, d.inPrice);
    const outPrice = numberOr(options.outPrice, d.outPrice);
    const perStepInput = textTokens + (history + 1) * imageTokens;
    const cost = n * ((perStepInput * inPrice) / 1e6 + (outTokens * outPrice) / 1e6);
    result = {
      config: key,
      n,
      perStepInput,
      textTokens,
      imageTokens,
      history,
      outTokens,
      inPrice,
      outPrice,
      cost,
    };
  } else if (key === 'B') {
    const L = numberOr(options.L, d.L);
    if (!(L > 0)) throw new Error('L 必须为正数');
    const steps = Math.ceil(n / L);
    const plannerIn = numberOr(options.plannerIn, d.plannerIn);
    const plannerOut = numberOr(options.plannerOut, d.plannerOut);
    const rho = numberOr(options.rho, d.rho);
    const fastInPrice = numberOr(options.fastInPrice, plannerIn * rho);
    const fastOutPrice = numberOr(options.fastOutPrice, plannerOut * rho);
    const planIn = numberOr(options.planIn, d.planIn);
    const planOut = numberOr(options.planOut, d.planOut);
    const roiIn = numberOr(options.roiIn, d.roiIn);
    const roiOut = numberOr(options.roiOut, d.roiOut);
    const verIn = numberOr(options.verIn, d.verIn);
    const verOut = numberOr(options.verOut, d.verOut);
    const plannerCost = steps * ((planIn * plannerIn) / 1e6 + (planOut * plannerOut) / 1e6);
    const fastCost = n * ((roiIn * fastInPrice) / 1e6 + (roiOut * fastOutPrice) / 1e6);
    const verifierCost = steps * ((verIn * fastInPrice) / 1e6 + (verOut * fastOutPrice) / 1e6);
    result = {
      config: key,
      n,
      L,
      steps,
      rho,
      fastInPrice,
      fastOutPrice,
      plannerCost,
      fastCost,
      verifierCost,
      cost: plannerCost + fastCost + verifierCost,
    };
  } else {
    const L = numberOr(options.L, d.L);
    if (!(L > 0)) throw new Error('L 必须为正数');
    const steps = Math.ceil(n / L);
    const plannerIn = numberOr(options.plannerIn, d.plannerIn);
    const plannerOut = numberOr(options.plannerOut, d.plannerOut);
    const rho = numberOr(options.rho, d.rho);
    const fastInPrice = numberOr(options.fastInPrice, plannerIn * rho);
    const fastOutPrice = numberOr(options.fastOutPrice, plannerOut * rho);
    const planIn = numberOr(options.planIn, d.planIn);
    const planOut = numberOr(options.planOut, d.planOut);
    const roiIn = numberOr(options.roiIn, d.roiIn);
    const roiOut = numberOr(options.roiOut, d.roiOut);
    const exceptionRate = numberOr(options.exceptionRate, d.exceptionRate);
    const codeCostPerAction = numberOr(options.codeCost, d.codeCostPerAction);
    const plannerCost = steps * ((planIn * plannerIn) / 1e6 + (planOut * plannerOut) / 1e6);
    const exceptionActions = n * exceptionRate;
    const exceptionCost = exceptionActions *
      ((roiIn * fastInPrice) / 1e6 + (roiOut * fastOutPrice) / 1e6);
    const codeCost = n * codeCostPerAction;
    result = {
      config: key,
      n,
      L,
      steps,
      rho,
      fastInPrice,
      fastOutPrice,
      exceptionRate,
      exceptionActions,
      plannerCost,
      exceptionCost,
      codeCost,
      cost: plannerCost + exceptionCost + codeCost,
    };
  }

  const success = numberOr(options.success, d.success);
  result.success = success;
  result.cst = success > 0 ? result.cost / success : Infinity;
  return result;
}

module.exports = { DEFAULTS, estimateCost };
