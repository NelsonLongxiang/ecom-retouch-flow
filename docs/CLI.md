# CLI 0.4.0 · ygl 原生封装

入口 `node src/cli.ts`，完整命令以 `--help --json` 为准。stdout 为单一 `retouch.cli/v2` JSON 信封；rc0 表示命令已处理，rc1 为运行／冲突错误，rc2 为参数错误。图像质量、用户接受和项目完结另查实际事实。

每条业务命令显式传 `--workspace <目录>`；项目内操作传 `--project <原生 id 或 name>`。写入使用稳定 `--request-id <唯一键>`；相同键异意图报冲突。更新通过 `--expected-revision` 检查版本：项目 profile 使用 `profile.version`，任务使用解码后的 `meta.retouch.revision`，运行使用解码后的 `meta.revision`。原生 artifact 的 content/meta 按原生接口保留 JSON 字符串；brief 的 profile.content 和 tasks.meta 已解码。

`task show`、`task list`、`next <task-id>` 和 project brief 使用同一实际进度视图，不因没有正式 run 就把已有外部候选报成等待计划。`project timeline <id>`／`run timeline <id>` 从原生事件读取各步骤输入、执行、回接、检查和交付的回执。

下面 JSON 是 `--file` 文件内容示例。占位符必须换成实际响应 ID／hash，授权和接受文字必须来自真实用户。源码与业务目录分开，不在仓库根放输入文件。

```text
node src/cli.ts workspace init <空目录> --ygl-entry <ygl/dist/bundle/bin.cjs> --json
node src/cli.ts project new --file <project.json> --request-id <key> --workspace <目录> --json
```

```json
{"name":"柜体商品图","intent":"修复柜门纹理，保留真实结构","tags":["类目:家具","部位:柜门","风格:原木"]}
```

`goal new --project <id> --file <goal.json> --request-id <key>`：

```json
{"title":"柜门高清重绘","scope":"修复柜门表面","preserve":["柜体结构不变","把手位置不变"],"done_when":"用户接受实际候选并交付","source":"用户原始需求"}
```

已有目标通过 `artifact revise` 追加原生 spec 版本，同标题 `goal new` 会拒绝。旧任务不会静默切换。先对账 unknown，再 `task context-review <task-id>`，文件为 `{"goal":"<新目标 spec id>","statement":"实际复核依据"}`，绑定新目标并清除旧计划指针。

有旧图片而没有当前候选时progress为result_needs_review；用 `artifact revalidate <media-id> --expected-revision <任务revision>` 显式复核，不复制旧图或沿用旧接受。新命令 `intent set`、`coverage show/review`、`conflict record/resolve/list`、`invariant set/review/show`、`asset font/transform`、`suite snapshot/show/accept/export` 的JSON及真实行为见 [流程契约](ENGINEERING-CONTRACTS.md)。这些状态、关系和版本仍由ygl原生工件承载。整套策划与返图观察见 [购买决策叙事](NARRATIVE-WORKFLOW.md)。suite export可选output_profile以原生快照编排原比例PNG、方形sRGB JPEG、变高长图和轻量阅读；此模式to为独立组件目录，超限/分离/恢复见 [快照输出](SNAPSHOT-OUTPUTS.md)。

`task new --project <id> --file <task.json> --request-id <key>`：

```json
{"goal":"<原生目标 spec id>","title":"精修柜门","brief":"保留用户原文","expected_output":"商品图候选","done_when":"实际验收及交付","kind":"image","dependencies":[]}
```

设计任务用 `kind:design`。`requirement set <task-id> --file <requirements.json> --expected-revision <rev> --request-id <key>`：

```json
{"groups":[{"id":"door","text":"修复柜门纹理，可在此补充要求","disabled":false,"scope":"operation"},{"id":"keep","text":"其余部位保持","disabled":false,"scope":"preserve"}]}
```

空白或 disabled 组不参与。`asset add --project <id> --task <id> --file <本地图> --role original --request-id <key>` 登记原图；参考图为 reference。派生图可以 `--parent <media-id>`。实际尺寸/hash 从字节读取；`asset resize <media-id> --width 2048 --height 2048 --request-id <key>` 创建独立后处理产物。

`plan submit <task-id> --file <plan.json> --expected-revision <rev> --request-id <key>`：

