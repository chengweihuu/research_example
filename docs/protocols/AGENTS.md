# Protocols 目录准入

## 用途

这里只保存准备进入 `FORMAL` 的冻结验证协议和跨实验复用的数据合同。协议回答“怎样验证”，
不保存运行结果。

## 准入

协议应明确研究主张、输入数据、对照组、指标、成功判据、停止条件和复现要求。协议
冻结后如需改变这些内容，应先确认其是否改变科学主张，再更新版本或建立新的实验。

每份协议命名为 `P-NNN_short_name.md`，并在开头声明：

```markdown
Protocol ID: P-001
Idea ID: I-001
Claim IDs: I-001:C-01
Status: Frozen
```

Protocol 状态使用 `Draft`、`Frozen`、`Retired`。协议定义“怎样验证”，不保存运行结果；
对应 Experiment 由 Idea 的 Evidence Map 建立入口。

协议冻结后开始的 Experiment 无论结果是否有利都必须留下记录。改变指标、判定规则、
排除条件或数据范围前，应创建新版本或新的 Protocol，不覆盖原冻结条件。

## 禁止

- 普通 `EXPLORE` 计划、运行日志和结果不进入本目录。
- 冻结后不得直接覆盖指标、判定规则、排除条件或数据范围。

## 生命周期

协议先处于 `Draft`，确认后变为 `Frozen`；实质变更应升级版本或建立新 Protocol。停止
使用的协议标记为 `Retired`，原记录仍保留。
