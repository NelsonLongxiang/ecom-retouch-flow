# 0.4.0 实现与验证

产品正常入口已切换到 ygl 原生封装。代码与职责见 [架构](ARCHITECTURE.md)，业务操作见 [CLI](CLI.md) 与 [技能](../SKILL.md)。

`src/native/client.ts` 校验明确的发行包及原生事务 API 指纹，隔离 home/session，清除继承的凭证和隐式项目选择，严格检查退出码与完整 JSON。插件位于 `src/native/plugin/`，通过 ygl 原生事务服务写入既有项目、工件、节点、关系和事件；原生索引也由引擎计算。

`files.ts` 保存实际内容寻址字节、解码尺寸、局部合成、显式后处理和不可覆盖的交付。`exchange.ts` 封装有边界的 ZIP 与原生事务导入。`context.ts` 查询登记工作区，派生标签／分类／反馈视图，检索并保全精确引用。`legacy.ts` 只读读取旧库／旧包，生成可审阅映射并仅迁入新建目标。

原生插件提供文档当前入口、正文、历史和按 ID/version/hash 的事务修订；沿用 ygl 工件 version 与 superseded-by，任务及下游待复核且默认任务节点重新锁定。目标绑定和引用边保留确切旧版本，显式复核后才切换。`documents.ts` 仅生成带来源元数据的可读副本，不另建文档库或把 Markdown 当正式写入入口。

试点契约的字段事实、量表与尺寸派生函数在原生插件模块中复用，落点仍为 spec/profile/media/execution 等既有工件。`configuration.ts` 只在显式授权下读取当前 Codex 配置，使用固定版本 TOML 解析器，不复制配置正文或凭证；私网 HTTP 策略和本地 workspace/provider 绑定在原生 executor-profile 中。交付在准备前预检，准备后的 IO 失败有真实副作用状态和恢复／放弃入口。专项测试为 --suite issues，真实服务验收独立。

E01–E07由plugin/applicability、flow-contracts、flow-commands以及native/fonts、postprocess、suite承载，复用既有原生事务与CAS。覆盖/保持项绑定当前规范、图片hash和上下文；结果重新采纳不修改旧media；任务关闭事务挂证据。本地变换记录渲染/字体与全部输入，套图导出从原生快照派生总览和图片包。E01–E07历史基线完整回归22/22 PASS并校验起止源码稳定，专项证据纳入完整PASS门槛；本轮未新增真实图像调用。接口见 [工程契约](ENGINEERING-CONTRACTS.md)。

`api.ts` 编排显式 API 传输，原生插件校验 profile、计划、授权、请求上限与唯一意图；PNG／mask／参考职责及完整提示词可追溯。使用平台 fetch，不自动重试或跟随重定向。HTTP 模拟验证真实 multipart 与本地图像字节，包含超时、迟到结果、回执故障及 clone 恢复；不调用真实收费模型。故障时先恢复原生已保存事实，不能靠重新请求补记录。

Issue #11补购买决策矩阵/分镜与返图观察方法，正文仍在原生design/spec、结论仍用已有review；不实现自动看图。Issue #12的output-profile/outputs复用postprocess、原生delivery与CAS，有限extend/encode与slot配置生成比例PNG、sRGB JPEG/长图/阅读组件。旧suite ZIP模式保留；新目录模式组件独占发布、完成标记最后写入并按准备事实恢复，不假称多文件事务原子性。新上下文能力retouch-suite-output/v1保护profile与encode/extend，clone重绑原生引用并把外部成品保留为历史未授权路径。首版用户裁定仅reject且输入+全部计划派生合计5000万像素，prepare/分配前拒绝而非RSS保证；seal后和各组件/marker前复用只读原生门禁，marker仅冻结字节完整，当前业务接受另核。

测试区分原生架构集成、本地协议图片夹具和 0.2.0 历史回归。默认测试只运行 `native-*.test.ts`；历史回归显式 `--legacy`，旧 CLI 也只在该夹具环境可执行。两者不混为一种验收。报告及复现见 [验证说明](verification/README.md)。

真实 AI 图像生成、真实商品质量、费用核算和生产安全沙箱均未由本次夹具测试证明。既有默认 ygl 数据、浏览器插件归档及共享检出保持原状。
