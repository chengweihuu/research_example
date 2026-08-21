# 本项目使用的 Pi Agent 功能

本文盘点本项目 `.pi/` 实现实际调用或明确配置的 Pi 功能。审计基线为 commit `afb74c8`，
依赖由 [`.pi/package-lock.json`](../.pi/package-lock.json) 固定为
`@earendil-works/pi-coding-agent` `0.84.2`。本文不是 Pi 的完整功能手册，也不把 lockfile 中出现的
每个传递依赖都算作项目已经使用的能力。

配套的整体关系图见 [Pi evidence harness architecture](pi_evidence_harness_architecture.png)。

## 运行路径

项目以三条彼此隔离的路径使用 Pi：

| 路径 | Pi 的角色 | 工具、上下文与网络边界 | 主要入口 |
|---|---|---|---|
| CLI Extension 门控 | Pi CLI 承载扩展，在内置工具调用前触发门控，并提供两个扩展命令 | 门控对象为 `write`、`edit`、`bash`；Smoke 命令显式控制 context files、extensions 和可见 tools | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |
| 受控 Pi Core / fixture | `Agent` 执行一个确定性或注入流的单回合 Session | 无环境上下文发现、无认证、无网络；工具为空或仅为显式自定义工具 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs)、[`pi-task-entry.mjs`](../.pi/harness/pi-task-entry.mjs) |
| 真实模型 canary | `Agent` 通过 `ModelRuntime` 发出一次真实 SSE 请求 | 使用已有 OpenAI Codex 登录；网络开启；无工具；只允许一个 provider stream | [`real-pi-run.mjs`](../.pi/harness/real-pi-run.mjs) |

## 实际使用的 Pi 功能

### Pi Extension 与 CLI

| Pi 功能 | 本项目怎样使用 | 使用状态与边界 | 源码 |
|---|---|---|---|
| Extension 加载 | 导出接收 `ExtensionAPI` 的扩展函数，把研究门控装入 Pi CLI | 实际实现 | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |
| `tool_call` 事件 | 通过 `pi.on("tool_call", ...)` 在工具执行前读取工具名、参数和 `ctx.cwd` | 对拒绝项返回 `block`、`reason`、`terminate`；只处理 `write`、`edit`、`bash` | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |
| 自定义 slash command | 用 `pi.registerCommand` 注册 `/research-closeout-draft` 与 `/research-gate-report` | 命令只能写入显式 fixture/run 目录，不直接修改权威状态 | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |
| UI 通知 | 命令处理器通过 `ctx.ui.notify` 报告参数错误和 Smoke 结果 | 只作交互反馈，不作为证据 | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |
| CLI 内置工具选择 | Smoke 场景使用 Pi 的 `bash`、`write` 工具，并用 `--tools`、`--no-context-files`、`--no-extensions` 和 `-e` 控制启动能力 | `edit` 在门控 allowlist 中，但当前报告生成逻辑明确说明该次真实 Run 只 dispatch 了 `bash`；不能据此声称三个工具都在同一次 Run 中执行 | [`research-gates.ts`](../.pi/extensions/research-gates.ts) |

### Pi Core Agent 与 Session

| Pi 功能 | 本项目怎样使用 | 使用状态与边界 | 源码 |
|---|---|---|---|
| `Agent` 构造 | 设置 `systemPrompt`、model、`thinkingLevel` 和 tools，建立受控 Agent | `thinkingLevel` 固定为 `off` | [`runner.mjs`](../.pi/harness/runner.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs)、[`real-pi-run.mjs`](../.pi/harness/real-pi-run.mjs) |
| Session 身份 | 把规范 Run ID 传入 `sessionId`，随后保存 Session transcript 和事件类型 | Run ID 与 Session ID 的相等约束是本项目合同，不是 Pi 自动提供的研究证据规则 | [`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs)、[`canonical-run-seal.mjs`](../.pi/harness/canonical-run-seal.mjs) |
| 回合执行 | 使用 `agent.prompt(...)`、`agent.waitForIdle()` 和 `agent.state.messages` 完成请求并读取 transcript | fixture 与真实路径都限制为一个回合 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs) |
| Agent 事件订阅 | 用 `agent.subscribe(...)` 收集 `agent_start`、`agent_end` 等事件类型 | 只把 allowlisted 阶段/类型投影进回执，不把事件 payload 当作证据 | [`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs)、[`pi-event-observer.mjs`](../.pi/harness/pi-event-observer.mjs) |
| 停止回调 | 通过 `shouldStopAfterTurn` 在固定条件下停止 | 注入流和真实路径始终一回合；faux 路径按固定调用数停止 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`real-pi-run.mjs`](../.pi/harness/real-pi-run.mjs) |
| 工具执行模式 | 设置 `toolExecution: "sequential"` | 未使用并行工具执行 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs) |

### 模型运行时与流

