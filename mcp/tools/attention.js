'use strict';

const { expectObject, num } = require('./util');

const SINGLE_FRAME_TOKENS = 1229;

function savings(rawArgs) {
  const args = expectObject(rawArgs);
  const n = num(args, 'n', 30, { integer: true, exclusiveMin: 0 });
  const k = num(args, 'k', 0, { integer: true, min: 0, max: n });
  const full = num(args, 'full_image_tokens', 4916, { integer: true, exclusiveMin: 0 });
  const roi = num(args, 'roi_tokens', 350, { integer: true, min: 0 });
  const stepTokens = num(args, 'step_tokens', 5816, { exclusiveMin: 0 });
  if (roi > full) throw new Error('roi_tokens 不能大于 full_image_tokens');

  const ratio = (full - roi) / stepTokens;
  const saving = ((n - k) / n) * ratio;
  const criticalK = n * (1 - 0.5 / ratio);
  const currentFrameOnly = (SINGLE_FRAME_TOKENS - roi) / stepTokens;

  return {
    n,
    k,
    navigationRatio: k / n,
    roiReplacementRatio: ratio,
    saving,
    gate1Threshold: 0.5,
    criticalNavigationRatio: 1 - 0.5 / ratio,
    criticalK,
    currentFrameOnlySaving: currentFrameOnly,
    assumption: 'ROI 替换全部 K+1 张图；若只压当前帧（1229 tokens），上限为 currentFrameOnlySaving',
  };
}

module.exports = { savings };
