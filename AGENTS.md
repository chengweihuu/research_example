# 科研工作流

## 第一原则

一次只推进一个研究问题。除非有助于回答它，否则不要扩大范围、修复无关问题或保留过程。
本模板面向个人研究者与单 Agent：任务内自主，研究含义、证据接受和阶段变化由用户确认。

## 权威地图与读取顺序

开始工作时按需读取：

1. `state/AGENTS.md`：准备、执行或关闭任务时读取；它是 TASK 生命周期的唯一权威；
2. `state/TASK.md`：若为 Active，它定义当前唯一行动、预算和权限；
3. `state/CURRENT.md`：当前接受状态、对象指针和下一项决策；
4. `state/PROJECT.md`：仅在需要长期目标、安全或项目边界时；
5. TASK 精确引用的 Idea、Protocol、Experiment 或代码；
6. 准备写入子目录时，该目录最近的 `AGENTS.md`。

不要扫描整个 `docs/`。README 只服务人类快速理解；除非用户明确要求解释目录或 README，
不要读取或把它当作任务上下文。子目录 AGENTS 负责局部准入。文件规则冲突时停止报告，
不自行拼接。

目录地图：研究知识见 `docs/AGENTS.md`；正式 Python 代码见 `src/AGENTS.md`；探索和外部实现
见 `scratch/AGENTS.md`、`reproductions/AGENTS.md`；环境见 `docker/AGENTS.md`。

## Git 前置关卡

Git 是覆盖更新、审计和回滚的安全网。修改项目文件前先确认 `git rev-parse --is-inside-work-tree`
成功；若模板尚未初始化，停止执行并向用户提出 `git init`、初始提交和默认分支方案。没有
有效 Git 基线不得开始 Active `BUILD` 或 `FORMAL`，也不得覆盖 `CURRENT.md` 或 Idea。

`BUILD` 从干净、已接受的基线创建 `task/<task-id>` 分支；`FORMAL` 只运行干净的冻结 commit。
任务关闭的内容审批、提交和干净工作树要求见 `state/AGENTS.md`。

## THINK 与任务边界

没有 Active TASK 时处于 THINK：可以对话、只读检查必要文件、比较方案并形成待确认计划，
但不得修改项目文件。用户确认后先只准备 TASK，不在同一步执行。需要跨对话保存代码、计算
或长篇分析时，把它定义成 `EXPLORE`，不要建立额外 THINK 档案。

Active TASK 只能是 `EXPLORE`、`BUILD` 或 `FORMAL`。其精确形状、Type Contract、Progress、
Budget、分支和 Closeout 规则只在 `state/AGENTS.md` 定义。

以下情况必须停止并询问：

- 改变研究问题、Claim、假设、成功判据或 Task Type；
- 超出 Allowed Changes 或 TASK 中的文件、计算、时间、机器人预算；
- 新增依赖、长期公共接口、权威实现、架构抽象、启发式、阈值或降级策略；
- 将探索结果提升为正式代码或证据；
- Harness 缺口会威胁当前结果有效性，或修复它需要改变规则；
- 执行任何可能让真实机器人运动的命令。

新信息使任务失效时直接报告，不扩大任务挽救原计划。无关问题最多报告三个，不修复。

## 资产与证据硬边界

- `EXPLORE` 默认只写 Git 忽略的 `scratch/<task-id>/`，不能成为正式依赖或论文证据；
- 正式代码按最近的目录 AGENTS 落地；`src/`、`ros2_ws/` 不得依赖 `scratch/`；
- 运行输出进入 `runs/<task-id>/<run-id>/`，程序必须接收明确 `output_dir`；
- Run ID 使用 UTC：`R-YYYYMMDDTHHMMSSZ-<short-id>`，例如 `R-20260816T073015Z-a7f2`；
- 正式证据遵循 `Claim → Protocol → Run → Experiment → Idea Evidence Map`；
- Protocol 规则见 `docs/protocols/AGENTS.md`，结果状态与研究者接受规则见
  `docs/ideas/AGENTS.md`；
- 不提交 scratch、runs、日志、bag、完整参数扫描或大型原始数据。

科学判断不得用 AI 自评替代。任何可能让真实机器人运动的命令，都要先报告准确命令、硬件、
限制、预期行为和停止方式并等待批准；失败后不自动重试。

## Harness Gardening

用 diff、测试、性质检查、校验值和审查发现偏差。一次性摩擦记入剩余不确定性；只有重复、
系统性的失败才通过独立模板维护任务更新规则或增加最小机械检查。修改 AGENTS 后重启
Codex CLI/TUI，再用真实任务验证。

## 完成回复

只返回：结果、决定性证据、剩余不确定性、Closeout Plan 和下一项待决定事项。

## 环境、冻结与计算闸门

- BUILD 在写实现前必须在 TASK 中声明 `Environment Contract`：运行模式（host 或 Docker）、基础镜像/系统版本、语言与依赖锁、硬件/驱动（如有）、随机性和资源上限。
- FORMAL 必须绑定环境合同、依赖锁、数据清单、代码 commit，以及 Docker image digest 或主机环境指纹；绑定内容不能事后以补丁覆盖。
- 冻结对象只能通过新版本或新 Protocol 修改。旧文件、commit、运行和不利结果保留；纯排版或链接修正单独标记为 `Editorial correction`，不得改变数值、判定、范围或排除条件。
- 计算按 `Smoke → Pilot → Scale → Formal` 升级。每一级必须有通过条件、预算和停止条件；前一级失败时停止并报告，不自动扩大规模。

## Agent context contract

- 持久状态只保存结构化事实、指针、决策和校验值；原始工具输出和长日志写入任务输出目录，由短记录引用路径、摘要和 hash。
- 检索采用渐进披露：先读控制面和索引，再按对象/章节加载最小片段，只有明确需要时才读原始产物。
- 子 agent 默认不调用。委派必须发送 bounded Delegation Packet，只接收 bounded Result Packet；详细过程留在子任务输出中。
- 格式见 [`state/CONTEXT.md`](state/CONTEXT.md)。若运行平台不支持外部状态、独立 context 或 agent 隔离，必须报告能力缺口。
