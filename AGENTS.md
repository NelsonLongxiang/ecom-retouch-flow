# 电商修图流开发规范

## 当前裁决与授权

- 产品名称：电商修图流（EcomRetouchFlow）；项目目录：`ecom-retouch-flow`；CLI：`retouch`（本地入口 `node src/cli.ts`）。
- 用户在 2026-11-14 已确认开始 M1–M2 实现，并明确宿主 Codex／ChatGPT 的图像能力优先，独立图像 API 作为 fallback。已授权本项目包配置、源码、测试、项目内依赖安装与隔离验证；不重复请求路线图确认。
- 当前正式入口为 `README.md`、`SKILL.md` 和 `docs/ROADMAP.md`。0.4.0 延续 ygl 原生封装并增加显式 API fallback；业务操作遵循 SKILL.md，当前架构见 `docs/ARCHITECTURE.md`。初始研究材料保留在本地 `docs/ai-native-cli/`，不作为公共运行依赖。
- 用户已明确授权通过 gh 创建本项目公开仓库、初始化 Git 并提交推送，归档不参与跟踪。软件发版、部署与实际 API 调用仍分别核对实际授权。
- 用户已要求解决 Issue #1 的强制项目／目标／任务／产物关联和 Issue #2 的完整 ZIP 上下文交换；开发实现、隔离验证、文档与仓库同步在当前任务范围内。不要将开发需求当作迁移真实业务数据或调用图像服务的授权。
- 最新架构裁决：产品底层是 ygl-trees CLI 的高级封装，禁止独立实现项目／任务账本、关系库、全局索引引擎或把 ygl 降为投影。0.2.0 独立账本仅作只读迁移来源和历史测试夹具；规范以 `docs/YGL-WRAPPER-MIGRATION.md` 与 `docs/ADR-004-dynamic-context.md` 为准，不因旧文档或历史测试通过继续扩展该分工。
- 后续产品方向为“动态上下文工程”，用户已选择所有登记工作区范围：标签更新、design/spec 引用、评分结语、二次分类与全局品味视图。2026-11-15 用户已确认“开始”，按原生封装与缺口 → 工作流／ZIP 迁移 → 动态上下文顺序自主实施；不再请求同一路线确认，未验收能力不报完成。

## 目录与历史保全

- 根目录声明文件为 `README.md`、`AGENTS.md`、`SKILL.md`、`LICENSE`、`.gitignore`、`.gitattributes`、`package.json`、`package-lock.json`、`tsconfig.json`。正式代码进入 `src/`，业务测试进入 `tests/`，可重复工具进入 `scripts/`，面向人的规范和证据进入 `docs/`。
- `archive/browser-extension/1.5.0-20261114/` 是冻结的原项目快照，包含插件代码、依赖、测试、历史文档及当时设计；不编辑、不安装依赖、不直接运行会向归档写入的测试。恢复方法见其父目录 README。
- 旧浏览器配置及此前被拒清理的临时对象保留在 `tmp/`，不清空、不换方式删除或移动。技能 junction 保留在 `.agents/`、`.dsh/`，不修改链接指向的技能副本。
- 临时输出只放 `tmp/<任务名>/`，由 `.gitignore` 排除；运行态放工具自有工作区；凭证不写入文件、argv、日志、ygl payload 或导出包。
- `docs/project-transition.json` 记录本机原路径、归档映射、原文件 hash 与校验结果，不提交 Git。历史回执中的路径是当时事实，不批量改写旧记录；公开范围见 `docs/ARCHIVE.md`。

## 架构与行为

