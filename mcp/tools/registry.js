'use strict';

const { jsonReplacer } = require('./util');
const verdict = require('./verdict');
const cost = require('./cost');
const power = require('./power');
const attention = require('./attention');
const validateRun = require('./validate-run');
const fast = require('./fast');
const { ALLOWED_ACTIONS } = require('./fast/prompt');

const SERVER_INFO = Object.freeze({
  name: 'computer-use-mcp',
  title: 'Computer Use 判定工具包',
  version: '0.2.0',
});

const LATEST_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2024-11-05', '2025-03-26', '2025-06-18']);

const INSTRUCTIONS = [
  '这是 Computer Use 架构的方法论与判定工具包，不是运行时：不启动浏览器、不调用模型、不执行任务。',
  '所有数值由本地确定性脚本计算；默认单价是示例快照，属估算，报告中标注 [估算]。',
  '输入 JSONL 必须使用本地文件路径；success 必须是布尔值，cost_usd 缺失时按默认成本告警回退。',
  'fast_propose_action 只提出动作、不执行，并会把截图发送到配置的外部 API；fast_status 只读配置，可先用来检查密钥与环境是否就绪。',
  '配置项统一使用 CUA_FAST_ 前缀；旧版 BIOCUA_FAST_ 前缀仍然兼容，两者同时存在时以 CUA_FAST_ 为准。',
].join('\n');

const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const COST_GRID_SCHEMA = {
  type: 'object',
  properties: {
    cost_a0: { type: 'number', exclusiveMinimum: 0, description: 'A0 单次成本（USD），默认 0.022' },
    cost_b: { type: 'number', exclusiveMinimum: 0, description: 'B 单次成本（USD），默认 0.057' },
    cost_c: { type: 'number', exclusiveMinimum: 0, description: 'C 单次成本（USD），默认 0.035' },
    cost_a: { type: 'number', exclusiveMinimum: 0, description: 'A 单次成本（USD），默认 0.658' },
    min: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: 'R_A0 扫描起点，默认 0.20' },
    max: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: 'R_A0 扫描终点，默认 0.90' },
    step: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '扫描步长，默认 0.05' },
  },
  additionalProperties: false,
};

