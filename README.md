# 电商修图流 · EcomRetouchFlow

以 ygl-trees CLI 为底座的电商修图与动态上下文工作流。用户描述商品图的目标和保持项，Agent 组织需求、编排步骤、调用实际可用的宿主图像工具，再检查、交付并沉淀可复用经验。

0.3.0 将正常入口切换到 **ygl 原生项目、任务、工件、节点、关系与事件**。本项目的 ygl 用户插件补齐事务、请求幂等、元数据更新与项目恢复，使用既有原生表和事务服务；没有另一个业务账本、catalog、outbox 或检索数据库。当前验收对象为 ygl-trees **0.125.0**，不修改共享安装。

0.4.0 增加显式图像 API fallback：执行配置、素材外发／费用确认、按授权限定请求次数、唯一调用意图、原始响应保全、迟到结果对账和无需重发的本地恢复。仍优先使用实际宿主图像工具，API 不会自动启用。配置和示例见 [API fallback](docs/API-FALLBACK.md)。

```text
npm ci
node src/cli.ts --help --json
node src/cli.ts workspace init <空业务目录> --ygl-entry <ygl/dist/bundle/bin.cjs> --json
node scripts/demo.mjs --ygl-entry <ygl/dist/bundle/bin.cjs>
npm run typecheck
node scripts/test.mjs --ygl-entry <ygl/dist/bundle/bin.cjs>
```

业务工作区与源码分开。初始化只向明确的新工作区安装本项目原生扩展；不会部署到默认 ygl home。正式读写均经 `retouch → ygl CLI → 原生插件/原生命令`。也可以直接用 ygl 的 project/task/produce/rel/node 命令查看这些实体。

方案、规格和来源分别保存在关联项目／任务的原生 design/spec/citation。接手从 brief.documents 定位，artifact show/history 读取与追溯，artifact revise 按原生 ID、版本/hash 修订。Markdown 只由 artifact export 显式生成副本，ZIP 用于交换；业务正式版本不由 docs 或 v1/v2.md 文件名决定。操作见 [原生文档](docs/CLI.md#原生文档与导出)。

试点补齐业务健康检查、交付预检与恢复、字段事实和概念／实物用途、请求／原生／导出尺寸链、原始评分量表，以及经授权的当前 Codex 配置复用和显式私网 HTTP 接入。所有事实仍在 ygl 原生工件中；诊断不自动发起图像请求。契约、示例和隔离验证见 [试点问题验收](docs/ISSUE-ACCEPTANCE.md)。

- 需求按部位分组，每组独立补充文字；文字非空且未停用即参与。
- 目标使用原生 spec，步骤绑定明确顺序、依赖、输入和坐标系；检查通过才进入下一步。
- 默认由宿主 Codex／ChatGPT 的实际图像工具执行；独立 API fallback 仅在明确配置、批准并执行 `run execute-api` 时调用。
- 未知请求保持未知，同请求键返回已有回执；重放派发结果不能授权第二次出图。
- 原图、模型原生结果、后处理和候选分别保留实际字节、尺寸、hash 与派生关系。
- 完整项目 ZIP 包含原生上下文、关系、回执、接手摘要和必要素材；预检后事务恢复，重复导入不回滚后续进度。
- 项目标签、评分、结语与完结记录可更新。跨所有登记工作区检索、引用 design/spec，按不同项目数展示标签频率、二次分类、共现和评分视图；恢复副本去重，分歧明确报告。

让 Agent 使用 [SKILL.md](SKILL.md)；参数及 JSON 示例见 [CLI](docs/CLI.md)，真实图像交接见 [宿主协议](docs/HOST-EXECUTOR.md)，架构边界见 [架构](docs/ARCHITECTURE.md)。[动态上下文规范](docs/DYNAMIC-CONTEXT.md) 区分已实现的检索分析与仍由宿主 Agent 完成的专业解释。

[购买决策叙事](docs/NARRATIVE-WORKFLOW.md) 补充参考/事实→买家矩阵与整套低成本分镜→风险代表样张→制作的顺序，以及商品动作对象、物理图文与职责适用反例检查；它是业务方法，不是CLI自动看图或真实视觉验收。

[工程流程契约](docs/ENGINEERING-CONTRACTS.md) 提供用途与内容覆盖、多来源冲突、旧图重新采纳、逐项商品保持、原生本地变换和套图快照。接手能看到“已有结果待复核”，套图支持部分接受、完整/增量图片包；真实观察、未知、用户接受和技术状态分别保存。

旧 0.2.0 账本和 v1 ZIP 仅通过 `legacy inspect/migrate` 只读读取，迁入新建隔离工作区；不自动修改真实用户数据。原生 v2 ZIP 不静默接受旧格式。操作和限制见 [项目上下文](docs/PROJECT-CONTEXT.md)。

自动化回归使用真实 ygl CLI 与本地图片夹具；2026-11-16前一冻结开发候选的完整结果为33/33 PASS、零失败/取消/跳过，67份源码/测试/配置指纹起止一致。继续轮a7dd34d的37项独立全量通过，但额外seal后当前性对抗FAIL另行保留；已按用户确认首版仅reject、5000万聚合计划像素及组件目录语义修复，现41项新候选须重新验证，不能由旧33/37项推断；#13窄修复独立完整29/29 PASS；#11/#12叙事与快照输出增量通过完整回归，但两条PR仍待独立复验及合并授权，不作已上线能力或真实商品质量验收。2026-11-15 另经用户明确授权，使用合成素材完成一次 `gpt-image-2` 原生 API 调用，实际返回 1254×1254 PNG，并验证原生状态可独立接手；商品图质量与用户接受仍单独判断。E01–E07开发验证未新增真实图像调用。证据和范围见 [验证](docs/verification/README.md)。历史42项回归通过 `--legacy` 显式运行，不充当原生架构验收。

MIT License。原浏览器插件冻结于本地 `archive/`，归档、业务运行状态、凭证与机器验证记录不参与 Git 跟踪。