- 复用 Agent 宿主和 ygl 原生 CLI。领域状态、任务、工件、关系和索引由 ygl 承载；retouch 负责电商 profile、命令编排、图像处理与上下文交换。原生缺口必须明确并通过原生 CLI／插件扩展解决，不能偷偷增加独立 ledger/catalog 或用 db sql 建影子业务系统。正常运行不得写旧独立账本，历史读取只用于明确的迁移／复核路径。
- 默认图像执行方式为 host：CLI 生成绑定输入的任务单，宿主用其实际可用的图像工具执行，再回接真实结果文件。离线提供商仅用于演示／测试；API fallback 需要明确选择与配置，不能因宿主工具缺失自动转为收费 API。
- API fallback 通过 `src/native/api.ts` 和原生插件的执行配置／意图／回执工作，不自建提供商账本。仅从显式环境变量读取 base/key，不记录凭证；默认不跟随重定向、不下载 URL 响应、不自动重试。已保存响应的恢复只做本地处理。模拟 API 验收与真实付费 API／商品质量分别报告；定向检查用 `scripts/test.mjs --suite api`。
- 需求文字非空且未停用即参与。保持用户原文与 Agent 解释的区别；后续步骤绑定明确的前序结果及坐标系。
- ygl unlock、rc0、提供商受理、收到图片、检查通过、人工接受和任务交付分别判断。质量未知或未运行不计通过。
- 相同请求键重放已有事实；外部请求结果未知时先对账。补写 ygl 失败不能触发重新生成图片。
- 新任务须绑定明确业务项目、目标版本、交付物和完成条件。接手先读 project brief；外部候选、设计文档与实际生成分别记录。使用 `docs/PROJECT-CONTEXT.md` 中的真实接口迁移旧任务，不补造历史目标、授权或接受。
- 业务方案以关联项目／任务的原生 design/spec/citation 为正式入口；先读 brief.documents 和 artifact show，按 ID/version/hash 用 artifact revise 修订，历史用 artifact history。Markdown/ZIP 是显式可读／交换副本，不默认创建业务 docs/*.md，不靠文件名管理正式版本；源码仓库 docs 保存开发规范，不能据此强制业务副本目录。既有正文 v1/v2 字样不等于原生 version，不重复登记已有工件。
- ZIP 只交换完整项目的领域事实、关系和 CAS，先校验／预检再事务恢复，目标冲突不得静默覆盖。历史授权与当前执行权限隔离；同快照重导不回滚本地进度、不重发未知请求、不重新出图。
- 用户的计划授权、素材外发范围、费用上限和最终验收是独立事实；已授权范围内的普通开发与执行自主推进，不增加逐步确认。

## 验证入口

- 业务 CLI：`node src/cli.ts`；类型检查：`npm run typecheck`；完整原生测试：`node scripts/test.mjs --ygl-entry <实际安装入口>`；历史夹具回归显式 `--legacy`；独立原生演示：`node scripts/demo.mjs --ygl-entry <实际安装入口>`。Windows PowerShell 使用 Node 入口传递参数，不依赖 npm.ps1 转发。
- 当前实际命令与协议以 `docs/CLI.md`、`docs/HOST-EXECUTOR.md` 和 CLI help 为准。宿主执行以 actual tool availability 为前提，dispatch 的 replayed 响应不能触发第二次出图。保持区采用批准矩形内合成，再对实际候选做视觉检查。
- 每次完整测试保存不可变运行报告与最新索引到 `docs/verification/`；原生集成、离线图像处理、宿主协议夹具、真实 AI 质量分别报告。单元测试显式 `--unit-only`，不把它写成原生集成已通过。

- 本机另保留初始设计校验与探针工具 `scripts/validate-retouch-design.mjs`、`scripts/explore-retouch-ygl.mjs`；它们和所需原生记录、归档基线不随公开仓库发布。仅在这些本地材料实际存在且当前任务需要时使用，不把它们作为公共构建或测试前提。
- 本机设计记录使用独立 home `~/.ygl-trees/workspaces/retouch-cli-design`。项目更名只更新其归属 marker，保留原 project/tree/task ID；不改默认库、全局安装或共享 ygl 检出。
- 实现阶段补充有意义的领域、CLI、图像与 ygl 集成测试；真实调用独立 opt-in。按实际 JSON、退出码、文件和人工结论报告 PASS、FAIL、UNKNOWN、NOT_RUN。
- 收尾检查正式入口、受影响的引用、归档完整性和临时物去向；不把技术通过等同于发布授权。

## Agent Atelier

项目业务技能由根 `SKILL.md` 和 `.agents/skills/ecom-retouch-flow/SKILL.md` 提供。当前环境另有 Agent Atelier 时，继续按其可见规范处理产物与开发决策；本机技能 junction 不随仓库发布，不要求其他使用者安装它。用户当前裁决优先，不从技能自动推导额外权限。
