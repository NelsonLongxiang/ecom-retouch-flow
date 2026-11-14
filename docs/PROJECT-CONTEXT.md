# 项目上下文、索引与 ZIP 交换 · 0.2.0

业务项目、源码仓库和业务工作区是不同对象。SQLite 领域账本保存项目、目标版本、任务、设计、产物、外部操作、审阅、来源和关系；CAS 保存真实文件。项目摘要和 SQLite/ygl 索引从账本生成。

## 建立项目与目标

以下命令中的 `retouch` 指 `node src/cli.ts`，JSON 文件由 Agent 按用户实际材料准备。工作区参数始终显式传入。

`project.json`：

```json
{"name":"床头柜商品图","original_intent":"保留产品真实结构，先得到高清候选，再规划变体和套图","business_object":"cabinet-series-a"}
```

`goal.json`：

```json
{"original_text":"高清重绘并保留结构","interpretation":"先产出供用户审阅的高清候选","scope":"当前商品单图","preserve":"结构、比例与已确认材质","acceptance":"提供实际图片及尺寸，由用户终验","confirmation":"pending","confirmation_source":""}
```

```text
retouch project new --file project.json --workspace <工作区> --json
retouch goal new --project <project-id> --file goal.json --expected-revision 0 --workspace <工作区> --json
retouch task new --project <project-id> --goal <goal-id> --goal-version 1 --expected-output 高清候选 --done-when 用户接受实际最终图并交付 --image <原图> --brief <用户原文> --workspace <工作区> --json
retouch project brief <project-id> --workspace <工作区> --json
```

目标的 `confirmation` 为 pending 或 confirmed；confirmed 需要真实 `confirmation_source`。目标确认与具体图像计划授权分别记录。新目标使用 `goal new`；同一目标变更使用 `goal revise <goal-id>`，其 expected-revision 是项目版本。不会覆盖旧目标；受影响任务及其下游产物变为 needs_review，其他目标保持原状态。

复杂任务可用 `task new --file binding.json`，文件包含 `project_id`、`goal_id`、`goal_version`、`expected_output`、`done_when`，可选 `dependencies` 和 `kind:image|design`。设计任务可以不提供图片。完成“套图方案文档”仅表示文档任务完成，不产生图片生成事实。

## 已有工作区迁移

0.1.0 的任务和运行保持原身份及历史，不自动补造项目或用户确认。旧任务仍可查询、取消和回接原宿主结果；要继续新执行，先建立真实项目和目标，然后：

```text
retouch project bind-task <task-id> --file binding.json --expected-revision <任务版本> --workspace <工作区> --json
retouch index check --project <project-id> --workspace <工作区> --json
retouch index rebuild --project <project-id> --workspace <工作区> --json
```

`project bind-task` 自动关联已有原图和工作图；其他历史产物应通过 `artifact register`、`execution record/reconcile` 逐项登记。旧计划没有目标版本绑定，不作为新执行授权；重提当前计划，不重新生成已有外部结果。缺归属时报 `CONTEXT_BINDING_REQUIRED`，下一步为 `project.bind-task`。

目标改变后可用同一命令明确重绑当前目标版本。设计更新需要 `task context-review --file {"confirmation":"实际复核依据"}`；旧计划仍绑定旧设计，须明确重提。历史用户接受记录保留，旧目标产物不能直接作为新目标的接受结果。

## 素材、文档与派生关系

`artifact register <task-id> --file <真实文件> --metadata <metadata.json> --request-id <稳定键>` 支持 image、document、prompt、spec、receipt、evidence。文件进入 CAS，以真实字节计算 hash；图片尺寸从解码结果取得。

```json
{"type":"image","purpose":"postprocessed","fact_role":"derived","source":"实际本地放大回执的去敏观察","derived_from":["<模型原生产物-id>"]}
```

purpose 支持 original、working、reference、model_output、postprocessed、candidate、design、prompt、evidence、delivery。`fact_role` 区分 user_original、confirmed_fact、assumption、ai_generated、derived、reference、pending。单纯登记文件不能确认为产品事实；`project note` 的 confirmed_fact 要提供 `confirmation_source`，设计事实还要绑定来源产物。用户接受 AI 图片也不会自动将补绘细节升级为产品规格。

原图 → 模型原生结果 → 后处理结果通过 `derived-from` 逐项关联。例如 200×200、1254×1254、2048×2048 分别保留实际 hash 和尺寸，不能把请求尺寸写成原生输出尺寸。同一素材可供多个任务使用，每个用途有独立产物关联，CAS 字节不重复。

