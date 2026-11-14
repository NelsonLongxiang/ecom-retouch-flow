# 真实使用反馈 Issue 索引

仓库：NelsonLongxiang/ecom-retouch-flow。记录日期：2026-11-14。

| GitHub Issue | 本地正文 | 关系与状态 |
| --- | --- | --- |
| #1 强制建立项目—目标—任务—产物关联与索引规范 | [Issue 正文](mandatory-project-context-and-index-relations.md) | 0.3.0 原生项目／任务／步骤／关系与真实进度已实现并通过隔离复验 |
| #2 支持以 ZIP 压缩包导出和导入完整项目上下文 | [Issue 正文](zip-context-export-import.md) | 0.3.0 原生 v2 ZIP、只读 legacy 迁移、事务恢复、幂等／clone 与历史授权隔离已通过 |

此索引只管理产品开发反馈，不替代用户业务项目的任务、产物及验收状态。两项能力的完成情况以实现、测试和对应 Issue 状态为准。

实现与操作见 [项目上下文](../PROJECT-CONTEXT.md)，最新决策见 [ADR-004](../ADR-004-dynamic-context.md)，原生 6 个场景及历史 42 项的范围与复现见 [验证摘要](../verification/README.md)。保留原始提报正文作为需求来源；其中“拟议／尚未实现”描述的是提报时状态。远端 Issue 状态在实现提交推送后同步，真实业务项目与真实图像质量不因技术验收自动完成。

用户最新架构裁决替代原始提报中的“独立 SQLite 为权威”描述。后续事实应由 ygl CLI 及其原生扩展承载，不能把 ygl 仅作为投影；当前迁移与完成标准见 [原生封装规范](../YGL-WRAPPER-MIGRATION.md)。
