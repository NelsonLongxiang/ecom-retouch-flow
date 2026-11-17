# 电商修图流 · EcomRetouchFlow

以 ygl-trees CLI 为底座的电商修图与动态上下文工作流。用户描述商品图的目标和保持项，Agent 组织需求、编排步骤、调用实际可用的宿主图像工具，再检查、交付并沉淀可复用经验。

## 项目目录定义与治理

**维护归属：EcomRetouchFlow 项目维护线，属主终裁。** ROOT 是按当前环境声明核实的项目根，不从 cwd 猜测，也不强制其他机器使用相同绝对路径。源码检出与业务工作区分开，运行时传明确参数。下面是本项目唯一目录职责地图；开发约束见 [AGENTS](AGENTS.md)，业务操作见 [SKILL](SKILL.md)，两者引用本节，不维护第二份地图。

**零容忍准则：归属、位置、授权、保全、生命周期或消费者任一项未知/失败，就停止依赖它的写入；不隐藏问题、放宽判据或把文档修改当实际修复。** 不自动迁移、删除历史或替换技能链接。

| 路径 / 正式入口 | 职责、编辑与保留边界 |
| --- | --- |
| 根声明文件 | 仅 [README](README.md)、[AGENTS](AGENTS.md)、[SKILL](SKILL.md)、[LICENSE](LICENSE)、[.gitignore](.gitignore)、[.gitattributes](.gitattributes)、[package.json](package.json)、[package-lock.json](package-lock.json)、[tsconfig.json](tsconfig.json)。新增根文件先明确工具要求/维护职责，禁止临时脚本、业务输入和交付散落根目录。 |
| [src/](src/) | 当前 CLI 与原生封装源码；正式执行 [cli.ts](src/cli.ts)。旧账本相关代码只作明确历史迁移/夹具兼容，不扩成第二业务事实源。冻结验收时禁止改受验字节，先交接写入窗口。 |
| [tests/](tests/) | 产品原生/历史回归及共享夹具；原生和历史范围分开，测试输出不得写回夹具/归档。独立验收不修改主开发测试来放行。 |
| [scripts/](scripts/) | 可复用项目工具；正式验证入口为 [test.mjs](scripts/test.mjs)、[demo.mjs](scripts/demo.mjs)。本地设计capture/probe及初始探索工具有原范围，先读说明，不当默认业务命令或公共运行前提；不把任务脚本复制为同义入口。 |
| [docs/](docs/) | 产品开发规范、ADR、公开证据摘要；[CLI](docs/CLI.md)、[宿主协议](docs/HOST-EXECUTOR.md)、[路线图](docs/ROADMAP.md)维护各自事实。[技能演化](docs/SKILL-EVOLUTION.md)记录本次技能候选，不是业务design。 |
| [docs/verification/](docs/verification/) | 项目可重复验证的说明、最新本机JSON索引及不可变runs；[验证说明](docs/verification/README.md)为公开入口，本机JSON依既有规则不跟踪。不得覆盖旧失败/独立报告冒充成功。 |
| [docs/demo/](docs/demo/) / [docs/issues/](docs/issues/) | 明确的演示样例、产品问题提报与开发沿革；[Issue索引](docs/issues/README.md)不代替业务任务和接受，原提报时态保留。 |
| 本机早期研究／迁移记录（定位见下方清单） | 仅本地保全，不随公开仓库分发、不作运行依赖，不批量改历史路径/版本；公开边界见[归档说明](docs/ARCHIVE.md)。 |
| [.agents/skills/ecom-retouch-flow/](.agents/skills/ecom-retouch-flow/) | 已核实为本项目普通目录；[发现入口](.agents/skills/ecom-retouch-flow/SKILL.md)只引导根业务技能，不能独立复制安装或长出第二份规则。 |
| 可选 Atelier junction（本机定位见下方清单） | 指向共享 Agent Atelier，不是本项目可编辑副本；保留链接/目标，不随仓库分发，不改共享技能代替项目修订。 |
| 本机冻结插件归档（定位见下方清单） | 只读，不直接安装/构建/测试写入；恢复方法和公开范围见[归档说明](docs/ARCHIVE.md)。历史266项校验属于原迁移记录，不是本轮重验。 |
| 本机任务临时区（定位见下方清单） | 新输出仅放 `ROOT/tmp/<任务标识>/`；开发和独立验收各用任务子目录，不覆盖他人现场。旧浏览器/被拒清理对象原位保全；不豁免根层散落，不作正式能力或唯一持久交付依赖。 |
| node_modules/ / .git/ | 依赖生成物与版本元数据；不手工编辑。安装、共享状态、Git暂存/提交/分支按实际授权和协作门禁；不动他人暂存/在途，不用clone/worktree/stash绕冻结。 |
| 原生业务工作区与导出目标 | 实例的project/task/goal、design/spec/citation、媒体CAS、授权/接受由指定业务工作区承载，不写源码docs当正式业务版本库。图片导出目标与恢复home各按契约预检，路径不因导出成功自动取得迁移/覆盖权限。 |