```text
retouch artifact list --project <project-id> --workspace <工作区> --json
retouch artifact show <artifact-id> --workspace <工作区> --json
retouch artifact review <artifact-id> --file review.json --expected-revision <产物版本> --request-id <键> --workspace <工作区> --json
```

审阅文件包含 `artifact_sha256`、`verdict:accept|reject|PASS|FAIL|UNKNOWN`、`issuer:human|host-human|agent`、`confirmation` 和 `source`。accept 必须来自实际用户，绑定当前目标及真实文件。`task close` 核对当前目标的文档或已接受图片，并记录完成依据；关闭任务、接受图片和交付是不同事实。

关系的方向为：goal → project（serves）、task → goal（serves）、artifact → task/attempt/execution（produced-by）、产物 → 来源产物（derived-from）、design → task（implements）、design → 依据产物（based-on）、新版本 → 旧版本（supersedes）、产物 → 审阅（reviewed-by）、后续任务 → 前序任务（depends-on）。查询入口均同时给出关系两端。

## 设计版本与事实来源

先登记文档产物，再执行 `design register <task-id> --file design.json --expected-revision <任务版本>`：

```json
{"artifact_id":"<文档产物-id>","status":"draft","facts":[{"text":"木纹属于尚未确认的 AI 补绘细节","role":"ai_generated","source_artifact_id":"<候选产物-id>","confirmation_source":""}]}
```

后续版本显式提供 `supersedes:<当前设计-id>`；保留 family_id、版本链和来源。设计确认状态支持 draft、confirmed；confirmed 必须提供实际用户依据 `confirmation_source`，具体产品事实仍通过 facts 分别记录，不能用状态字符串代替用户确认。

`project note --project <id> --file note.json --request-id <键>` 用于持久化只存在聊天中的必要原文，格式为 `text`、`role`、`source`、可选 `task_id` 和 `confirmation_source`。不补造缺失聊天，也不导出无关完整聊天历史。

## 外部执行回接

CLI 未覆盖的图像工具和本地后处理使用 `execution record <task-id>`。它只记事实，不调用工具，也不伪造正式 run。操作前登记 intent；中断后保持 unknown；已有输出先登记真实文件再补 received。记录 JSON：

```json
{"request_id":"<原工具请求身份>","channel":"<实际工具>","operation":"image.upscale","scope":"放大已存在候选","input_artifact_ids":["<原生输出-id>"],"output_artifact_ids":["<放大结果-id>"],"status":"received","recovery_note":"结果已存在，补记录不重新出图","source":"去敏后的实际观察","occurred_at":"2026-11-14T00:00:00Z"}
```

`execution reconcile <execution-id> --file result.json --expected-revision <操作版本> --request-id <键>` 更新同一操作；文件包含 status、output_artifact_ids、source、recovery_note。unknown 优先提示对账；已有候选使 task show、next 和 project brief 显示 waiting_for_review，而不是普通等待计划。正式宿主未知请求在目标或需求改变后仍优先提示对账；project brief 与 index check 另列 unknown_requests，保留旧运行和请求身份。查询与修复索引均不会重新发送请求。

## ZIP 完整交换

```text
retouch context export --project <project-id> --workspace <来源工作区> --to <project-context.zip> --json
retouch context inspect --file <project-context.zip> --json
retouch context import --file <project-context.zip> --workspace <新工作区> --dry-run --json
retouch context import --file <project-context.zip> --workspace <新工作区> --ygl-entry <本机已安装的-ygl-bin.cjs> --json
retouch project brief <原-project-id> --workspace <新工作区> --json
retouch index check --project <原-project-id> --workspace <新工作区> --json
retouch doctor --workspace <新工作区> --json
```

ZIP 的 `manifest.json` 使用 retouch.context/v1，列明生产工具、导出时间、来源工作区身份、业务项目、完整性、能力、每个文件的长度和 SHA-256，以及由内容清单生成的快照身份。`context/brief.md` 提供可读接手摘要。`records/` 包含 projects、goals、tasks、designs、artifacts、executions、reviews、relations、provenance、events、commands、projection-events、host-requests 的 JSON 数组，空集合保留空数组。图像和业务文档按 hash 去重放在 `objects/sha256/`。

