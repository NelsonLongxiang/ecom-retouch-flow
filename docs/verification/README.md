# 验证与复现

0.4.0 的正常入口仍为 ygl 原生封装，新增显式 API fallback。自动化回归使用 Windows、Node 24.12.0、ygl-trees 0.125.0、项目 tmp 中的隔离 home 和本机 HTTP 模拟服务；不访问默认业务库、不部署共享插件、不调用真实模型或收费 API。另有用户明确授权的一次真实服务验收，结果单独记录如下。

```text
npm ci
npm run typecheck
node scripts/test.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite api --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite documents --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite issues --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite engineering --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite zip --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite outputs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/demo.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
```

默认测试为 `native-*.test.ts`，包含原生基础6个场景、API的3个场景、原生文档闭环1个场景、试点问题7个场景和E01–E07工程契约5个场景（每个完整流程内包含多项断言）。历史0.2.0的42项通过 `node scripts/test.mjs --legacy --ygl-entry <入口>` 单独复现；它只验证历史夹具与迁移来源，不充当新架构验收。

0.3.0 历史基线为原生 6/6、历史 42/42 与两步演示通过。0.4.0 的当前结果以本轮 native-wrapper-tests.json 与 api-tests.json 的实际 verdict／源码指纹为准，不以旧报告代替。这些自动化报告中的真实 AI 图像／收费 API 为 NOT_RUN，实调报告另列。

2026-11-15 API fallback 基线为 9/9 场景 PASS，零跳过；类型检查 PASS。API 模拟服务共观察到 11 次明确的 POST、零次重定向跟随；重放、恢复、迟到回接和克隆恢复不增加 API 请求。新增文档闭环的结果以当前完整报告和 documents-tests.json 为准；历史 42 项基线不冒充本轮重新执行。

2026-11-15 原生文档整改的最终完整回归为 10/10 PASS，零失败、零取消、零跳过，类型检查 PASS。覆盖同名 citation 独立固定、目标旧绑定保留、原生修订和导出副本、受保护内容拒绝导出、ZIP 历史与真实任务状态恢复；证据随完整报告保存。早期定向报告的源码指纹可能较旧，应以最终完整报告核验当前实现。

2026-11-15 试点问题 #3–#10 的最终完整隔离回归为 17/17 PASS，零失败／取消／跳过，类型检查 PASS。包含已确认规格值的实际提示词绑定、同名旧副本归档映射、原始8/10与旧4/5的分组、Codex受保护来源、私网HTTP字面地址边界、模拟服务忽略size、交付中断恢复及external/workflow received区分。真实试点20张图片另以只读 CAS hash／实际解码复核，观察到200输入、1254原生结果及2048后处理，新增请求为0；不将这些旧结果冒充新通道的实调验收。

2026-11-15 E01–E07的最终完整回归为 **22/22 PASS**，零失败／取消／跳过，类型检查PASS；运行前后60份源码/测试/配置快照一致，source_stability=PASS。新增5个工程场景覆盖7份本地草案，包含目标与需求同时改变后的旧图采纳、新增必检项后的收口拦截、样张内容门槛、冲突回读、像素修补与9图/2图包。两处SKILL入口校验通过，CLI help可发现16个新增命令。本轮0次真实图像请求，隔离语义夹具不代表商品质量验收。

2026-11-15 另经用户明确确认私网 HTTP 传输、素材外发与费用后，使用当前已选服务完成一次 `gpt-image-2` 原生通道实调：executor-profile → 冻结计划 → host-human 授权（最多1次）→ run execute-api → 原始图片保全。输入为256×256合成蓝色方块，size=auto，实际返回1254×1254 PNG（1,063,381字节）；CAS SHA-256 与实际解码尺寸一致。一次请求、零自动重试，重新打开工作区后能从 brief 与原生工件独立接手，business_health=PASS。执行保持 waiting_for_review，未代填用户接受、交付或项目完结。完整本地证据为 service-live.json；公开摘要不含服务地址或凭证。

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
| 试点状态 | external/received 可经真实接受／交付收口；unknown/dispatched 与 workflow received 继续保护；业务健康可发现已关闭但仍有未知执行 |
| 交付故障 | 无效路径零 preparing、目录链接／冲突拒绝、图片已写而清单中断后的同键恢复；准备后变更路径报告 committed 并可显式处置 |
| 受保护配置 | Codex 配置读取须授权、provider/workspace 绑定；不复制密钥、不复用 OAuth，不自动付费探测；公共 HTTP 与伪私网域名拒绝 |
| 商品事实 | 200px／缺表头／AI补绘与视觉接受不提升规格；概念／实物门槛、闭合抽屉、必要字段的值／单位／对象进入实际提示词、ZIP/clone 保全 |
| 原始评分 | 8/10 与旧4/5 各自保留，未知下限／刻度为 null；分组均分、有效评分分母、恢复去重、缺能力声明拒绝 |
| E03/E07 | 目标和需求均变化后显式复用旧hash，不继承旧接受/交付；并发revision、unknown保护；图像/设计关闭事务挂有效证据，doctor.node_evidence通过 |
| E01/E02 | 七图不计用途覆盖；逐项FAIL/UNKNOWN；样张缺内容时拦截后续dispatch；用户直接扩套原文；冲突回读、创作/事实区分、局部任务失效与ZIP恢复 |
| E04 | 必检FAIL/UNKNOWN不能被总体PASS绕过；修正保留旧图；已经交付但新增必检项后仍不能直接关闭任务 |
| E05 | 实际像素只变批准矩形、透明孔洞、多输入与字体CAS、含&及尖括号的文字；越界/拉伸/缺字体诊断、2048独立后处理、重放和ZIP恢复 |
| E06 | 7图替换2张再扩9图，旧快照可读；部分接受不升级整套；同快照9图/新增2图包、总览与hash一致，跨项目拒绝、预览不可作为工作区导入 |