本机专用对象由现有忽略规则排除，公开检出不要求存在。以下是路径定位，不是随仓库提供的下载链接或新建授权：

```text
docs/ai-native-cli/
docs/project-transition.json
archive/browser-extension/README.md
archive/browser-extension/1.5.0-20261114/
.agents/skills/agent-atelier/
.dsh/skills/agent-atelier/
tmp/<任务标识>/
tmp/upstream-issues-20261115.zip   # 待核归位的历史对象，保持原位
```

### 写入前六项门禁

本次直接文档编辑也适用；相同范围已核证据可复用，目标/平台/权限/并发变化时重查。每个PASS必须有实际依据，`.gitignore`、目录存在或rc0不能单独证明通过。

| 判据 | 当前动作须核对 | 不通过时 |
| --- | --- | --- |
| D1 归属 | 有效项目声明、维护人/任务用途、解析后的真实ROOT和链接边界 | 停该路径写入，不就近选cwd/邻仓 |
| D2 位置 | 对应上表明确职责；已有正式对象优先复用 | 先明确归位，不先生成再搬 |
| D3 授权 | 本次目标和动作受明确指令覆盖；Windows落盘、业务执行、部署分开 | 仅问尚缺的具体授权，不以P2/PASS推导 |
| D4 保全 | 已有文件、他人在途/运行占用、唯一原件及后续合法改动 | 不覆盖、不清空、不绕锁，先核恢复/处置授权 |
| D5 生命周期 | 临时物仅项目任务tmp；正式能力/持久说明不依赖tmp | 停错误去向，不通过换目录名/隐藏历史过关 |
| D6 消费者与结果 | 已知引用/加载入口、验证方式和实际输出落点，包括工具隐含spill/cache | 不可确认则BLOCKED/UNKNOWN，不宣称全链合规 |

### 已知问题与未决状态

