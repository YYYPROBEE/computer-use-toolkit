# Computer Use MCP

把 Computer Use 架构中的确定性判定能力（成本、级联判决、样本量、注意力节省率、run 校验）封装成零依赖的 MCP stdio 服务器。任何支持 [Model Context Protocol](https://modelcontextprotocol.io) 的客户端都能接入：Claude Desktop、Cursor、VS Code、Qoder、WorkBuddy，或自己写的 stdio 客户端。

这是**方法论与判定工具包**，不是 Computer Use 运行时：不启动浏览器、不执行 GUI 动作；只做本地计算、校验与动作提案。

## 能力边界

- 成本、时延、成功率结论来自用户输入或本地公式；默认单价是示例快照，属估算，报告中应标注 `[估算]`。
- 夹具是合成数据，只用于验证脚本行为，不是基准实测结果。
- 除 `fast_propose_action` 会向配置的外部 API 发截图外，服务器不写文件、不访问网络。
- `fast_propose_action` 只提出动作，不执行；动作必须由宿主校验/审批后落地。

## 快速接入

要求：Node.js ≥ 18（`fetch` 与 `node --test`）。无需 `npm install`，零第三方依赖。

1. 把 `mcp/` 目录放到任意位置，路径可以含空格。
2. 在客户端配置里加一条 `mcpServers`（VS Code 用 `servers`），指向 `server.js` 的绝对路径，见 `mcp.example.json`。
3. 重启客户端或重载连接器；工具会以 `<服务器名>__<工具名>` 的形式出现。
4. 如果要使用快模型工具，先调 `fast_status`：不发请求，只回配置状态，用来确认端点、模型、密钥与图片目录是否就绪。

### 客户端配置位置

| 客户端 | 配置文件 | 顶层键 |
|---|---|---|
| Claude Desktop | Windows `%APPDATA%\Claude\claude_desktop_config.json`；macOS `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` |
| Cursor | 全局 `~/.cursor/mcp.json`，或项目内 `.cursor/mcp.json` | `mcpServers` |
| VS Code（Copilot Chat） | 项目内 `.vscode/mcp.json` | `servers`（需 `"type": "stdio"`） |
| Qoder | CN `~/.qoder-cn/settings.json`；国际版 `~/.qoder/settings.json` | `mcpServers` |
| WorkBuddy | `~/.workbuddy/mcp.json` | `mcpServers` |
| 其他 stdio 客户端 | 由其文档决定 | 命令固定为 `node <绝对路径>/server.js` |

要点：

- `command` 用 PATH 中的 `node`；客户端环境找不到 Node 时改成 `node.exe` 的绝对路径。
- `args` 里写 `server.js` 的绝对路径，**用正斜杠**（`C:/tools/mcp/server.js`）或双反斜杠，别用单反斜杠。
- `cwd` 建议指向 `mcp/` 目录。`verdict_compare`、`validate_run`、`fast_propose_action` 的相对路径默认基于客户端进程工作目录，显式传 `base_dir` 更稳妥。
- Qoder 额外支持 `timeout`（毫秒），其他客户端忽略该字段。
- 工具名不带服务器前缀；不同客户端展示方式不同（Qoder 显示 `computer-use__verdict_grid`）。

### 启动方式

```bash
# 直接用 node 跑（最稳，推荐）
node "C:/path/to/mcp/server.js"

# 全局安装到本机，命令进 PATH（可选）
cd "C:/path/to/mcp" && npm i -g .
# 之后 command 可写 "computer-use-mcp"
```

本仓库不发布 npm 包；`package.json` 保持 `private: true`，避免误发布。

## 工具

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `verdict_grid` | 扫描 R_A0，算 B/C/A 的支配阈值与级联打平 q* | `cost_a0`、`cost_b`、`cost_c`、`cost_a`、`min`、`max`、`step` |
| `verdict_compare` | 按 task_id 配对，算成功率、Wilson 95% CI、精确 McNemar、q/q*、边际成本 | `a0`、`x[]`、`cost_a0`、`cost_x`、`base_dir` |
| `cost_estimate` | A/A0/B/C 四配置的单次成本、CST 与相对 A 倍数 | `config`、`n`、`L`、`rho`、`success` 及各单价/token 参数 |
| `power_analysis` | 95% CI 全宽；或按最小可检测差异算每组样本量 | `p0`、`n`、`detect` |
| `attention_savings` | ROI 替换比、token 节省率、50% 临界导航占比、只压当前帧上限 | `n`、`k`、`full_image_tokens`、`roi_tokens`、`step_tokens` |
| `validate_run` | 校验 run 目录的 manifest、tasks、results、trace 与 retries | `dir`、`base_dir` |
| `fast_propose_action` | 调配置的 OpenAI 兼容快模型（关思考）提出一个受白名单约束的 GUI 动作；可选 `sequence` 批量动作与顶层 `memory`；只提案不执行 | `instruction`、`screenshot_path`/`screenshot_base64`、`ui_state`、`history`、`allowed_actions` |
| `fast_status` | 返回快模型配置状态（端点、模型、密钥是否就绪、图片根目录），不发请求 | 无 |

除 `fast_propose_action` 外，其余 7 个工具都声明 `readOnlyHint: true`；`fast_propose_action` 声明 `openWorldHint: true`，因为它会出网。计算类工具返回 JSON 文本。

## 输入约定

- `a0`、`x[].path`、`dir` 接受绝对路径，或相对 `base_dir`（默认进程工作目录）的路径。
- 结果 JSONL 每行必须有字符串 `task_id` 与布尔 `success`；`cost_usd` 可缺省，缺省时按对应默认成本回退并计数告警。
- 参数越界（如 `success > 1`、`k > n`、`L = 0`）与脏数据会以 `isError` 文本返回，不会静默算出数值。

## 快模型（可选，OpenAI 兼容）

`fast_propose_action` 把快模型作为“动作提案器”接进 MCP：它看截图/UI 状态，返回一个受白名单约束的原子动作；不执行动作，执行仍由宿主完成。只有这个工具需要外部 API 配置，其余工具完全离线。

- **端点/模型**：通过 `CUA_FAST_BASE_URL` 与 `CUA_FAST_MODEL` 显式配置；代码里的默认值是占位示例，不能用于真实调用。
- **关思考**：请求体固定 `enable_thinking: false`。如果所用端点不支持该字段，请调整 `mcp/tools/fast/client.js` 或改用支持它的兼容端点。
- **图片**：`screenshot_path` 或 `screenshot_base64`，支持 PNG/JPEG/WEBP/GIF，原始大小上限 10 MB；发送前按 magic bytes 校验。
- **目录约束**：`CUA_FAST_IMAGE_ROOTS`（分号分隔）限制可发送的截图目录；未设置时返回 warning。
- **密钥**：从进程环境或 `CUA_FAST_ENV_FILE` 指向的 `.env` 读取；只加载白名单键，不会把 `GITHUB_TOKEN`、SSH 配置读进进程。密钥不写日志、不出现在返回值中，错误文本会脱敏。
- **成本**：设置 `CUA_FAST_IN_PRICE` / `CUA_FAST_OUT_PRICE`（USD / M tokens）后才返回 `estimatedCostUsd`；否则为 null，不猜价格。
- **重试**：默认不自动重试；`timeout_ms` 默认 20000。MCP 消息串行处理，不会并发打 API。
- **网格与红叉（可选）**：调用方可以先把截图预处理成 0–1000 归一化红色网格，并在上一次点击处画红叉；系统提示会引导模型先读网格、用红叉修正坐标。这不是服务端自动加图，仍由宿主决定。
- **`sequence`（opt-in）**：只有调用方在 `allowed_actions` 里显式包含 `sequence` 时才允许。一次最多 6 个 `click`/`double_click`/`type`/`key` 子动作；禁止嵌套、`done`、`fail`、`drag`、`scroll`、`right_click` 和 `element_index`。不传 `allowed_actions` 时默认仍是 10 个原子动作。
- **`memory`（可选输出）**：模型可在顶层返回最多 500 字的 `memory` 字符串；调用方把它放进下一次 `history` 的同一项里带回，用于部分可观察任务。
- **安全**：截图会离开本机；动作是模型输出，必须由宿主校验/审批后执行。高风险动作不要交给快模型直接落地。

## 配置项

统一使用 `CUA_FAST_` 前缀；旧版 `BIOCUA_FAST_` 前缀继续兼容。同名配置两边都设且都非空时以 `CUA_FAST_` 为准；某一边是空值等同于未设置，会回退到另一边。

| 变量 | 默认 | 说明 |
|---|---|---|
| `CUA_FAST_ENV_FILE` | 无 | `.env` 路径；只加载 `QWEN_API_KEY`、`DASHSCOPE_API_KEY`、`CUA_FAST_*`、`BIOCUA_FAST_*` |
| `CUA_FAST_API_KEY` | 无 | 优先于 `QWEN_API_KEY` / `DASHSCOPE_API_KEY` |
| `CUA_FAST_BASE_URL` | 占位示例 | 必须是 http(s)；真实调用必须改成你的 OpenAI 兼容端点 |
| `CUA_FAST_MODEL` | 占位示例 | 你的端点支持的模型名 |
| `CUA_FAST_TIMEOUT_MS` | `20000` | 1000–120000 |
| `CUA_FAST_MAX_TOKENS` | `256` | 16–2048 |
| `CUA_FAST_IMAGE_ROOTS` | 空 | 分号分隔的可发送截图目录 |
| `CUA_FAST_IN_PRICE` / `CUA_FAST_OUT_PRICE` | 无 | USD / M tokens；都设置才估算成本 |
| `CUA_FAST_BACKEND` | `api` | `api` 或 `mock`（离线联调，不打网络） |

连接器 `env` 示例（只写路径，不写密钥）：

```json
"env": {
  "CUA_FAST_ENV_FILE": "<绝对路径>/.env",
  "CUA_FAST_BASE_URL": "https://your-gateway.example/v1/chat/completions",
  "CUA_FAST_MODEL": "your-model",
  "CUA_FAST_IMAGE_ROOTS": "<截图目录>"
}
```

修改 env 后需要重载连接器或开新会话；可先调用 `fast_status` 检查端点、模型、密钥与目录是否就绪（不会返回密钥）。

## 自测

```bash
cd mcp
npm test        # 28 个用例：protocol / tools / fast
```

覆盖：MCP 握手与 `tools/list`、未知工具/未知方法的错误码、畸形 JSON、通知不响应、stdout 纯协议、内置算例对齐、脏数据拒绝、路径越界拒绝、环境变量双前缀兼容。

手工查看工具列表（正常入口是 MCP 客户端，不建议手工喂管道）：

```bash
node -e "const {spawn}=require('child_process');const p=spawn(process.execPath,['server.js'],{stdio:['pipe','pipe','inherit']});p.stdout.pipe(process.stdout);p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'manual',version:'0'}}})+'\n');p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');setTimeout(()=>p.stdin.end(),500);"
```

## 目录

```text
mcp/
├── server.js                 # stdio MCP 入口（零依赖 JSON-RPC）
├── package.json
├── mcp.example.json          # 通用接入示例
├── lib/
│   ├── stats.js
│   ├── cost.js
│   └── validate.js
├── tools/
│   ├── registry.js           # 工具定义与 JSON Schema
│   ├── verdict.js            # verdict_grid / verdict_compare
│   ├── cost.js
│   ├── power.js
│   ├── attention.js
│   ├── validate-run.js
│   ├── fast.js               # fast_propose_action / fast_status
│   └── fast/                 # env 白名单、图片校验、提示词、API 客户端
└── tests/
    ├── support/client.js
    ├── protocol.test.js
    ├── tools.test.js
    ├── fast.test.js
    └── fixtures/             # 合成数据与 run 目录
```

## License

Apache-2.0；见仓库根目录 `LICENSE`。
