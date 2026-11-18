# 试点问题的实现与验收契约（#3–#10）

这些要求来自 2026-11-15 的脱敏电商试点。GitHub issue 管理开发状态，本文说明运行契约和验证入口；业务方案、字段事实、原始反馈和执行仍在业务工作区的 ygl 原生工件中。代码开发规范可以保存在源码 docs，不能据此让客户方案回到 Markdown 文件版本库。

| Issue | 实现与验收出口 |
| --- | --- |
| #3 | executor diagnose/check 分离配置授权、存在、凭证、协议、宿主观察与历史调用；不发付费探测 |
| #4 | 明确选择 Codex 配置来源与私网 HTTP 策略，保留 profile/计划/授权/单次请求/未知恢复闭环；真实调用单独验收 |
| #5 | external/received 有有效输出时不当成未知；workflow-run/received 仍待本地恢复；关闭任务核对当前接受和交付 |
| #6 | 交付先路径预检，准备后与每次写入再次核对；已准备失败报告 committed/unknown；同键恢复或显式放弃 |
| #7 | 原生 v1 与名为 v2 的旧文件 → 原生 revise v2 → 校验归档 → 原生映射 → 换会话接手 |
| #8 | 请求、原生响应和交付画布分别展示，按实际媒体字节登记；诊断／本地处理不触发模型请求 |
| #9 | product-facts spec、原生来源摘录、用途与必要字段检查、保守呈现策略；视觉接受不提升规格 |
| #10 | 保存原始 score/量表/原文/来源，未知下限或刻度为 null；分量表统计、恢复去重、能力门禁 |

## 业务状态与交付

`project check <id>` 与 brief.business_health 读取业务一致性。有效 external/received 须指向同项目／任务／目标的真实 model-output/postprocess/candidate；unknown/dispatched 仍阻止新请求。workflow-run 的 received 无论有图片与否，都继续要求本地恢复。图像任务关闭仍核对当前目标、需求、确切 hash 的用户 PASS/接受，以及已完成交付；doctor/index 的图结构通过不替代此检查。

`artifact deliver` 与 `run deliver` 在准备前检查目标独立于工作区、父目录存在、链接改向和已有文件冲突。准备后再次检查父／目标目录身份，并在每个文件写入前后核对；不覆盖不同内容。文件和 manifest 采用确定内容，图片已写但清单未写时，同键同路径重放可补齐，不调用图像服务。

准备前拒绝不会创建 preparing 工件；准备后失败的 effect_status 为 committed，无法确认最终状态时为 unknown，details 带准备已登记和恢复入口。新路径是新意图，不能复用旧键修改目标。核对未发布清单后，可显式 `delivery abandon <id> --file <处置.json> --request-id <key>`，文件为 `{"statement":"<实际核对与处置依据>"}`。原生状态为 abandoned，旧意图和文件保留；已有本交付清单时应重放完成登记，不能假称未发布。

两阶段文件检查用于发现可观察的路径变化，不作为抵御同 OS 身份恶意写入的独立沙箱。记录放弃不删除已存在文件，也不自动处置真实业务中的历史 preparing。

## received输出角色误登记恢复