| Pi 功能 | 本项目怎样使用 | 使用状态与边界 | 源码 |
|---|---|---|---|
| 自定义 `streamFn` | 把确定性 faux provider、注入的 fixture stream 或真实 runtime stream 接到 `Agent` | 每条受控路径都显式提供 stream，不让 Agent 自行发现 transport | [`runner.mjs`](../.pi/harness/runner.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs) |
| SSE transport | 真实和注入路径设置 `transport: "sse"`，并观察 provider 事件 | 只允许一次 stream；自动重试为 0 | [`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs)、[`real-pi-run.mjs`](../.pi/harness/real-pi-run.mjs) |
| `AssistantMessageEventStream` | 包装外部异步流，或构造固定的 `start`、`text_delta`、`done` 事件序列 | 用于事件边界观测和无网络 fixture，不代表真实 provider 成功 | [`pi-task-entry.mjs`](../.pi/harness/pi-task-entry.mjs)、[`pi-task-adapter.mjs`](../.pi/harness/pi-task-adapter.mjs) |
| `ModelRuntime` | 创建 runtime、离线刷新本地认证/模型目录、取得精确 model，并调用 `streamSimple` | 仅真实 canary 路径使用；固定为 `openai-codex/gpt-5.6-terra` | [`real-pi-run.mjs`](../.pi/harness/real-pi-run.mjs) |
| 标准化 assistant message | 从 `agent.state.messages` 读取文本、`stopReason` 和 usage | usage 只有在完整且通过项目校验时才进入结算 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`settlement.mjs`](../.pi/harness/settlement.mjs) |

### 自定义工具与确定性测试替身

| Pi 功能 | 本项目怎样使用 | 使用状态与边界 | 源码 |
|---|---|---|---|
| 自定义 tool object | 给 Agent 提供 `name`、`description`、TypeBox `parameters` 和 `execute` | 工具集合必须由 capability manifest 明确声明 | [`runner.mjs`](../.pi/harness/runner.mjs)、[`tool-plane.mjs`](../.pi/harness/tool-plane.mjs) |
| `beforeToolCall` | 在 Pi 执行工具前拒绝未声明能力 | 被拒绝时返回 `block`、`reason`、`terminate` | [`runner.mjs`](../.pi/harness/runner.mjs) |
| 单一输出工具 | `write_run_note` 只允许写入显式 `output_dir` 下的相对路径 | 使用 faux provider；不调用真实模型 | [`runner.mjs`](../.pi/harness/runner.mjs) |
| 五个 Git/file 工具 | 暴露 `repo_read`、`repo_search`、`repo_apply_patch`、`git_status`、`git_diff` | 当前 Smoke 只连接内存 mock adapter，不读写真实仓库，也不执行 Git 进程 | [`tool-plane.mjs`](../.pi/harness/tool-plane.mjs)、[`runner.mjs`](../.pi/harness/runner.mjs) |
| faux provider 与消息/tool-call fixture | 使用 `fauxProvider`、`fauxAssistantMessage`、`fauxToolCall` 生成确定性响应 | 用来验证 Agent 和工具协议；模型调用数与费用均为 0 | [`runner.mjs`](../.pi/harness/runner.mjs) |

## 关键限制与明确未使用项

| 能力 | 当前状态 |
|---|---|
| 多回合或多次 provider 请求 | 未使用；受控 adapter 和真实 canary 都强制一次 stream、一个回合 |
| 自动重试 | 未使用；请求设置 `maxRetries: 0`，Harness 预算也固定为 0 |
| Compaction | 未使用；faux Harness 显式记录 `compactionEnabled: false` 和零 compaction |
| Thinking 模式 | 未使用；所有 `Agent` 初始化均为 `thinkingLevel: "off"` |
| 并行工具调用 | 未使用；所有 Agent 均设置顺序执行 |
| Core Harness 的 Pi 内置工具 | 未使用；注入流和真实模型路径的 `tools`、`builtInPiTools` 都为空 |
| 自动发现 `AGENTS.md` 或其他 context files | 受控 Harness 未使用；context manifest 记录无 ambient/discovered context，CLI Smoke 也可显式 `--no-context-files` |
| 网络和认证 | faux/fixture 路径均不使用；只有真实 canary 使用已有 OpenAI Codex 登录并开启网络 |
| 多 Agent、子 Agent、MCP、机器人控制 | 当前 `.pi/` 实现未使用 |
| `pi-client`、`pi-protocol`、`pi-tui`、`pi-telemetry` | lockfile 中存在，但项目源码没有直接 import；这里只视为传递依赖，不计为已直接使用 API |

## 哪些能力属于项目 Harness，而不是 Pi

下面这些部件围绕 Pi Session 工作，但由本项目实现，不能描述为“Pi 自带功能”：

- 请求预算、模型身份和单调用 preflight：[`canary-executor.mjs`](../.pi/harness/canary-executor.mjs)、[`model-profile.mjs`](../.pi/harness/model-profile.mjs)；
- execution packet、Allowed Changes 和 capability manifest：[`execution-packet.mjs`](../.pi/harness/execution-packet.mjs)；
- 哈希账本与进度回执：[`ledger.mjs`](../.pi/harness/ledger.mjs)；
- Run 封存、artifact hash、身份对账与凭据扫描：[`canonical-run-seal.mjs`](../.pi/harness/canonical-run-seal.mjs)；
- Idea/Run 绑定和“已登记但尚非 Evidence”的晋级规则：[`idea-evidence-lifecycle.mjs`](../.pi/harness/idea-evidence-lifecycle.mjs)；
- Harness 状态文件和本地计算 runner：[`harness-status.mjs`](../.pi/harness/harness-status.mjs)、[`local-compute-runner.mjs`](../.pi/harness/local-compute-runner.mjs)。

因此，Pi 在这里负责“运行 Agent、模型流和工具协议”；项目 Harness 负责“研究权限、预算、
审计、封存和证据资格”。普通 Pi transcript 本身不会自动成为科研证据。
