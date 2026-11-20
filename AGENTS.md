# 电商修图流开发规范

## 当前裁决与授权

- 产品名称：电商修图流（EcomRetouchFlow）；项目目录：`ecom-retouch-flow`；CLI：`retouch`（本地入口 `node src/cli.ts`）。
- 用户在 2026-11-14 已确认开始 M1–M2 实现，并明确宿主 Codex／ChatGPT 的图像能力优先，独立图像 API 作为 fallback。已授权本项目包配置、源码、测试、项目内依赖安装与隔离验证；不重复请求路线图确认。
- 当前正式入口为 `README.md`、`SKILL.md` 和 `docs/ROADMAP.md`。0.4.0 延续 ygl 原生封装并增加显式 API fallback；业务操作遵循 SKILL.md，当前架构见 `docs/ARCHITECTURE.md`。初始研究材料保留在本地 `docs/ai-native-cli/`，不作为公共运行依赖。
- 用户已明确授权通过 gh 创建本项目公开仓库、初始化 Git 并提交推送，归档不参与跟踪。软件发版、部署与实际 API 调用仍分别核对实际授权。
- 用户已要求解决 Issue #1 的强制项目／目标／任务／产物关联和 Issue #2 的完整 ZIP 上下文交换；开发实现、隔离验证、文档与仓库同步在当前任务范围内。不要将开发需求当作迁移真实业务数据或调用图像服务的授权。
- 最新架构裁决：产品底层是 ygl-trees CLI 的高级封装，禁止独立实现项目／任务账本、关系库、全局索引引擎或把 ygl 降为投影。0.2.0 独立账本仅作只读迁移来源和历史测试夹具；规范以 `docs/YGL-WRAPPER-MIGRATION.md` 与 `docs/ADR-004-dynamic-context.md` 为准，不因旧文档或历史测试通过继续扩展该分工。
- 后续产品方向为“动态上下文工程”，用户已选择所有登记工作区范围：标签更新、design/spec 引用、评分结语、二次分类与全局品味视图。2026-11-15 用户已确认“开始”，按原生封装与缺口 → 工作流／ZIP 迁移 → 动态上下文顺序自主实施；不再请求同一路线确认，未验收能力不报完成。
- 2026-11-15 用户补充本地草案E01–E07：先处理已有图片复核状态和关闭证据，再建设用途覆盖、多来源冲突、逐项保持、本地后处理和套图快照。E编号不等于GitHub编号；开发、隔离验证与既有仓库同步在范围内，不将本地草案冒称已提交的远端issue。本轮不自动读取图像服务配置或发起新图像调用。

## 目录与历史保全