外部真实结果若误标reference，pending保护可能与needs_review互锁。现在的[受限登记纠错](CLI.md#已received外部输出的受限登记纠错)是显式原生审计入口，先只读预检，再在当前workspace确认下校验execution revision、原role、原output/hash及可靠授权源；只更reference→candidate及审计引用，不改received/原outputs/CAS/旧FAIL/UNKNOWN，不自动context-review/接受/交付/渲染。命令实际集成与独立验收未完成前不对业务声称可放行。既有execution reconcile仍只处理unknown/dispatched，不扩为重写确定执行事实。

## 请求尺寸与真实图片

`asset dimensions <media-id>` 一次查询实际交付尺寸、模型原生输出、各次请求和派生链。brief.dimension_diagnostics 与新交付 manifest 的 dimension_provenance 使用同一派生算法；交付保存稳定快照，后续状态变化不会改写已有文件。旧 manifest 不补造原来没有记录的请求信息。

外部 execution record 可附 `requested_dimensions`：

```json
{"width":2048,"height":2048,"scope":"api-request","source_ref":"<实际请求回执来源>"}
```

只有用户交付目标时，scope 用 delivery-target，不能冒充实际传输尺寸。原生工作流从冻结的 executor profile 读取发送的 size；`plan submit` 可另附 `delivery_canvas`（width/height/source_ref），与请求选项分开。auto 不等于服务承诺返回指定像素。RESPONSE_SIZE_MISMATCH 表示声明请求与实际返回不同，不能据此断定模型本体或所有服务不支持该尺寸。放大／排版保留原始字节和派生，较大画布不证明新增了真实商品细节。

## 字段事实与用途

先通过 spec register/context cite 保全原文或参考，随后 `facts register --project <id> --file <事实.json> --request-id <key>`：

```json
{
  "source":"<本次字段捕获来源>",
  "facts":{
    "schema":"retouch.product-facts/v1",
    "fields":[{
      "key":"drawer.interior","value":null,"status":"unknown",
      "role":"ai-reconstruction","subject":"unknown","applies_to":"unknown",
      "evidence_type":"ai-output",
      "source":{"artifact_id":"<原生来源ID>","quote":"<正文中的精确摘录>","label_present":false}
    }]
  }
}
```

字段角色为 user-original/verified-spec/agent-interpretation/hypothesis/reference/ai-reconstruction；确认状态为 unknown/observed/hypothesis/confirmed。subject 为 current-sku/reference-sku/unknown，applies_to 为 single-item/set/package/visible-part/unknown。单位未知保留 null。原文没有表头的数字不能填成已确认销量、利润或成本。

confirmed 须有当前商品、明确字段标签、用户原文或已验证规格角色、product-specification/measured/user-field-confirmation 证据性质，以及实际 confirmation.statement/source_ref。来源必须存在且摘录在原生正文中。视觉接受、AI 补绘、同系列参考和无标签数字不能单靠内容非空通过。确认尺寸还须包含单位和单件／整套／包装对象。该记录保存依据和确认事实，不宣称软件自动核验了实物。

计划明确 `purpose:concept` 或 `product-accurate`。每步的 `fact_keys` 只列当前呈现真正依赖的字段，不能把整个事实清单都变成审批。实物准确任务缺必要确认会报 FACTS_INCOMPLETE；概念提案可在边界内继续，并明确不能作为实物规格。可选 safe_strategy：

- closed-drawer：未知抽屉内部保持闭合。
- visible-only：仅展示可见结构，不补造未知内部。
- omit-unverified-labels：省略未核实尺寸、材质、性能或数量标签。

边界进入冻结计划、宿主 job.step.fact_constraints 与 API 实际提示词。已确认值通过 step.bound_facts 携带字段、值、单位和适用对象，实际图像提示词使用这些值；来源 ID、摘录和确认记录保留在计划的 fact_check 审计上下文中，不为渲染自动外发整段来源。事实更新经 artifact revise（content 为完整事实对象），原始来源和旧版本保留；只有用到变化字段的任务及下游需要复核。新的视觉接受不会自动修改事实。证据变化时由 Agent 读取精确来源后明确修订字段，不静默改写历史引用。

## 原始反馈与量表

`project feedback` 接受旧 1–5 整数／null，或原始量表对象：

```json
{"rating":{"score":8,"scale_max":10,"original_text":"满分10星，我可以给8星","source_ref":"<实际用户原文来源>"},"conclusion":"<用户结语原文>","source":"user"}
```

scale_min/step 未说明为 null，不补成 0 或 1。新记录在 profile.rating_record，旧兼容字段 rating 为 null；这是“原始八星有效反馈”，不是完全未评分。历史四星留在旧 profile 版本，不被批量换写。量表越界、缺原文／来源、冲突或同键异意图拒绝。

taste view 在每个分母、标签和分类里统计有效评分数，rating_scales 分量表给原始均分。混合 8/10 与 4/5 时 mean_rating 为 null，显示两组及各自样本；不偷偷归一化。未知下限／刻度在组元数据中显示。未评分不填零，同一逻辑项目的恢复副本不重复计数。

ZIP 声明 retouch-rating-scale/v1、retouch-product-facts/v1、retouch-dimensions/v1 等实际所需能力；缺声明或未知能力拒绝，不让旧工具默默丢弃新语义。原文、来源、规格、版本、任务进度、关系和实际媒体一起恢复，重导不重复任务或重新出图。

## 文档归档回放与验证范围

文档测试用脱敏同构材料回放：旧文件名 old-v2.md 的正文已是原生 design v1 → 读 ID/version/hash → revise 得到原生 v2 → 再核对原生 v1 保全和文件 SHA-256 → 在已授权的隔离归档目录移动 → 原生 reference spec 记录 source_workspace/source_project/source_artifact/source_version/source_hash/file_sha256。新会话只凭项目入口可找到当前正文、历史精确引用和归档映射。文件 hash 与规范 JSON 正文 hash 不是同一种 hash。

这不是自动移动真实客户文件的授权，也不强制业务副本使用 docs。现有正文、回接、旧版本冲突、重放和 ZIP 往返均保留回归。

复现入口：

```text
node scripts/test.mjs --suite issues --ygl-entry <已安装的-ygl入口>
node scripts/test.mjs --suite documents --ygl-entry <已安装的-ygl入口>
node scripts/test.mjs --ygl-entry <已安装的-ygl入口>
```

具体结果以同源码指纹的报告为准。模拟服务忽略 size、原生 received 保护和故障恢复为隔离验收；真实历史图片只做另列的只读字节／尺寸复核，不能冒充新执行通道的真实调用。#4 的真实服务调用须有适用授权，独立记录，不用模型列表或模拟通过替代。

2026-11-15 最终完整隔离回归为17/17 PASS，类型检查 PASS。#4 随后获得用户一次调用授权，并完成原生 profile／计划／授权／execute-api 的真实闭环：合成256×256输入、`gpt-image-2`、size=auto、一次请求、零自动重试，收到1254×1254 PNG，字节hash与原生媒体一致；重新打开工作区后可按项目入口独立接手。执行状态保留 waiting_for_review，图像质量接受未运行。本地 service-live.json 与关联任务的原生结果 spec 保存独立实调证据，不包含凭证；未自动整改真实客户数据或处置历史业务文件。
