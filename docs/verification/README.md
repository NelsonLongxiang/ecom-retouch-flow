# 验证与复现

0.4.0 的正常入口仍为 ygl 原生封装，新增显式 API fallback。验证使用 Windows、Node 24.12.0、ygl-trees 0.125.0、项目 tmp 中的隔离 home 和本机 HTTP 模拟服务；不访问默认业务库、不部署共享插件、不调用真实模型或收费 API。

```text
npm ci
npm run typecheck
node scripts/test.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite api --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite documents --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/demo.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
```

默认测试为 `native-*.test.ts`，包含原生基础 6 个场景、API 的 3 个场景和原生文档闭环 1 个场景（每个完整流程内包含多项断言）。历史 0.2.0 的 42 项通过 `node scripts/test.mjs --legacy --ygl-entry <入口>` 单独复现；它只验证历史夹具与迁移来源，不充当新架构验收。

0.3.0 历史基线为原生 6/6、历史 42/42 与两步演示通过。0.4.0 的当前结果以本轮 native-wrapper-tests.json 与 api-tests.json 的实际 verdict／源码指纹为准，不以旧报告代替。真实 AI 图像／收费 API 为 NOT_RUN。

2026-11-15 API fallback 基线为 9/9 场景 PASS，零跳过；类型检查 PASS。API 模拟服务共观察到 11 次明确的 POST、零次重定向跟随；重放、恢复、迟到回接和克隆恢复不增加 API 请求。新增文档闭环的结果以当前完整报告和 documents-tests.json 为准；历史 42 项基线不冒充本轮重新执行。

2026-11-15 原生文档整改的最终完整回归为 10/10 PASS，零失败、零取消、零跳过，类型检查 PASS。覆盖同名 citation 独立固定、目标旧绑定保留、原生修订和导出副本、受保护内容拒绝导出、ZIP 历史与真实任务状态恢复；证据随完整报告保存。早期定向报告的源码指纹可能较旧，应以最终完整报告核验当前实现。

| 原生验收范围 | 实际检查 |
| --- | --- |
| 架构 | 对比初始化与业务操作后的真实原生表清单，确认没有新表及 ledger.sqlite |
| 原生业务 | project/spec/task/design/media/rel 与接手摘要；幂等建任务，异意图冲突 |
| 工作流 | 原生步骤节点、顺序依赖、每次运行的检查状态、原生事件时间线；派发重放无二次执行权限 |
| 进度与图片 | 高清候选未验收、方案文档未冒充出图；200→1254→2048 实际夹具字节、尺寸及派生 |
| 实际合成 | 只改变批准矩形的像素，区域外不变；并发派发至多一次获得执行权限 |
| ZIP | 一致性快照、完整清单／素材、hash／尺寸、原子发布、不覆盖已有目标、事务冲突回滚 |
| 恢复 | 身份／任务／实际进度保留，同包重导不回滚后续反馈；历史授权无效，新授权后恢复交付 |
| clone | 身份与原生图引用重映射，来源映射保存为原生工件；引用来源身份保持原样 |
| legacy | 源只读、预检零业务写入、源字节 hash 不变、明确映射、原生目标及再导出恢复 |
| unknown | 原请求待对账状态保留，需求或目标变化不能使未知请求消失 |
| 动态上下文 | 登记范围、恢复副本去重、分歧／唯一权威、缺评分不填零、分类与反馈视图 |
| 引用 | 真实 design/spec、精确版本/hash、本地正文、源更新 stale、工作区失联 unavailable |
| 原生文档 | brief 当前入口、按 ID/version/hash 修订、旧版／异 hash 拒绝、幂等、任务及依赖需复核、原生节点重新锁定；引用不变、旧检索标记、Markdown 副本无覆盖／回写、ZIP 历史恢复与重导 |
| 输入边界 | 标签、参数、凭证字段、畸形清单、跨项目和悬空关系；共用 ZIP 读取器的路径／链接／碰撞／大小限制另由历史回归覆盖 |
| API fallback | 明确配置／授权、真实本机 multipart 图片与透明 mask、用途明确的参考图、每份授权的请求次数限制 |
| API 故障 | 重放／并发单次提交，超时／重定向／URL 响应／大小限制保留未知，明确拒绝保留失败及去敏代码 |
| API 恢复 | 原始尺寸保全、显式本地缩放、迟到结果幂等回接、原生接收回执故障、clone 回执隔离；均不再次请求图像 |

最新完整报告在本地 `docs/verification/native-wrapper-tests.json`，API 定向报告为 api-tests.json，文档定向报告为 documents-tests.json，不可变报告在 `docs/verification/runs/`；包括实际退出码、TAP 计数、源码 hash、架构标识和原生证据。完整 PASS 要求零失败、零取消、零跳过，且 wrapper、文档与 API 本机模拟证据都 PASS；定向套件不代替完整回归。`--unit-only` 明确标记原生集成 NOT_RUN。

演示工具通过原生工作流处理两张本地夹具图片并交付 PNG/manifest，报告在 `offline-demo.json`。[演示对照图](../demo/offline-workflow.png) 展示原图、第一步及第二步实际结果，不能作为 AI 商品图效果或用户满意度证明。

这些报告含本机运行路径，不参与 Git 跟踪；公开摘要以对应提交的实际测试报告为依据。真实宿主 AI 端到端、真实商品语义质量、独立 API、PG、完整系统断电矩阵和恶意同 OS Agent 沙箱未据这些测试宣称通过。
