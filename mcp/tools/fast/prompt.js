'use strict';

const DEFAULT_ACTIONS = Object.freeze([
  'click',
  'double_click',
  'right_click',
  'type',
  'key',
  'scroll',
  'drag',
  'wait',
  'done',
  'fail',
]);

// sequence 是 opt-in：只有调用方在 allowed_actions 里显式给出时才允许，
// 默认动作集保持原来的 10 个原子动作，避免改变既有客户端行为。
const ALLOWED_ACTIONS = Object.freeze([...DEFAULT_ACTIONS, 'sequence', 'select']);

const SYSTEM_PROMPT = [
  '你是 Computer Use 的快执行器，只负责提出下一个 GUI 动作。',
  '规则：',
  '1. 只输出一个 JSON 对象；不要 Markdown、代码围栏、解释或前后缀。',
  '2. 动作 type 必须属于允许动作列表；禁止 shell、文件、网络、代码执行等非 UI 动作。',
  '3. 坐标一律使用 0-1000 归一化（左上 0,0，右下 1000,1000）；点击与拖拽必须给坐标。',
  '4. 不确定时输出 {"type":"fail","reason":"..."}；任务完成时输出 {"type":"done","summary":"..."}。',
  '5. 你只提案，不执行；不要臆造截图中不存在的信息。',
  '6. 截图可能带 0-1000 归一化红色网格：红线是 10% 刻度，标注数字是归一化坐标；先读网格再给坐标。',
  '7. 若截图有红色十字，它是上一次点击的落点；用它与目标的偏移修正下一击。',
  '8. Canvas 页面没有元素索引，必须用坐标。若允许 sequence，可一次输出最多 6 个原子动作（click/double_click/type/key/select）用于连续且控件位置不变的步骤；sequence 的字段名必须是 actions（兼容 steps），内禁止嵌套、done、fail、drag、scroll、right_click 和 element_index。',
  '8b. 若允许 select，原生下拉优先用 {"type":"select","x":500,"y":300,"option":"选项文字"}：x/y 指向下拉框，option 用屏幕上的可见文字；不要用多次 ArrowDown 硬试。',
  '8c. scroll 的 dy>0 向下滚动、dy<0 向上；dx>0 向右、dx<0 向左。dy/dx 是像素，不是归一化比例，一次滚动常用 ±300~800。截图通常 1280×720：归一化坐标 = 像素 x / 1280 × 1000，像素 y / 720 × 1000。',
  '9. 可选 memory 字段：用于跨多次调用保存你观察到的关键事实（如卡片符号/位置、已走过的路径），最多 500 字；宿主会在下一次调用时带回。',
  '输出示例：{"type":"click","x":500,"y":300,"button":"left","confidence":0.8,"reason":"点击确认按钮","memory":"A at (0,1); B at (2,3)"}',
].join('\n');

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…（截断）` : text;
}

function normalizeHistory(history) {
  if (history === undefined || history === null) return [];
  if (!Array.isArray(history)) throw new Error('history 必须是数组');
  const entries = history.slice(-10).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`history[${index}] 必须是对象`);
    }
    const entry = { action: item.action };
    if (item.result !== undefined) {
      if (typeof item.result !== 'string') throw new Error(`history[${index}].result 必须是字符串`);
      entry.result = truncate(item.result, 500);
    }
    if (item.memory !== undefined) {
      if (typeof item.memory !== 'string') throw new Error(`history[${index}].memory 必须是字符串`);
      entry.memory = truncate(item.memory, 500);
    }
    return entry;
  });
  const serialized = JSON.stringify(entries);
  return serialized.length > 12000
    ? [{ note: 'history 过长，已省略', truncated: true }]
    : entries;
}

function buildMessages({ instruction, uiState, history, allowedActions, image, detailImage }) {
  const sections = [
    `任务：${instruction}`,
    `允许动作：${allowedActions.join(', ')}`,
  ];
  const normalizedHistory = normalizeHistory(history);
  if (normalizedHistory.length > 0) {
    sections.push(`最近动作：${JSON.stringify(normalizedHistory)}`);
  }
  if (uiState) {
    sections.push(`UI 状态：\n${truncate(uiState, 12000)}`);
  }
  sections.push('请根据当前截图/UI 状态只输出下一个动作的 JSON。');

  const content = [{ type: 'text', text: sections.join('\n\n') }];
  if (image) {
    content.push({ type: 'text', text: '主图（带红网格；所有坐标以此图为准）' });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    });
  }
  if (detailImage) {
    content.push({ type: 'text', text: '细节图（局部放大或原生画布；仅用于读数，坐标仍按主图）' });
    content.push({
      type: 'image_url',
      image_url: { url: `data:${detailImage.mime};base64,${detailImage.base64}` },
    });
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content },
  ];
}

function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

// 模型偶尔会把同一个动作 JSON 连续输出两遍；取第一个完整对象，
// 避免把“多打了一遍”误判成格式错误。字符串里的花括号不参与配对。
function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function coord(value, key) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) {
    throw new Error(`模型返回的 ${key} 必须是 0-1000 的坐标`);
  }
  return Math.round(number * 1000) / 1000;
}

function finiteNumber(value, key, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`模型返回的 ${key} 必须是 ${min}..${max} 的数字`);
  }
  return number;
}

function textField(value, key, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`模型返回的 ${key} 必须是字符串`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new Error(`模型返回的 ${key} 不能为空`);
  return truncate(trimmed, max);
}

function point(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`模型返回的 ${key} 必须是 {x,y} 对象`);
  }
  return { x: coord(value.x, `${key}.x`), y: coord(value.y, `${key}.y`) };
}

function sanitizeAction(obj, allowedActions) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('模型返回的不是 JSON 对象');
  }
  const type = obj.type;
  if (typeof type !== 'string' || !allowedActions.includes(type)) {
    throw new Error(`模型返回了未允许的动作：${String(type)}（允许：${allowedActions.join(', ')}）`);
  }

  const action = { type };
  if (type === 'sequence') {
    const items = obj.actions === undefined ? obj.steps : obj.actions;
    if (!Array.isArray(items) || items.length < 1 || items.length > 6) {
      throw new Error('模型返回的 sequence.actions/steps 必须是 1-6 个子动作');
    }
    const subAllowed = allowedActions.filter((name) => name !== 'sequence');
    action.actions = items.map((sub, index) => {
      if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
        throw new Error(`sequence.actions[${index}] 必须是对象`);
      }
      if (['sequence', 'done', 'fail', 'drag', 'scroll', 'right_click'].includes(sub.type)) {
        throw new Error(`sequence.actions[${index}] 不允许 ${String(sub.type)}`);
      }
      if (sub.element_index !== undefined && sub.element_index !== null) {
        throw new Error(`sequence.actions[${index}] 不允许 element_index，请用坐标`);
      }
      if (!['click', 'double_click', 'type', 'key', 'select'].includes(sub.type)) {
        throw new Error(
          `sequence.actions[${index}] 类型必须是 click/double_click/type/key/select，收到 ${JSON.stringify(sub).slice(0, 160)}`,
        );
      }
      return sanitizeAction(sub, subAllowed);
    });
    return action;
  }
  if (type === 'click' || type === 'double_click' || type === 'right_click') {
    action.x = coord(obj.x, 'x');
    action.y = coord(obj.y, 'y');
    if (obj.button !== undefined) {
      if (!['left', 'right', 'middle'].includes(obj.button)) {
        throw new Error('模型返回的 button 必须是 left/right/middle');
      }
      action.button = obj.button;
    }
  } else if (type === 'type') {
    action.text = textField(obj.text, 'text', 4000);
  } else if (type === 'key') {
    const rawKeys = typeof obj.keys === 'string'
      ? obj.keys.split('+').map((key) => key.trim()).filter(Boolean)
      : obj.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0 || rawKeys.length > 6) {
      throw new Error(`模型返回的 keys 必须是 1-6 个按键的数组，收到 ${JSON.stringify(obj.keys)}`);
    }
    action.keys = rawKeys.map((key, index) => textField(key, `keys[${index}]`, 32));
  } else if (type === 'select') {
    action.x = coord(obj.x, 'x');
    action.y = coord(obj.y, 'y');
    action.option = textField(obj.option, 'option', 200);
  } else if (type === 'scroll') {
    action.dx = finiteNumber(obj.dx === undefined ? 0 : obj.dx, 'dx', -10000, 10000);
    action.dy = finiteNumber(obj.dy === undefined ? 0 : obj.dy, 'dy', -10000, 10000);
    if (obj.x !== undefined || obj.y !== undefined) {
      action.x = coord(obj.x, 'x');
      action.y = coord(obj.y, 'y');
    }
  } else if (type === 'drag') {
    action.from = point(obj.from, 'from');
    action.to = point(obj.to, 'to');
  } else if (type === 'wait') {
    action.ms = Math.round(finiteNumber(obj.ms === undefined ? 500 : obj.ms, 'ms', 0, 60000));
  } else if (type === 'done') {
    action.summary = textField(obj.summary === undefined ? '' : obj.summary, 'summary', 1000, { allowEmpty: true });
  } else if (type === 'fail') {
    action.reason = textField(
      obj.reason === undefined ? '未提供原因' : obj.reason,
      'reason',
      1000,
    );
  }
  return action;
}

function parseAction(rawText, allowedActions) {
  const cleaned = stripFences(rawText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const candidate = firstJsonObject(cleaned);
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = null;
      }
    }
    if (parsed === null || parsed === undefined) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          throw new Error(`模型输出不是合法 JSON：${truncate(cleaned, 200)}`);
        }
      } else {
        throw new Error(`模型输出不是合法 JSON：${truncate(cleaned, 200)}`);
      }
    }
  }

  const action = sanitizeAction(parsed, allowedActions);
  let confidence = null;
  if (parsed.confidence !== undefined && parsed.confidence !== null) {
    confidence = finiteNumber(parsed.confidence, 'confidence', 0, 1);
  }
  const reason = typeof parsed.reason === 'string' ? truncate(parsed.reason.trim(), 500) : '';
  const memory = typeof parsed.memory === 'string' ? truncate(parsed.memory.trim(), 500) : '';
  return { action, confidence, reason, memory };
}

module.exports = {
  ALLOWED_ACTIONS,
  DEFAULT_ACTIONS,
  SYSTEM_PROMPT,
  buildMessages,
  parseAction,
};