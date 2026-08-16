# 最小完整示例

本文件只在准备或审查 TASK、Closeout、Experiment、`run.yaml` 时读取。以下 ID 和内容都是
示例，不代表真实项目状态，也不要把示例对象预建到项目中。

## 1. Inactive TASK

```markdown
# Current Task

Status: Inactive

下一步：根据 CURRENT 进入 THINK；用户确认计划后再替换本文件。
```

## 2. EXPLORE TASK

```markdown
# Current Task

## Status

Active

## Identity

- Task ID: T-101
- Type: EXPLORE
- Progress: Ready — waiting to run the first counterexample sweep.
- Research objects: I-001:C-01

## Question

在曲率接近零时，候选误差公式是否仍保持符号连续？

## Context

- Idea: `docs/ideas/I-001_path_error.md#c-01`

## Allowed Changes

- `scratch/T-101/`
- `state/TASK.md`（仅覆盖 Progress）

## Non-goals

- 不修改正式实现；不形成论文证据。

## Budget

- Files: `scratch/T-101/` 内最多 3 个文件
- Time / Compute: CPU 10 分钟；不使用网络或 GPU
- Robot runs: 0

## Done When

- 给出零曲率两侧各一个数值例子，并说明是否存在符号跳变。

## Stop and Ask

- 需要改变 C-01 的定义或引入新的阈值。

## Outputs

- `scratch/T-101/summary.md`
- `scratch/T-101/check.py`

## Closeout Plan

Pending
```

## 3. BUILD TASK 与 Build Contract

```markdown
# Current Task

## Status

Active

## Identity

- Task ID: T-102
- Type: BUILD
- Progress: Ready — branch `task/T-102` created from accepted commit `abc1234`.
- Research objects: I-001:C-01

## Question

如何把已接受的有符号横向误差公式实现为纯 Python 参考函数？

## Context

- Idea: `docs/ideas/I-001_path_error.md#c-01`
- Accepted baseline: `abc1234`

## Allowed Changes

- `src/path_error.py`
- `tests/test_path_error.py`
- `state/TASK.md`（仅覆盖 Progress）

## Non-goals

- 不加入 ROS 适配、阈值或降级策略。

## Budget

- Files: 2 个正式文件
- Time / Compute: CPU 测试 2 分钟
- Robot runs: 0

## Done When

- 单位、符号和零曲率边界测试通过；公开接口只有 `signed_lateral_error`。

## Stop and Ask

- 理论没有定义退化切向量时的行为。

## Outputs

- `src/path_error.py`
- `tests/test_path_error.py`

## Build Contract

| 需求或 Claim | Owner / Interface | 关键约束 | 验证 |
|---|---|---|---|
| I-001:C-01 | `src/path_error.py::signed_lateral_error` | 输入米；右手坐标；零曲率连续 | 单元、边界、性质测试 |

## Closeout Plan

Pending
```

## 4. FORMAL TASK 与 Experiment Contract

```markdown
# Current Task

## Status

Active

## Identity

- Task ID: T-103
- Type: FORMAL
- Progress: Ready — protocol and commit frozen; no run started.
- Research objects: I-001:C-01, P-001, E-001

## Question

冻结数据集上的横向误差是否满足 P-001 的精度判据？

## Context

- Idea: `docs/ideas/I-001_path_error.md#c-01`
- Protocol: `docs/protocols/P-001_accuracy.md` (`Frozen`)
- Frozen commit: `def5678`

## Allowed Changes

- `runs/T-103/`
- `experiments/E-001/`
- `state/TASK.md`（仅覆盖 Progress）

## Non-goals

- 不改实现、协议、指标、排除条件或数据范围。

## Budget

- Files: 1 个 Experiment 摘要；runs 不计入提交文件
- Time / Compute: CPU 2 小时；不使用网络
- Robot runs: 0

## Done When

- 所有冻结样本运行一次；run.yaml 和校验值完整；E-001 记录所有结果。

## Stop and Ask

- 冻结数据不可用、实现错误或需要排除新样本。

## Outputs

- `runs/T-103/R-20260816T073015Z-a7f2/`
- `experiments/E-001/README.md`

## Experiment Contract

| Claim | Protocol | Metric / Decision Rule | Evidence Location |
|---|---|---|---|
| I-001:C-01 | P-001 | MAE ≤ 0.05 m 且无预定义失败样本 | `experiments/E-001/` |

## Closeout Plan

Pending
```

## 5. 内容级 Closeout Plan

表格先确定对象和动作；权威知识的完整拟写文本或 diff 紧跟其后。

| 对象 | 处理 | 目标位置 | 拟批准内容 / 精确 diff | 原因 |
|---|---|---|---|---|
| 科学结论 | 更新 | `docs/ideas/I-001_path_error.md` | 见 Patch A | 保存完整结论与理由 |
| 当前坐标 | 更新 | `state/CURRENT.md` | 见 Patch B | 只保存一句话状态和下一决策 |
| 正式实现 | 进入维护 | `src/path_error.py`、`tests/test_path_error.py` | 新增 2 文件；验证 12 passed | BUILD 验收通过 |
| 探索目录 | 删除 | `scratch/T-102/` | 删除准确目录 | 已无长期价值 |
| Git | 提交 | 当前分支 | 上述 4 项；`build: accept signed lateral error` | 保存接受历史 |

### Patch A：Idea 的拟批准内容

```diff
 ## Current Conclusion
-- Untested.
+- Accepted: 在 P-001 定义域内，公式满足横向误差精度判据。
+- Scope: 不覆盖退化切向量；理由和限制见 E-001。
```

### Patch B：CURRENT 的拟批准内容

```diff
 ## 一句话接受状态
-- I-001:C-01 尚未验证。
+- I-001:C-01 已在 P-001 定义域内接受；完整结论见 Idea。

 ## 下一项需要决定的事情
-- 是否执行 P-001。
+- 是否为退化切向量建立新 Claim。
```

如果实际 diff 与 Patch A/B 有实质差异，必须重新请求批准。

## 6. Experiment 记录

```markdown
# E-001 横向误差精度

- ExperimentID: E-001
- Task: T-103
- Claim: I-001:C-01
- Protocol: P-001
- FrozenCommit: def5678
- ExperimentStatus: Completed
- ProtocolOutcome: Supported
- ResearcherVerification: Pending
- ResearcherNote: Pending review.

## Runs

- `R-20260816T073015Z-a7f2`

## Result

冻结判定规则得到 Supported。该值是协议结果，不代表研究者已经接受科学结论。

## Deviations

None.
```

研究者确认 Closeout 后，将 `ResearcherVerification` 改为 `Accepted` 或 `Disputed`，并写短
`ResearcherNote`。若 `ExperimentStatus: Invalid`，则 `ProtocolOutcome` 必须是
`NotEvaluated`，并在 Deviations 中说明原因。

## 7. FORMAL run.yaml

```yaml
run_id: R-20260816T073015Z-a7f2
task_id: T-103
experiment_id: E-001
protocol_id: P-001
claim_ids:
  - I-001:C-01
frozen_commit: def5678
command:
  - python3
  - tools/evaluate.py
  - --config
  - config/formal.yaml
output_dir: runs/T-103/R-20260816T073015Z-a7f2
environment:
  os: ubuntu-24.04
  python: 3.12.4
config: config/formal.yaml
data:
  uri: s3://example-research/path-error/v1/data.parquet
  sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
started_at_utc: 2026-08-16T07:30:15Z
```

真实记录还应按 Protocol 补齐容器、ROS、硬件或随机种子信息；不要把密钥写入 run.yaml。
