# State 目录准入

这里是科研循环的当前控制面，不保存任务历史、实验日志或完整科学结论。

```text
PROJECT = 长期边界    CURRENT = 当前坐标    TASK = 唯一行动
```

## Git Bootstrap Gate

准备第一个 Active TASK 前，确认项目是有效 Git 工作树并已有初始提交。推荐：

```text
git init -b main
git add -A
git commit -m "chore: initialize research harness"
```

实际命令和提交身份由用户确认。没有有效基线时只可 THINK 和提出 bootstrap 方案，不得准备
`BUILD` / `FORMAL`、覆盖 CURRENT 或 Idea。`EXPLORE` 也应在基线后进行，除非用户明确批准
一次性的 bootstrap 迁移。

## THINK 与任务准备

没有 Active TASK 时处于 THINK。Codex 可以只读检查必要上下文、讨论方案并形成待确认计划，
但不修改项目文件。用户确认方向后，只用一次修改将 TASK 从 Inactive 替换为 Active；不得在
同一步执行任务。

未接受的讨论不写入仓库。若需要跨对话保留代码、计算或长篇分析，应准备 `EXPLORE` TASK，
输出到 `scratch/<task-id>/`。

## TASK 的唯一形状

Inactive 时，`TASK.md` 必须且只能是：

```markdown
# Current Task

Status: Inactive

下一步：根据 CURRENT 进入 THINK；用户确认计划后再替换本文件。
```

Active TASK 必须按以下顺序包含：

1. `Status: Active`；
2. `Identity`：Task ID、唯一 Type、单行 `Progress`、精确研究对象；
3. `Question`；
4. `Context`：只列执行必需的指针与事实；
5. `Allowed Changes`；
6. `Non-goals`；
7. `Budget`：至少列 Files、Time / Compute、Robot runs；
8. `Done When`：可观察、可检查的成功判据；
9. `Stop and Ask`；
10. `Outputs`：明确位置；
11. Type 所需合同；
12. `Closeout Plan: Pending`。

不要使用 `Expected Outcome`：意图由 Question 表达，验收由 Done When 表达，位置由 Outputs
表达。`Progress` 只保存当前检查点并原地覆盖，不追加过程日志。`Robot runs` 默认是 0；只有
用户批准准确运动命令后才能改变。

用户只需说明研究意图、约束和可观察成功标准。Codex 从 CURRENT 和关联文档解析编号并选择
owner、目录、接口、依赖方向和验证位置；存在多个研究含义时按含义消歧，不要求用户查编号。

完整填写示例只在需要构造或审查格式时读取 `EXAMPLES.md`，不要每次任务都加载。

## Task Type 与分支

| Type | 用途 | 专属内容 | Git / 输出边界 |
|---|---|---|---|
| `EXPLORE` | 理论、反例、最小临时计算 | 无额外合同 | `scratch/<task-id>/`，不提交 |
| `BUILD` | 实现已接受理论或明确工程能力 | Build Contract | 从干净基线建 `task/<task-id>` |
| `FORMAL` | 按冻结协议产生论文级证据 | Experiment Contract | 只运行干净的冻结 commit |

Codex 不得自行切换 Type。切换研究问题、Claim、成功判据或 Type 时替换 TASK，不在旧任务后
追加历史。

### Build Contract

| 需求或 Claim | Owner / Interface | 关键约束 | 验证 |
|---|---|---|---|

实现前核对输入输出、单位、坐标系、符号、边界和允许近似。Python 与 C++ 实现同一理论时，
合同必须声明允许误差和一致性验证。验证通过后才能声称实现与理论一致。

### Experiment Contract

| Claim | Protocol | Metric / Decision Rule | Evidence Location |
|---|---|---|---|

执行前冻结 Protocol、指标、判定规则、排除条件、数据范围、环境和运行 commit。结果记录与
研究者接受字段见 `docs/ideas/AGENTS.md`。

## 状态与知识边界

| 内容 | 唯一权威位置 |
|---|---|
| 长期项目目标与边界 | `PROJECT.md` |
| 对象指针、一句话接受状态、主要不确定性、下一项决策 | `CURRENT.md` |
| 科学主张、假设、理由和完整当前结论 | 对应 Idea |
| 冻结验证方法 | Protocol |
| FORMAL 详细结果、协议结果和研究者验证 | Experiment |
| 正式 Python 实现 | `src/` |
| 可丢弃探索 | `scratch/<task-id>/` |

CURRENT 不复制科学结论。接受的科学结论改变时，Closeout 必须在同一批准和同一提交中更新
Idea 的完整结论以及 CURRENT 的指针或一句话接受状态；任一端缺失都不得关闭。

## 内容级 Closeout

任务达到 Done When 后，先报告结果、决定性证据和剩余不确定性，再提出：

| 对象 | 处理 | 目标位置 | 拟批准内容 / 精确 diff | 原因 |
|---|---|---|---|---|

以下内容必须让用户批准“具体内容”，而不只是批准动作：

- CURRENT、Idea、Protocol 或其他权威知识：给出拟写入的完整文本或可读 diff；
- Experiment：给出 ProtocolOutcome、ResearcherVerification 和 ResearcherNote 的拟值；
- 代码或配置：给出准确文件列表和决定性 diff 摘要；
- 删除：给出每个准确路径；不得使用未展开的 glob；
- Git：给出纳入提交的准确文件和拟用 commit message。

用户确认前不得移动、删除、更新长期状态或提交。确认后只执行表中列出的内容；若实际 diff
与批准内容存在实质差异，停止并重新请求批准。

执行获批 Closeout 的顺序：

1. 应用获批的知识、代码和清理动作；
2. 运行合同中的验证并检查最终 diff；
3. 将 TASK 替换为上面的 Inactive 精确形状；
4. 用获批的文件集合和 message 创建接受提交；
5. 确认工作树干净。

关闭后不保留 TASK 历史；Git 提交保存已接受历史。FORMAL 的 Experiment 必须保留所有结果，
不能因研究者不同意解释而删除。

## Harness 缺口

若缺口会使当前结果无效，或修复需要改规则、扩大 Allowed Changes，立即 Stop and Ask。其他
一次性摩擦放入“剩余不确定性”；关闭时只询问它是否已重复且值得独立维护任务。科学判断
不得机械化，确定性结构只有重复失败后才增加最小检查。
