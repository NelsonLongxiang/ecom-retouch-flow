# 真实使用反馈 Issue 索引

仓库：NelsonLongxiang/ecom-retouch-flow。记录日期：2026-11-14。

| GitHub Issue | 本地正文 | 关系与状态 |
| --- | --- | --- |
| #1 强制建立项目—目标—任务—产物关联与索引规范 | [Issue 正文](mandatory-project-context-and-index-relations.md) | 0.2.0 旧实现通过；按最新 ygl 高级封装约束重开，待原生承载迁移复验 |
| #2 支持以 ZIP 压缩包导出和导入完整项目上下文 | [Issue 正文](zip-context-export-import.md) | 旧 ZIP 往返通过；按原生实体／身份／恢复契约重开复验 |

此索引只管理产品开发反馈，不替代用户业务项目的任务、产物及验收状态。两项能力的完成情况以实现、测试和对应 Issue 状态为准。

实现与操作见 [项目上下文](../PROJECT-CONTEXT.md)，决策见 [ADR-003](../ADR-003-project-context-zip.md)，42 项通过的范围与复现见 [验证摘要](../verification/README.md)。保留下述原始提报正文作为需求来源；其中“拟议／尚未实现”描述的是提报时状态。

用户最新架构裁决替代原始提报中的“独立 SQLite 为权威”描述。后续事实应由 ygl CLI 及其原生扩展承载，不能把 ygl 仅作为投影；当前迁移与完成标准见 [原生封装规范](../YGL-WRAPPER-MIGRATION.md)。