```json
{"input":"<原生 media id>","steps":[{"id":"door","prompt":"修复柜门纹理，保持结构","needs":[],"region":{"x":10,"y":10,"width":100,"height":100},"coordinate_system":{"width":200,"height":200}}]}
```

无 region 表示全图处理；局部步骤按明确坐标系校验，前序尺寸变化后不能套用旧坐标。顺序依赖只能指向前序步骤。计划返回 `plan`、`plan_hash` 和空白确认的 `approval_template`，有效需求正文一同冻结。

`approval grant <task-id> --file <grant.json> --request-id <key>`：

```json
{"plan_id":"<plan.id>","plan_hash":"<plan_hash>","issuer":"host-human","confirmation":"真实用户对该范围的授权原文","expires_at":"<实际未来 ISO 时间>"}
```

`run start <task-id> --file <start.json> --request-id <key>`，文件为 `{"grant":"<authorization id>"}`。每份授权只用于一次运行。运行流程：

```text
run dispatch <run-id> --expected-revision <rev> --request-id <key>
run complete <run-id> --file <实际宿主输出图> --expected-revision <rev> --request-id <key>
run review <run-id> --file <review.json> --expected-revision <rev> --request-id <key>
run accept <run-id> --file <accept.json> --expected-revision <rev> --request-id <key>
run deliver <run-id> --to <独立交付目录> --expected-revision <rev> --request-id <key>
```

这些命令都传 workspace/project。dispatch 只有首次返回 `allow_execute:true` 才允许宿主调用一次；重放为 false。complete 直接接收实际图像文件，不调用模型。review 示例：

```json
{"sha256":"<实际候选 hash>","verdict":"PASS","observations":"实际看图得到的观察与保持项检查","reviewer":"实际检查者","source":"实际来源"}
```

accept 文件：`{"sha256":"<实际候选 hash>","statement":"用户接受原文","source":"user"}`。unknown 用 `run unknown` 保存 statement；真实结果回来仍用 run complete。运行结果查询用 `run status`。外部操作通过 `execution record/reconcile` 记录 `task/status/inputs/outputs/statement/source`；状态 unknown 不允许自动重发。

run complete 可加 `--metadata <回执.json>`，字段为 `tool` 和去敏后的 `tool_receipt`，记录实际宿主工具名称及回执。未提供时来源保持未指定，不补造提供商或真实 AI 执行证明。相同请求不能替换图像或来源回执。

已有外部候选用 `artifact review <id>`：文件含 sha256/verdict/observations/reviewer/source，用户接受再加 `accepted:true` 和 `source:user`。`artifact deliver <id> --to <目录> --request-id <key>` 直接交付已接受的真实文件。`task close <id>` 需 revision 与 `{"statement":"完成依据"}`；图像任务核对实际交付，设计任务核对设计工件。

## 已received外部输出的受限登记纠错

仅在真实本地/外部结果已收到、明确误登记为reference且无旧接受/完成交付时使用；不是重新生成、对账失败改状态或用户质量接受。首版仅允许reference→candidate，原execution保持external/received，原outputs/hash/CAS、goal/task绑定、旧FAIL/UNKNOWN、原任务context/revision均不改；只添加审计引用并递增execution revision。更正后仍须task context-review、旧结果适用性复核和真实逐项/用户接受，不能直接交付或启动新模型。

先实际读execution/media/可靠授权spec和workspace身份。授权spec/design的可靠正文须为紧凑JSON对象（禁止重复/额外键），schema=retouch.output-correction-permission/v1、decision=allow，精确绑定workspace_id/project_id/task_id/execution_id/media_id/sha256/from_role=reference/to_role=candidate，confirmation须为下例固定允许文本；请求source.quote与confirmation均引用该固定文本。该结构是实际人工许可的可核对编码，不能由Agent自行把拒绝或未知改成allow。历史导入/clone来源不得自动用作当前许可，新当前确认须原生新版本/新记录并保留原始来源。文件字段：

```json
{"task":"<原任务ID>","output_id":"<原执行已有输出ID>","sha256":"<实际原图hash>","expected_role":"reference","role":"candidate","workspace_id":"<当前workspace身份>","confirmation":"允许在所列工作区将所列已收到输出的登记角色从reference更正为candidate；保留执行事实及旧审阅，不授予图像接受或交付。","actor":"<实际操作者>","reason":"<误登记原因，不是视觉通过>","source":{"artifact_id":"<可靠本地spec/design>","version":1,"content_hash":"<正文digest>","quote":"允许在所列工作区将所列已收到输出的登记角色从reference更正为candidate；保留执行事实及旧审阅，不授予图像接受或交付。"}}
```