| 对象 / 证据 | 状态、影响与下一步 |
| --- | --- |
| H1 · 宿主日志落点／完整读取 | **宿主目录问题未修复。** 用户已另给本轮有限自动日志例外，项目编译/原生开发验证因此按真实记录执行并通过，不代表永久豁免或宿主合规。到期/额度用尽即停止例外；不改DSH/共享配置、不清历史、不换入口绕过。诊断和恢复条件仍见[现有交接](docs/SKILL-EVOLUTION.md#宿主输出阻塞的最小交接)。 |
| H2 · 根层历史 ZIP（本机定位见上方清单） | **D2/D5位置不符，D4活跃引用与处置授权未明。** 28,370字节、13条目与同名任务目录hash一致，不据此推定无人使用。迁移确认未取得，原位保全；不新建同类根层输出，不覆盖、移动或删除，不改历史回执。 |
| 技能0.1.5与#16/#17方法候选 | 书籍摆放、相对截面分项及[控制前检/三层对照](docs/PHYSICAL-REFERENCE-WORKFLOW.md#结构纠偏的控制前检与三层对照)已进入公共方法和短入口。原生接手/记录/编排已通过开发及独立软件复验；不证明模型服从、实际主动纠偏、毫米准确或收益，真实视觉/用户接受仍另验。见[技能演化](docs/SKILL-EVOLUTION.md)。 |
| 当前软件补丁与历史原生报告 | 开发类型检查PASS，outputs33/33、issues9/9、完整原生80/80 PASS；原检测席同字节独立全量80/80及一次针对性3/3软件验收PASS，零失败/取消/跳过，80输入一致。历史失败不改写；真实视觉/毫米精度和收益不由软件验收证明。仓库交付以PR头为准，不自动合并或关闭issue。 |

本节核验只覆盖项目根一层、上述职责、直接相关链接和本轮文档；没有递归审计所有tmp/归档/依赖、所有运行占用或宿主缓存，**不声称全仓/全盘ALL_CLEAN**。问题消除必须有实际修复与复验证据；地图只说明归属，不是运行时沙箱或自动准入器。

## 当前版本与快速开始

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

让 Agent 使用 [SKILL.md](SKILL.md)（本项目领域技能修订0.1.5候选；来源、分层验证与采用状态见[技能演化](docs/SKILL-EVOLUTION.md)，不等于CLI发版或全局安装）；参数及 JSON 示例见 [CLI](docs/CLI.md)，真实图像交接见 [宿主协议](docs/HOST-EXECUTOR.md)，架构边界见 [架构](docs/ARCHITECTURE.md)。[动态上下文规范](docs/DYNAMIC-CONTEXT.md) 区分已实现的检索分析与仍由宿主 Agent 完成的专业解释。

[物理参数到可视参考](docs/PHYSICAL-REFERENCE-WORKFLOW.md) 提供六层定义与七阶段链路，区分构型/测量状态、成像条件、非成品参考、控制值和实际观察；不承诺CAD精度或自动物理验收。

[购买决策叙事](docs/NARRATIVE-WORKFLOW.md) 补充参考/事实→买家矩阵与整套低成本分镜→风险代表样张→制作的顺序，以及商品动作对象、物理图文与职责适用反例检查；它是业务方法，不是CLI自动看图或真实视觉验收。

[工程流程契约](docs/ENGINEERING-CONTRACTS.md) 提供用途与内容覆盖、多来源冲突、旧图重新采纳、逐项商品保持、原生本地变换和套图快照。接手能看到“已有结果待复核”，套图支持部分接受、完整/增量图片包；真实观察、未知、用户接受和技术状态分别保存。

旧 0.2.0 账本和 v1 ZIP 仅通过 `legacy inspect/migrate` 只读读取，迁入新建隔离工作区；不自动修改真实用户数据。原生 v2 ZIP 不静默接受旧格式。操作和限制见 [项目上下文](docs/PROJECT-CONTEXT.md)。

## 验证与当前状态

已交付基线eb55a962（PR15）的原80项软件验收保留原范围。后续#18候选已完成最终类型检查PASS、开发全量83/83和独立全量83/83 PASS，84份输入稳定、11类领域原件PASS；但独立定向探针2/3、实际multipart证据不足，结论仍为**INCOMPLETE_INDEPENDENT_ACCEPTANCE**，不作软件验收done，也不认定探针失败即产品回归。原失败/unknown部分效果保全。属主另准将该在途候选保全为未合并Draft以交回共享检出；不是合并、部署或实际商品验收。详见[完整验证范围](docs/verification/README.md)。

[P1 #18商品一致性与受保护产品层](https://github.com/NelsonLongxiang/ecom-retouch-flow/issues/18)的[原生实现候选](docs/ENGINEERING-CONTRACTS.md#商品一致性与最终产品层)沿用invariant spec/plan/transform，钉合格母版、每步结构参考、有限产品层配方与最终编码重建；Skill0.1.6仍为候选。当前仅Draft保全、未合并未部署，禁止将其不完整独立结论当作正式业务准入。受限登记纠错另从已交付基线独立分支开发，不混入本候选；宿主问题/真实视觉/毫米/收益不由软件运行PASS证明。

MIT License。原浏览器插件冻结于本地 `archive/`，归档、业务运行状态、凭证与机器验证记录不参与 Git 跟踪。
