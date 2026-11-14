# 原生封装架构（0.3.0）

正常写入路径是 `src/cli.ts → src/native/client.ts → ygl CLI retouch-native → 本项目用户插件 → ygl 原生事务服务`。原生插件位于 `src/native/plugin/`，固定验收 ygl 0.125.0；通过该发行包的 `getOrm/runTx/logEvent` 写入既有实体。没有自建表、第二个数据库、outbox 或独立索引；完整测试比较初始化前后的实际 SQLite 表清单。

| 业务概念 | ygl 原生承载 |
| --- | --- |
| 业务项目 | projects；身份直接用于恢复去重 |
| 项目 profile／反馈版本 | artifacts(kind=profile) 的原生 version、superseded-by 与 project 节点指针 |
| 有效标签 | project 节点 tags；原文与来源在 profile |
| 目标、计划、设计 | spec/design 工件；明确 role、任务／目标和来源 |
| 任务与顺序依赖 | 原生 task 工件、任务／步骤节点及 node_edges；原生闭包／拓扑索引；node_state 按运行隔离检查状态 |
| 原图、输出、后处理、候选 | media 工件元数据 + 不可变文件；原生 uses/produced/derived-from |
| 授权、执行、检查、交付 | authorization/execution/review/delivery 工件及原生关系 |
| 请求幂等与审计 | 业务写入同一事务中的原生 events；相同键异意图拒绝 |
| 工作区身份及登记 | 原生 meta 的工具配置键，不存跨项目业务副本 |
| 引用与分析方法 | citation/methodology 工件；引用正文可携带 |
| 全局视图 | 显式查询登记 home 的原生数据，内存派生、随用随算 |

原生版本和关系是依据。retouch 不拦截普通 ygl 命令，也不能保证同一 OS 身份下的恶意 Agent 无法伪造业务记录。事务回执和授权校验负责正确编排，不是独立安全沙箱。

`workspace.json` 只保存本机 ygl 入口、发行包指纹与工作区绑定；业务事实均在 `<workspace>/ygl/ygl-trees.db`。`objects/sha256/` 存文件字节，`tmp/native-requests/` 是调用请求文件，调用后移除；删除临时文件不影响接手。独立 home 不继承全局 project/tree/PG 或凭证配置。

宿主执行前原子记录 dispatched，随后由宿主调用实际工具。CLI 不自动调用图像服务。重放返回历史回执，产品入口强制 `allow_execute:false`；进程中断或工具结果不明时不能自动重发。收到图片、视觉检查、用户接受和交付分别落原生事实。恢复包中的授权始终不能激活目标工作区，新授权不清除未知请求。

ZIP v2 保存一个闭合的原生项目图、原生业务事件、接手摘要及必要文件。导入先校验 schema、hash、关系和实际尺寸，再使用原生事务写入所有事实并重建原生索引；文件先按内容寻址落地，事务失败最多留下未引用字节。同包再次导入读取原生回执，不覆盖后来进度。新快照与现有同身份项目冲突时拒绝覆盖；clone 显式重映射身份并记录来源。

目前原生交换覆盖本项目拥有的 project/tree/node/artifact/rel/event。检测到未纳入该闭合图的额外 research source/claim/query 或外部关系时明确拒绝导出，不静默丢失。PG 未验收，扩展明确拒绝，不自动回落 SQLite。

0.2.0 的 `src/application/`、旧 `Store` 和旧 adapter 保留为历史复核／只读迁移支撑；正式 CLI 不导入旧业务写入路径。`src/native/legacy.ts` 以 readOnly 打开旧库，迁入新的隔离目标；旧 CLI 仅允许显式历史测试环境。历史架构决定由 [ADR-004](ADR-004-dynamic-context.md) 替代。
