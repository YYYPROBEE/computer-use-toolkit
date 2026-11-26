'use strict';

const Z95 = 1.959963984540054;
const Z80 = 0.8416212335729143;

function wilson(k, n, z = Z95) {
  if (!Number.isFinite(n) || n <= 0) {
    return { k, n, p: NaN, lo: NaN, hi: NaN };
  }
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    k,
    n,
    p,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
  };
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  const kk = Math.min(k, n - k);
  let sum = 0;
  for (let i = 1; i <= kk; i += 1) {
    sum += Math.log((n - kk + i) / i);
  }
  return sum;
}

function logSumExp(logs) {
  if (logs.length === 0) return -Infinity;
  const max = Math.max(...logs);
  if (!Number.isFinite(max)) return max;
  let sum = 0;
  for (const value of logs) sum += Math.exp(value - max);
  return max + Math.log(sum);
}

function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  const logs = [];
  for (let i = 0; i <= k; i += 1) logs.push(logChoose(n, i));
  const logTail = logSumExp(logs);
  const p = 2 * Math.exp(logTail - n * Math.LN2);
  return Math.min(1, p);
}

function ciFullWidth(n, p = 0.89, z = Z95) {
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return 2 * z * Math.sqrt((p * (1 - p)) / n);
}

function requiredN(p0, p1, power = 0.8) {
  if (!(p0 > 0 && p0 < 1) || !(p1 > 0 && p1 < 1) || p0 === p1) {
    throw new Error('requiredN 需要两个不同的 (0,1) 比例');
  }
  const zBeta = power === 0.8 ? Z80 : invNormal(power);
  const pbar = (p0 + p1) / 2;
  const numerator =
    Z95 * Math.sqrt(2 * pbar * (1 - pbar)) +
    zBeta * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1));
  return Math.ceil((numerator * numerator) / ((p1 - p0) * (p1 - p0)));
}

function invNormal(p) {
  if (p <= 0 || p >= 1) throw new Error('invNormal 需要 (0,1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const plow = 0.02425;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function fmtPct(x, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtUsd(x) {
  return `$${x.toFixed(4)}`;
}

module.exports = {
  Z95,
  Z80,
  wilson,
  mcnemarExact,
  ciFullWidth,
  requiredN,
  invNormal,
  fmtPct,
  fmtUsd,
};