const TOOLS = [
  {
    name: 'verdict_grid',
    title: '级联支配阈值网格',
    description: '扫描 A0 成功率 R_A0，计算 B/C/A 的单位成本比 r、支配阈值与级联打平所需 q*。确定性计算，无模型调用。',
    inputSchema: COST_GRID_SCHEMA,
    handler: verdict.grid,
  },
  {
    name: 'verdict_compare',
    title: '配对判决与 CST 对比',
    description: '读取 A0 与一个或多个对照的 JSONL 结果，按 task_id 配对，计算成功率、Wilson 95% CI、精确 McNemar、q/q* 与每多一个成功的边际成本。拒绝非布尔 success 与非有限 cost_usd。',
    inputSchema: {
      type: 'object',
      properties: {
        a0: { type: 'string', description: 'A0 结果 JSONL 路径；相对路径按 base_dir 解析' },
        x: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '对照名称，如 B 或 C' },
              path: { type: 'string', description: '该对照的结果 JSONL 路径' },
            },
            required: ['name', 'path'],
            additionalProperties: false,
          },
          description: '一个或多个对照结果文件',
        },
        cost_a0: { type: 'number', exclusiveMinimum: 0, description: 'A0 缺 cost_usd 时的默认单次成本，默认 0.022' },
        cost_x: { type: 'number', exclusiveMinimum: 0, description: '对照缺 cost_usd 时的默认单次成本，默认 0.057' },
        base_dir: { type: 'string', description: '相对路径的基准目录，默认进程工作目录' },
      },
      required: ['a0', 'x'],
      additionalProperties: false,
    },
    handler: verdict.compare,
  },
  {
    name: 'cost_estimate',
    title: '单次成本与 CST 估算',
    description: '按 A/A0/B/C 四配置计算单次成本、成功率与 CST，并给出相对 A 的倍数。默认单价为官网快照，属估算。',
    inputSchema: {
      type: 'object',
      properties: {
        config: { type: 'string', enum: ['A', 'A0', 'B', 'C'], description: '配置档位' },
        n: { type: 'integer', exclusiveMinimum: 0, description: '任务步数，默认 30' },
        L: { type: 'integer', exclusiveMinimum: 0, description: '重规划间隔步数；A0 默认 3，B 默认 5，C 默认 10' },
        rho: { type: 'number', minimum: 0, maximum: 1, description: '快层相对规划器的单价比例，B/C 默认 0.033' },
        success: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '成功率；A/A0 默认 0.90，B 默认 0.88，C 默认 0.85' },
        in_price: { type: 'number', minimum: 0, description: 'A/A0 输入单价（USD / M tokens）' },
        out_price: { type: 'number', minimum: 0, description: 'A/A0 输出单价（USD / M tokens）' },
        planner_in: { type: 'number', minimum: 0, description: '规划器输入单价（USD / M tokens）' },
        planner_out: { type: 'number', minimum: 0, description: '规划器输出单价（USD / M tokens）' },
        fast_in: { type: 'number', minimum: 0, description: '快层输入单价（USD / M tokens），默认 planner_in × rho' },
        fast_out: { type: 'number', minimum: 0, description: '快层输出单价（USD / M tokens），默认 planner_out × rho' },
        image_tokens: { type: 'integer', minimum: 0, description: '单张截图 tokens，A/A0 默认 1229' },
        history: { type: 'integer', minimum: 0, description: '历史帧数，A/A0 默认 3' },
        text_tokens: { type: 'integer', minimum: 0, description: '每步文本 tokens，A/A0 默认 900' },
        out_tokens: { type: 'integer', minimum: 0, description: '每步输出 tokens，A/A0 默认 300' },
        plan_in: { type: 'integer', minimum: 0, description: '规划输入 tokens，B/C 默认 1377' },
        plan_out: { type: 'integer', minimum: 0, description: '规划输出 tokens，B/C 默认 500' },
        roi_in: { type: 'integer', minimum: 0, description: 'ROI 输入 tokens，B/C 默认 926' },
        roi_out: { type: 'integer', minimum: 0, description: 'ROI 输出 tokens，B/C 默认 30' },
        ver_in: { type: 'integer', minimum: 0, description: '验证器输入 tokens，B 默认 1000' },
        ver_out: { type: 'integer', minimum: 0, description: '验证器输出 tokens，B 默认 100' },
        exception_rate: { type: 'number', minimum: 0, maximum: 1, description: 'C 的异常率，默认 0.10' },
        code_cost: { type: 'number', minimum: 0, description: 'C 的每动作代码成本（USD），默认 0' },
      },
      required: ['config'],
      additionalProperties: false,
    },
    handler: cost.estimate,
  },
  {
    name: 'power_analysis',
    title: '样本量与 CI 全宽',
    description: '给定 n 计算 95% Wilson CI 全宽；或给定最小可检测差异计算每组所需样本量（α=0.05 双侧，power=0.8）。',
    inputSchema: {
      type: 'object',
      properties: {
        p0: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: '基线成功率，默认 0.89' },
        n: { type: 'integer', exclusiveMinimum: 0, description: '任务数' },
        detect: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: '要检测的绝对差异（如 0.175）' },
      },
      additionalProperties: false,
    },
    handler: power.analyze,
  },
  {
    name: 'attention_savings',
    title: '注意力 ROI 节省率',
    description: '计算 ROI 替换比、输入 token 节省率、Gate 1 的 50% 临界导航占比，以及只压当前帧时的节省上限。',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'integer', exclusiveMinimum: 0, description: '每任务帧数，默认 30' },
        k: { type: 'integer', minimum: 0, description: '导航帧数（保留全图），默认 0' },
        full_image_tokens: { type: 'integer', exclusiveMinimum: 0, description: '全图 tokens，默认 4916' },
        roi_tokens: { type: 'integer', minimum: 0, description: 'ROI 裁剪后 tokens，默认 350' },
        step_tokens: { type: 'number', exclusiveMinimum: 0, description: '每步总输入 tokens，默认 5816' },
      },
      additionalProperties: false,
    },
    handler: attention.savings,
  },
  {
    name: 'validate_run',
    title: '实验目录格式校验',
    description: '校验 run 目录的 manifest、tasks 与 */results.jsonl：字段、类型、task 覆盖、trace 越界、retries 上限，以及重试与成本口径。通过只代表格式合格。',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'run 目录路径；相对路径按 base_dir 解析' },
        base_dir: { type: 'string', description: '相对路径的基准目录，默认进程工作目录' },
      },
      required: ['dir'],
      additionalProperties: false,
    },
    handler: validateRun.run,
  },
  {
    name: 'fast_propose_action',
    title: '快模型动作提案',
    description: '调用配置的 OpenAI 兼容快模型（enable_thinking=false）作为执行器/计划器：根据任务、截图/UI 状态与最近动作，返回受白名单约束的 GUI 动作提案；allowed_actions 显式包含 sequence 时可返回最多 6 个原子动作，包含 select 时可按下拉框坐标与选项文字选择原生下拉，顶层可带 memory 字符串。只提案、不执行；截图会发送到配置的外部 API。',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: '任务目标' },
        screenshot_path: { type: 'string', description: '本地截图路径（PNG/JPEG/WEBP/GIF）；相对路径按 base_dir 解析' },
        screenshot_base64: { type: 'string', description: '截图 base64；与 screenshot_path 二选一' },
        screenshot_detail_path: { type: 'string', description: '可选：局部放大图本地路径，作为第二张图辅助读数；坐标仍按主图' },
        screenshot_mime: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          description: 'screenshot_base64 的 MIME 类型',
        },
        ui_state: { type: 'string', description: '可访问性树 / DOM 摘要；与截图可同时提供' },
        history: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              action: { type: 'object', description: '上一步动作' },
              result: { type: 'string', description: '上一步结果摘要' },
            },
            additionalProperties: false,
          },
          description: '最近动作；服务端最多取最后 10 条',
        },
        allowed_actions: {
          type: 'array',
          items: { type: 'string', enum: [...ALLOWED_ACTIONS] },
          description: '动作白名单，默认 click/double_click/right_click/type/key/scroll/drag/wait/done/fail；可显式加 sequence 与 select',
        },
        max_tokens: { type: 'integer', minimum: 16, maximum: 2048, description: '输出上限，默认取环境配置（256）' },
        temperature: { type: 'number', minimum: 0, maximum: 1, description: '默认 0' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000, description: '请求超时，默认取环境配置（20000）' },
        base_dir: { type: 'string', description: '相对路径的基准目录，默认进程工作目录' },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: fast.propose,
  },
  {
    name: 'fast_status',
    title: '快模型配置状态',
    description: '返回快模型后端、模型名、base URL、密钥是否已配置（不返回值）、环境文件、图片根目录与价格配置；不发请求、不返回密钥。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: fast.status,
  },
];

function listTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations || READ_ONLY,
  }));
}

function getTool(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}

async function callTool(tool, rawArgs) {
  const data = await tool.handler(rawArgs);
  const text = typeof data === 'string' ? data : JSON.stringify(data, jsonReplacer, 2);
  return { content: [{ type: 'text', text }] };
}

module.exports = {
  SERVER_INFO,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  INSTRUCTIONS,
  listTools,
  getTool,
  callTool,
};