最新完整报告在本地 `docs/verification/native-wrapper-tests.json`，API／文档／试点定向报告分别为 api-tests.json、documents-tests.json、issues-tests.json，不可变报告在 `docs/verification/runs/`；包括实际退出码、TAP 计数、源码 hash、架构标识和原生证据。完整 PASS 要求零失败、零取消、零跳过，且 wrapper、文档、试点与 API 本机模拟证据都 PASS；定向套件不代替完整回归。真实图片尺寸复核在 real-dimensions.json，服务实调另列独立报告；`--unit-only` 明确标记原生集成 NOT_RUN。

E01–E07专项报告为engineering-tests.json，完整PASS还要求native_engineering_evidence=PASS。测试入口输出逐项进度并比较运行前后源码指纹，source_stability不为PASS时不作为最终验收；仍以最新完整报告的源码指纹为准，不拿早期专项或中间运行代替最终结果。文字测试使用RETOUCH_TEST_FONT，Windows默认WINDIR/Fonts/arial.ttf；缺少字体时明确失败，不安装或静默替换字体。隔离检查的语义结论是明确的测试输入，不冒充真实商品用途或结构已通过视觉验收。

演示工具通过原生工作流处理两张本地夹具图片并交付 PNG/manifest，报告在 `offline-demo.json`。[演示对照图](../demo/offline-workflow.png) 展示原图、第一步及第二步实际结果，不能作为 AI 商品图效果或用户满意度证明。

这些报告含本机运行路径，不参与 Git 跟踪；公开摘要以对应提交的实际测试报告为依据。真实宿主 AI 端到端、真实商品语义质量、其他服务兼容性、PG、完整系统断电矩阵和恶意同 OS Agent 沙箱未据这些测试宣称通过。

## Issue #13 · ZIP 预检和写入副作用

`--suite zip` 是低层 ZIP 与原生 suite/context 导出的专项入口，报告为本机 `zip-tests.json`；完整回归同样执行这些场景并要求 `native_zip_evidence=PASS`。不需要真实业务图片、服务配置或图像请求。

写入器先检查全部路径、大小写碰撞、条目数量、单项和解压总量，再以 `wx` 创建输出。纯预检失败为 `effectStatus=none`，新目标不存在，已有目标不修改；打开后 IO 中断保留可检查的部分文件，错误保留 IO code，并标 `effectStatus=committed`、`details.partial_file` 和实际 `bytes_written`。它不负责把低层目标当成已验证正式包，不删除已有用户文件。

专项包含正常/空包往返、晚出现的非法条目、保留名/规范字符、已有文件与硬链接保全、读端路径/链接/碰撞/数量/大小/压缩比保护。故障注入先向真实暂存文件写入前缀再返回 EIO，验证部分 IO 与未打开路径错误有别；原生 suite/context 的暂存清理、未发布正式目标、目标目录链接、同键恢复/重导及冲突保全分别验证。软件复验通过不代表真实商品视觉或用户接受。

## Issues #11/#12 · 叙事交接与有限输出

`--suite outputs` 包含原生design矩阵/分镜独立接手、明确夹具观察的FAIL/UNKNOWN和交付拦截，以及两种页数/比例配置、实际2400方形JPEG的sRGB ICC/contain、整页长图、重放/局部替换复用、显式裁切、过期媒体、原生ZIP/clone和能力声明。实际超过32MiB的随机像素长PNG分别验证reject与split、外部组件hash和丢组件拒绝，context不能静默省略超限CAS。

专项报告为outputs-tests.json，完整PASS还须native_output_evidence与native_output_large_evidence均PASS。临时目录在本项目/隔离工作区tmp，故障/中间失败报告保全，不把原#13的29项旧PASS冒充新增特性的完整验证。真实视觉、独立盲复核、真实用户接受、图像服务及生产部署均另列，未由语义fixture或导出成功证明。