- [README目录地图与写入门禁](README.md#项目目录定义与治理)是本项目唯一职责地图。本项目已明确要求目录治理零容忍：任何归属/职责/授权/保全/生命周期/消费者项为FAIL或UNKNOWN，停止依赖它的写入；不隐藏历史问题或靠地图改字假报通过。治理不授予删除、迁移、共享技能/宿主配置改动权限；宿主输出、历史包、Windows隐含根层缓存和未归属在途稿按README保持可见。旧有限例外不转当前许可，零容忍不等于自动清理历史。

- 根声明文件、各目录职责及新增对象准入仅按[README唯一目录地图](README.md#项目目录定义与治理)核对，本文件不维护第二份白名单。
- `archive/browser-extension/1.5.0-20261114/` 是冻结的原项目快照，包含插件代码、依赖、测试、历史文档及当时设计；不编辑、不安装依赖、不直接运行会向归档写入的测试。恢复方法见其父目录 README。
- 旧浏览器配置及此前被拒清理的临时对象保留在 `tmp/`，不清空、不换方式删除或移动。技能 junction 保留在 `.agents/`、`.dsh/`，不修改链接指向的技能副本。
- 临时输出只放 `tmp/<任务名>/`，由 `.gitignore` 排除；运行态仅放README声明且D1–D6已核通过的工具工作区，工具自称目录不构成例外；凭证不写入文件、argv、日志、ygl payload 或导出包。只读Shell/OS命令也可能产cache；调用前核支持入口、完整环境和隐含落点，只有TMP/TEMP不是全链合规。停止使用已发生异常的PowerShell进程诊断路径，不换Shell/包装器试跑。意外文件先原位保全，不用忽略规则/删除/搬移遮盖；只暂停受影响链及依赖交付，独立且获准的治理文档可继续。
- `docs/project-transition.json` 记录本机原路径、归档映射、原文件 hash 与校验结果，不提交 Git。历史回执中的路径是当时事实，不批量改写旧记录；公开范围见 `docs/ARCHIVE.md`。

## 架构与行为

- 复用 Agent 宿主和 ygl 原生 CLI。领域状态、任务、工件、关系和索引由 ygl 承载；retouch 负责电商 profile、命令编排、图像处理与上下文交换。原生缺口必须明确并通过原生 CLI／插件扩展解决，不能偷偷增加独立 ledger/catalog 或用 db sql 建影子业务系统。正常运行不得写旧独立账本，历史读取只用于明确的迁移／复核路径。
- 默认图像执行方式为 host：CLI 生成绑定输入的任务单，宿主用其实际可用的图像工具执行，再回接真实结果文件。离线提供商仅用于演示／测试；API fallback 需要明确选择与配置，不能因宿主工具缺失自动转为收费 API。
- API fallback 通过 `src/native/api.ts` 和原生插件的执行配置／意图／回执工作，不自建提供商账本。从显式环境变量，或经用户授权的当前 Codex 模型配置入口读取 base/key；不复制凭证到文件、argv、日志或原生事实。用户在本轮明确要求定位并复用当前 Codex 配置，不重复索要密钥，不扩展为其他工具凭证或自动付费探测。HTTPS 保持默认；私网 HTTP 须单独明确确认，不能通过伪装本机、隐式代理或关闭证书验证绕过。恢复不重发，真实服务和模拟验收分别报告。
- 需求文字非空且未停用即参与。保持用户原文与 Agent 解释的区别；后续步骤绑定明确的前序结果及坐标系。
- ygl unlock、rc0、提供商受理、收到图片、检查通过、人工接受和任务交付分别判断。质量未知或未运行不计通过。
- external/received 的有效输出与 workflow-run 的 API 待恢复 received 分别处理；图像任务仍须当前目标／需求、确切 hash 接受及实际交付。路径预检在交付准备意图前，发布阶段再次核对，已落准备事实的失败不得标成无副作用。`project check`／brief.business_health 补业务状态检查，原生 doctor/index 不代替业务完成验收。
- 商品事实由原生 product-facts spec 承载，字段绑定来源与精确摘录，视觉接受不提升规格；计划区分 concept/product-accurate，必要缺项可用明确保守方案处理。反馈保留原始 score/scale_max/原文/来源，未说明的下限或刻度为 null；统计按量表分组，不自动把 8/10 换算为 4/5。新语义由 ZIP required capabilities 保护。
- 用途、覆盖、冲突和保持项使用结构化原生spec/review；技术健康、内容PASS、UNKNOWN和NOT_EVALUATED分开。旧图重新采纳用独立result-revalidation，保留media原绑定并隔离旧接受；task close在同一事务内挂有效证据。后处理复用asset transform，字体与所有输入可追溯；套图选择以原生快照为权威，图片预览ZIP不是完整上下文包。详细契约见docs/ENGINEERING-CONTRACTS.md。
- 相同请求键重放已有事实；外部请求结果未知时先对账。补写 ygl 失败不能触发重新生成图片。
- 新任务须绑定明确业务项目、目标版本、交付物和完成条件。接手先读 project brief；外部候选、设计文档与实际生成分别记录。使用 `docs/PROJECT-CONTEXT.md` 中的真实接口迁移旧任务，不补造历史目标、授权或接受。
- 业务方案以关联项目／任务的原生 design/spec/citation 为正式入口；先读 brief.documents 和 artifact show，按 ID/version/hash 用 artifact revise 修订，历史用 artifact history。Markdown/ZIP 是显式可读／交换副本，不默认创建业务 docs/*.md，不靠文件名管理正式版本；源码仓库 docs 保存开发规范，不能据此强制业务副本目录。既有正文 v1/v2 字样不等于原生 version，不重复登记已有工件。
- ZIP 只交换完整项目的领域事实、关系和 CAS，先校验／预检再事务恢复，目标冲突不得静默覆盖。历史授权与当前执行权限隔离；同快照重导不回滚本地进度、不重发未知请求、不重新出图。
- 用户的计划授权、素材外发范围、费用上限和最终验收是独立事实；已授权范围内的普通开发与执行自主推进，不增加逐步确认。

## 验证入口

- 业务 CLI：`node src/cli.ts`；类型检查：`npm run typecheck`；完整原生测试：`node scripts/test.mjs --ygl-entry <实际安装入口>`；历史夹具回归显式 `--legacy`；独立原生演示：`node scripts/demo.mjs --ygl-entry <实际安装入口>`。Windows PowerShell 使用 Node 入口传递参数，不依赖 npm.ps1 转发。
- 当前实际命令与协议以 `docs/CLI.md`、`docs/HOST-EXECUTOR.md` 和 CLI help 为准。宿主执行以 actual tool availability 为前提，dispatch 的 replayed 响应不能触发第二次出图。保持区采用批准矩形内合成，再对实际候选做视觉检查。
- 每次完整测试保存不可变运行报告与最新索引到 `docs/verification/`；原生集成、离线图像处理、宿主协议夹具、真实 AI 质量分别报告。单元测试显式 `--unit-only`，不把它写成原生集成已通过。
- 试点问题专项入口为 `node scripts/test.mjs --suite issues --ygl-entry <入口>`；#7 文档归档回放同时在 documents 套件验收。完整测试仍包含全部 native 场景，不用定向结果代替完整回归。
- E01–E07专项入口为 `node scripts/test.mjs --suite engineering --ygl-entry <入口>`；完整回归还要求该专项证据通过。字体测试使用RETOUCH_TEST_FONT显式指定TTF/OTF，Windows默认从WINDIR/Fonts读取Arial；不安装字体或静默替换。原草案的缺陷复现脚本不充当修复验收。

- 本机另保留初始设计校验与探针工具 `scripts/validate-retouch-design.mjs`、`scripts/explore-retouch-ygl.mjs`；它们和所需原生记录、归档基线不随公开仓库发布。仅在这些本地材料实际存在且当前任务需要时使用，不把它们作为公共构建或测试前提。
- 本机设计记录使用独立 home `~/.ygl-trees/workspaces/retouch-cli-design`。项目更名只更新其归属 marker，保留原 project/tree/task ID；不改默认库、全局安装或共享 ygl 检出。
- 实现阶段补充有意义的领域、CLI、图像与 ygl 集成测试；真实调用独立 opt-in。按实际 JSON、退出码、文件和人工结论报告 PASS、FAIL、UNKNOWN、NOT_RUN。
- 收尾检查正式入口、受影响的引用、归档完整性和临时物去向；不把技术通过等同于发布授权。

## Agent Atelier

项目业务技能由根 `SKILL.md` 的唯一正文与 `.agents/skills/ecom-retouch-flow/SKILL.md` 的发现指针提供。演化优先修订现有技能，目录D1–D6是开工前置；格式、加载、实际行为、独立泛化与收益分别取证，升版或软件PASS不等于技能生效/有收益。当前环境另有 Agent Atelier 时，继续按其可见规范处理产物与开发决策；本机技能 junction 不随仓库发布，不要求其他使用者安装它。用户当前裁决优先，不从技能自动推导额外权限。