```text
node src/cli.ts execution correction-check <execution-id> --workspace <home> --project <project> --file <更正.json> --expected-revision <已读执行revision> --request-id <预检键> --json
node src/cli.ts execution correct-output <execution-id> --workspace <home> --project <project> --file <相同更正.json> --expected-revision <相同执行revision> --request-id <稳定更正键> --json
```

correction-check只读CAS/原生事实，返回dry_run，不追加事件/工件/关系或改revision；correct-output由现有原生事务和同键幂等承载，当前workspace同键同正文返回显式historical_receipt且correction_execution_allowed=false的旧回执，不重新确认当前授权；旧workspace在查回执前即拒绝。同键异内容拒REQUEST_CONFLICT，不要换键重复执行。新键旧revision/错hash/错role/跨项目任务目标/不是received/已有接受或交付/无可靠精确来源/错当前workspace均拒绝；不手改DB/CAS、不新建假执行。CAS实际hash与32MiB上限先核；权限确认不改变实际图片质量。审计note记录旧新值、actor/reason/source及当前确认，原登记事件与渲染事实保留。

ZIP声明retouch-output-registration-correction/v1并验证审计绑定，restore/clone保全历史；历史workspace确认不得在新workspace直接重放。此命令随源码候选出现不等于已获准进入业务入口，实际维护线变更身份、完整门禁和独立结论须分别核。

## 原生文档与导出

方案、目标和来源的正式入口是业务工作区中的原生 design/spec/citation。先读 `project brief <id>` 的 documents，按 artifact_id 调用 show 获取完整正文；documents 展示 design/spec 等系列当前版本，并保留所有 citation 固定快照。`observed-current` 只表示当前版本，不表示设计已确认、商品事实成立或任务完成。citation 的 `pinned-snapshot` 不声明来源仍为最新；同标题 citation 各自独立，history 只读取该精确快照，来源过期与否另由 context build 检查。

`design register`／`spec register` 文件字段为 title/content/role/source，可传 `--task`，业务文档应绑定其实际任务。role 使用 user-original、confirmed-fact、agent-interpretation、hypothesis 或 reference；不得把 AI 生成视为商品确认事实。register 只用于新系列；同 project/kind/title 已存在时返回 DOCUMENT_EXISTS，不将另起 v2.md 或改标题作为旧工件的修订方式。

```text
node src/cli.ts artifact show <工件ID> --workspace <业务目录> --project <项目ID> --json
node src/cli.ts artifact history <任一版本ID> --workspace <业务目录> --project <项目ID> --json
node src/cli.ts artifact revise <当前ID> --workspace <业务目录> --project <项目ID> --file <修订.json> --expected-version <已读取version> --expected-hash <已读取content_hash> --request-id <稳定键> --json
node src/cli.ts artifact export <确切版本ID> --workspace <业务目录> --project <项目ID> --to <明确的副本路径.md> --json
```

普通 design/spec 的修订文件：

```json
{"content":"完整新正文","reason":"本次修订原因","source":"实际新依据"}
```

默认保留角色、design_type、任务与目标绑定；可显式更新 role/confirmation_source/design_type，确认事实仍须真实依据。目标 spec 的 content 必须是完整目标对象（scope、preserve、done_when、source，以及实际原文／确认等字段），不能用 Markdown 替代结构化目标。同请求键重放原回执，不追加版本；旧 ID、旧 version 或错误 hash 返回 DOCUMENT_STALE。修改标题、类型、任务或任意 meta 返回 DOCUMENT_FIELDS。冻结工作流计划使用 plan submit；citation 保持精确快照，更新参考须重新阅读后 context cite。

修订延续原生关系并保留旧正文，关联任务及其下游需要上下文复核；不会重建任务、生成图片或自动把任务切换到新目标。检索命中旧正文时会标为 superseded，并给出 current_id/current_version；历史引用仍保留原文并报告 stale。

