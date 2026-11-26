# Computer Use Toolkit

Computer Use 架构的确定性判定工具包：一个零依赖 MCP stdio 服务器，提供成本、级联判决、样本量、注意力节省率与 run 校验，可选接入 OpenAI 兼容快模型做动作提案。它不是 Computer Use 运行时，不启动浏览器、不执行 GUI 动作。

**English summary**

- A zero-dependency MCP stdio server for deterministic Computer Use analysis.
- Tools: cost/CST, cascade verdicts, power analysis, attention savings, and run validation.
- It does not control a browser or execute GUI actions; an optional OpenAI-compatible endpoint can be configured for action proposals.

本仓库只包含 MCP 服务器；不包含插件、基准数据或研究文档。

## 快速开始

要求：Node.js ≥ 18，零第三方依赖，无需 `npm install`。

```bash
# 直接启动（正常由 MCP 客户端拉起）
node mcp/server.js

# 跑测试：28 个用例
cd mcp && npm test
```

客户端配置示例见 [`mcp/mcp.example.json`](mcp/mcp.example.json)：把 `server.js` 的绝对路径填进 `mcpServers`（VS Code 用 `servers`），重启客户端或重载连接器即可。各客户端的配置文件位置、输入约定和完整工具说明见 [`mcp/README.md`](mcp/README.md)。

## 工具

服务器提供 8 个工具：

| 工具 | 作用 |
|---|---|
| `verdict_grid` | 扫描 R_A0，算 B/C/A 的支配阈值与级联打平 q* |
| `verdict_compare` | 按 task_id 配对，算成功率、Wilson 95% CI、精确 McNemar、q/q* |
| `cost_estimate` | A/A0/B/C 四配置的单次成本、CST 与相对 A 倍数 |
| `power_analysis` | 95% CI 全宽，或按最小可检测差异算每组样本量 |
| `attention_savings` | ROI 替换比、token 节省率与导航临界占比 |
| `validate_run` | 校验 run 目录的 manifest、tasks、results、trace 与 retries |
| `fast_propose_action` | 可选：调配置的 OpenAI 兼容快模型提出受白名单约束的 GUI 动作，只提案不执行 |
| `fast_status` | 查看快模型配置状态，不发请求 |

除 `fast_propose_action` 外，其余 7 个工具都是只读/离线计算。`fast_propose_action` 会把截图发送到你配置的外部 API；使用前请确认端点可信，并由宿主校验/审批模型返回的动作。

## 边界

- 这是**方法论与判定工具包**，不是 Computer Use 运行时：不启动浏览器、不调用模型执行任务。
- 成本、时延、成功率结论来自用户输入或本地公式；默认单价是示例快照，属估算，报告中应标注 `[估算]`。
- 夹具是合成数据，只用于验证脚本行为，不是基准实测结果。
- 仓库不附带基准结果、截图或数据集；所有输入由使用者提供。

## 开发

```bash
cd mcp
npm test
```

测试覆盖 MCP 握手与 `tools/list`、错误码、JSON 边界、数值算例、脏数据拒绝、路径越界拒绝与环境变量双前缀兼容。

## License

Apache-2.0；见 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)。