导出使用账本一致性快照，随后读取不可变对象；缺对象、悬空关系或不可移植文档会阻止完整包发布。先生成并回读校验临时 ZIP，再以独占链接发布，已有目标不覆盖。仅提供完整项目范围，不提供可能缺少上游的局部导出。

inspect 和 dry-run 不创建工作区、不写账本、不调用模型。导入先验证 ZIP、schema、完整清单、全部 hash、实际图片尺寸、领域引用和冲突，再安装已验证 CAS 字节并在单个 SQLite 事务登记记录。新工作区导入中断时保留 import_pending，普通业务操作被阻止；重新导入同包恢复。已有工作区失败时不影响已有领域记录，先复制的 CAS 对象不会被误报为项目进度。

默认仅允许空工作区；已有项目时需显式 `--strategy merge`，且同 ID 的内容必须相同，不能按时间戳覆盖。`--strategy clone` 创建独立项目并完整重映射目标、任务、计划 hash、设计、关系、请求和事件身份；保存来源映射。相同目标目录中重复导入同一快照和策略幂等，后续本地进度不会被原快照回滚。内容寻址素材身份保持稳定。

导入重建 SQLite 索引、计划与运行证据以及项目 ygl 投影。ygl 不可用时返回 imported_index_pending 和具体修复入口，领域事实仍保留。用 `index rebuild --project` 补齐；重复导入报告当前索引状态，不盲重做业务操作。project brief 的 SQLite 部分始终从当前账本计算，不读取源包的“索引健康”声明。

历史授权、审阅和用户接受保持可查询；源机器的授权不激活新工作区的工具调用或交付路径。已有恢复运行要继续执行时，记录仍适用的实际用户确认，用 `approval grant` 建立本地回执，再用 `run authorize` 绑定既有运行。unknown 请求须先对账；不能通过重授权重发。历史 delivery/pending_delivery 的位置标为未恢复，不能自动继续向原目录交付。对于导入的 delivering 状态，在本地授权后显式 `deliver <run-id> --to <本工作区的新-exports-子目录>`，只交付原来已接受的图片；新 manifest 保留 restored_from_delivery_id，不增加图片尝试。

宿主任务单重定位到目标 CAS，保留原请求身份和蒙版。导入的提示词、文档和接手说明属于业务数据；导入过程不执行其内容，不读取服务认证，也不调用图像生成。

## 包边界与诊断

ZIP 上限 256 MiB，解压总量 512 MiB，单条目 32 MiB，最多 10000 条目；过高压缩比、加密、不支持算法、损坏长度、绝对路径、`..`、平台保留路径、链接与大小写碰撞均拒绝。导入不按 ZIP 路径直接解包，仅写入已验证的 CAS 和规范的宿主任务单路径。对象目录若被链接替换，同样拒绝写入。

不复制 SQLite 文件、workspace.json、ygl 数据库、机器环境、API key、token、认证头或进程租约。执行来源须事先去敏；业务文档包含不可移植机器路径或私有地址时要求登记可移植版本。用户原文作为来源事实保留，实际文件定位使用稳定身份和包内地址。

| 错误／状态 | 处理 |
| --- | --- |
| CONTEXT_BINDING_REQUIRED | 显式建立项目目标并绑定任务 |
| STALE_CONTEXT / GOAL_VERSION_CONFLICT | 查看旧版本、核对变更范围并重绑／复核 |
| CONTEXT_CONFLICT | 先 dry-run 查冲突；使用新工作区或显式 clone |
| CONTEXT_VERSION / CONTEXT_CAPABILITY | 使用支持该格式和能力的版本 |
| CONTEXT_HASH / CONTEXT_OBJECT / MISSING_OBJECT | 恢复原 hash 对象；不要重新生成代替历史 |
| CONTEXT_INTEGRITY | 修复所列悬空、跨项目或版本关系 |
| ZIP_PATH / ZIP_COLLISION / ZIP_LINK / ZIP_LIMIT | 拒绝该包，重新从可信工作区导出 |
| IMPORT_INCOMPLETE | 重导同一 ZIP，恢复尚未提交的导入 |
| DELIVERY_TARGET_REQUIRED | 本地授权后显式 deliver --to，重新选择目标工作区的交付目录 |
| imported_index_pending / index_pending | `index rebuild --project`，只修投影 |

rc0 只表示命令已处理；dry-run 的 conflicts、ygl pending、历史授权和未验收候选分别判断。SHA-256 验证完整性，不证明来源真实性；同 OS 可写账本的 Agent 安全边界与原实现相同。