导出可读 Markdown 的元数据含 workspace/project/artifact 身份、版本、角色、来源、正文 hash 和导出时间。content_hash 为规范 JSON 字符串 `digest(content)`，与整份 Markdown 的文件 SHA-256 分开。JSON 工件以代码块呈现。导出不产生正式工件，不回写原生内容，不覆盖已有目标；副本目录不强制为 docs。用户展示和接手优先给原生 ID／版本；源码仓库 docs 仍用于产品规范，业务正文中的 v1/v2 标记仅作历史文字。

## 物理参数与可视参考方法

Issue #16的[公共方法及原生接手提纲](PHYSICAL-REFERENCE-WORKFLOW.md#原生接手与执行映射)复用既有facts register、design/spec register与artifact revise；每步参考仍为references中的media_id/purpose，已有host job和API提示词传递其职责。结构/基准/构型、视角及参考冲突在普通design/spec正文中维护，由Agent读取后编入计划；没有新增几何schema或自动冲突判定。method register仍是下方标签分类方法，不能用于几何定义；context cite仍只接design/spec。

## 试点问题补充入口

`project check <id>` 读业务状态一致性；brief 同时有 business_health、executor_profiles、宿主观察与 dimension_diagnostics。`asset dimensions <id>` 查看请求、原生响应和后处理尺寸。`delivery abandon <id>` 显式处置已核对的 preparing 交付，不删除文件。`facts register` 建字段级原生 spec，artifact revise 修订；plan 的 purpose、fact_keys 和 safe_strategy 限定任务用途和证据边界。

反馈新增原始量表对象，8/10 的 score、scale_max、原文和来源直接保留；旧 1–5 整数仍兼容。详细 JSON、归档回放与错误处置见 [试点验收](ISSUE-ACCEPTANCE.md)。配置复用使用 executor diagnose/check 和显式 configuration_source，见 [API 协议](API-FALLBACK.md)。

项目维护命令：

| 命令 | JSON 文件 |
| --- | --- |
| project tags | tags 数组，source 为 user 或 authorized-agent |
| project feedback | rating 原始量表对象／旧1–5整数／null，conclusion 用户原文，source:user |
| project close | reason:achieved/stopped/remaining，statement 用户决定原文 |
| project reopen | 不需文件；记录新 profile 版本，授权仍单独判断 |

这些命令均需要 project、profile 的 expected-revision 和 request-id。brief 返回真实未完成工作与提醒，不以缺评分阻塞修图。

`workspace register <已有目录> --request-id <key>` 登记跨工作区范围；可用文件 `{"authority_for":["<项目原生 id>"]}` 指明分歧时的唯一权威。没有明确权威的不同快照列为 conflict，不按修改时间合并。

`taste view` 输出标签涉及的不同项目数降序、二次分类、共现分母、评分数量与均分。`method register --project <id> --file <method.json> --request-id <key>` 的文件：

```json
{"title":"电商部位分类","source":"方法定义来源","method":{"schema":"retouch.method/v1","version":"1","minimum_samples":3,"rules":[{"tag":"柜门","dimension":"部位","value":"柜门"}]}}
```

`taste view --project <方法所属项目> --method <methodology id>` 引用精确方法版本；`context build --project <id> --query <关键词> --method <id>` 组装当前目标、引用诊断、检索来源、方法与分析。宿主 Agent 阅读正文后提出专业建议，不把统计直接当建议结论。

`context search --query <关键词>` 搜索全部登记工作区的原生 design/spec。`context cite --project <目标> --task <可选任务> --file <引用.json> --request-id <key>` 保存 workspace_id/project_id/artifact_id/version/content_hash/purpose/conditions，正文由实际来源读取并保全，不信任调用方粘贴替代。引用保持精确版本，context build 报告 stale/unavailable/conflict。

ZIP、旧版迁移和恢复示例见 [项目上下文](PROJECT-CONTEXT.md)。`index check/rebuild --project <id>` 核对文件、原生图及业务健康；图索引正确但业务状态矛盾时返回 BUSINESS_STATE，详情可用 project check 查看，不调用模型。`doctor` 输出原生健康检查，各检查结论须单独阅读。

显式 API fallback 使用 executor register/check、run execute-api、run recover-api、run api-result 和 run api-reconcile。配置、费用／外发确认、请求次数限制及尺寸恢复示例见 [API fallback](API-FALLBACK.md)。
