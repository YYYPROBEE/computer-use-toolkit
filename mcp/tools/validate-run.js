'use strict';

const { validateRun } = require('../lib/validate');
const {
  expectObject,
  requireString,
  baseDirFrom,
  resolveInputPath,
} = require('./util');

function run(rawArgs) {
  const args = expectObject(rawArgs);
  const baseDir = baseDirFrom(args);
  const dir = resolveInputPath(baseDir, requireString(args, 'dir'), 'dir');
  const result = validateRun(dir);
  return {
    ...result,
    note: result.ok ? '格式合格，不代表结果真实。' : '存在阻断项，修复后重跑。',
  };
}

module.exports = { run };
