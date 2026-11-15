# 产品意图、证据和套图流程契约（E01–E07）

这七项来自2026-11-15的本地草案，以 `4c6d108` 为复现基线。E01–E07是本地需求编号，不是GitHub issue编号。本文是产品开发规范；实际项目的意图、冲突、保持项、候选复核、变换和套图选版仍保存在业务工作区的ygl原生工件中。源码文档和图片包不成为第二套业务账本。

所有命令使用 `node src/cli.ts`，传入 `--workspace <业务目录> --project <项目ID>`；写入带稳定 `--request-id`。JSON示例均为 `--file` 内容，真实ID、hash和来源从项目读取。评估结论必须来自实际观察；软件校验绑定、完整性和流程条件，不凭提示词或文件数量判断商品含义。

结构化意图、冲突、保持项和套图用本文专用命令追加版本，不通过通用artifact revise修改其受保护角色。历史仍用artifact show/history读取，普通design/spec继续沿用既有修订接口。

## E03 · 上下文与结果复核

`task context-review` 更新目标并增加上下文epoch，保留旧图片、旧检查和旧交付。旧结果不能因为上下文已复核就重新变成当前候选；有旧图但没有当前候选时，progress为 `result_needs_review`，而非planned。

需要复用时执行 `artifact revalidate <media-id> --expected-revision <任务revision>`：

```json
{"task":"<任务ID>","sha256":"<旧图片真实hash>","goal_id":"<当前目标ID>","requirements_hash":"<当前需求hash>","decision":"adopt","reviewer":"<实际复核者>","source":"<复核来源>","statement":"<为何仍适用于当前用途与结构；哪些接受不继承>"}
```

decision为adopt或reject。此命令追加独立原生review，不改原media的目标，不复制相同图片。adopt后仍需当前上下文的检查、用户接受及交付；旧接受不自动沿用。任务修订并发使用revision冲突保护，unknown先对账。同键重放不追加新版本。context_epoch、实际媒体hash和适用性记录均随项目ZIP保全。

## E07 · 关闭与节点证据

`task close` 在同一原生事务内核对有效产物并挂 `node → artifact / evidenced-by`，再解锁节点和更新任务。设计路径使用当前design；图像路径使用已通过当前接受/交付检查的delivery或workflow execution，并关联实际媒体。失败会整体回滚；重放不重复建边。历史关系保留，但目标变化会重新锁定节点，旧证据不自动证明新版本完成。不修改doctor的告警判据来掩盖缺证据。

## E01 · 意图、覆盖和代表样张

`intent set` 创建或追加原生business-intent spec；更新传已读取的 `expected_id`，首次省略或null。business_intent与concept/product-accurate用途不同，描述问题、使用者、使用方式和场景；未知字段为null。内容义务由当前项目声明，不固定要求人物、尺寸或骑乘图。

```json
{
  "expected_id":null,"source":"<意图来源>",
  "intent":{
    "schema":"retouch.business-intent/v1",
    "business_intent":{"problem":"用途不清","audience":"购买者","how":"说明安装关系","where":null},
    "obligations":[{"id":"usage","text":"看清商品如何使用","required":true,"source":{"artifact_id":"<用户原文spec>","quote":"<精确摘录>"}}],
    "rollout":{"mode":"sample-first","representative_ids":["usage"]}
  }
}
```

计划的step.coverage_ids声明该图承接哪些义务，冻结后的step.content_obligations进入宿主任务单和实际API提示词。提示词只是制作意图，不计覆盖通过。`coverage show` 和 brief.content_coverage 按实际候选、当前上下文、当前意图版本计算，分别返回PASS/FAIL/UNKNOWN/NOT_EVALUATED；未声明规范返回NOT_DECLARED，技术business_health保持独立。

run review的PASS还会核对当前步骤实际承担的必检内容；project close以achieved收口时须覆盖声明的项目义务，remaining/stopped保留用户对遗留或停止的明确选择。

实际看图后执行 `coverage review <media-id>`：

```json
{"sha256":"<实际hash>","contract_id":"<当前意图spec>","method":"host-visual","reviewer":"<实际复核者>","source":"<观察来源>","items":[{"id":"usage","verdict":"UNKNOWN","observations":"尚不能看出安装位置","evidence":"已检查候选全图，关键结构被遮挡"}]}
```

每个义务可由一张或多张图承接，一张图可通过多项。相同候选的后续检查追加历史并取当前项的最新判断；七张图、七条prompt或清晰度PASS均不自动覆盖用途。method支持human/host-visual/fixture，不隐式调用评估模型。

plan.stage为sample或expand，默认sample。sample-first下，expand计划及多步骤运行的后续dispatch须有代表义务的实际PASS。用户已明确要求直接批量时，rollout.mode可用direct-batch，并用user_decision引用用户原文spec的精确摘录；保留该选择，不重复审批。直接扩套仍不把未检查内容变成PASS。意图更新后旧覆盖检查保留且不计为新版本通过。

## E02 · 多来源冲突与补证

`conflict record` 追加原生evidence-conflict spec。同字段保留多个候选及各自value、subject（current-sku/reference-sku/unknown）、role、observed_at和精确source。状态初始unresolved；追加来源时传expected_id并重新打开争议，旧裁决不改写。brief.evidence_conflicts和 `conflict list` 直接展示最新未决点。

```json
{"expected_id":null,"source":"<来源>","conflict":{"schema":"retouch.evidence-conflict/v1","field":"carrying.mode","candidates":[{"id":"text","value":"手提","subject":"current-sku","role":"user-original","observed_at":"<实际ISO时间>","source":{"artifact_id":"<原文spec>","quote":"<手提原文>"}},{"id":"image","value":"固定于车架","subject":"unknown","role":"agent-interpretation","observed_at":"<实际ISO时间>","source":{"artifact_id":"<图片观察spec>","quote":"<安装结构观察>"}}],"research":{"purpose":"只核实影响本画面的安装方式","stop_when":"找到直接安装证据或保留概念边界","read_back":[{"artifact_id":"<已读原文>","quote":"<精确摘录>"}]}}}
```

先回读原文与图片观察，再判断当前任务是否依赖争议字段；不重复询问用户已经给出的参数。外部补证由宿主在实际工具和授权范围内执行，记录目的与停止条件；不会改变当前决定的背景调研可以跳过。

`conflict resolve <当前spec-id>` 的文件含source、status（selected/deferred）、decision：statement、reviewer、source、read_back。read_back须覆盖所有候选的原始引用。selected另给candidate_id和use：concept-reference/creative-choice/verified-fact。前两种仅记录创作/参考选择；verified-fact还须已通过现有product-facts确认规则。解析器不把“按推荐做”升级为商品事实。

plan只检查当前step.fact_keys实际依赖的争议。无关外观任务可以继续；概念方案附未知边界，实物准确步骤须补足确认。新证据只使依赖该字段的任务待复核，不把全部未知项做成审批清单。

## E04 · 商品保持项

`invariant set <task-id> --expected-revision <rev>` 文件为 `{"invariants":{"schema":"retouch.invariants/v1","items":[{"id":"holes","text":"保留一个孔","scope":"原图可见正面","required":true,"source":{"artifact_id":"<可靠来源spec>","quote":"<精确摘录>"}}]}}`。保持项必须声明适用范围；假设或AI重建不能作为确定依据。

`invariant review <media-id>` 与coverage review结构相同，contract_id指当前保持项spec。数量、成年人、颜色、结构、文字和遮挡可独立记录PASS/FAIL/UNKNOWN及观察；`invariant show` 汇总必检项。必检FAIL/UNKNOWN/未评估时，总体PASS、接受和交付不能绕过；候选保留，局部修补产生新媒体和新检查。可选项UNKNOWN不冒充必检失败，也不隐式调用模型。

保持项的文本和适用范围随计划进入宿主任务单和API提示词，原始来源留在本地审计。规范变化使依赖的计划待复核，并重新锁定相关任务节点；旧运行不能绕过新规范继续派发。

## E05 · 原生本地后处理

`asset transform <task-id> --expected-revision <rev>` 使用显式inputs（id/sha256/role）、input_id和operations。支持extract、mask、repair、composite、annotate、resize。所有输入、操作、坐标、Sharp/libvips版本、字体和实际输出绑定到原生local-postprocess execution及media.transform；多图父链和字体用途通过原生关系保全。

```json
{"input_id":"<主图>","inputs":[{"id":"<主图>","sha256":"<hash>","role":"商品原生图"},{"id":"<修补图>","sha256":"<hash>","role":"批准区域补丁"}],"operations":[{"op":"repair","input_id":"<修补图>","region":{"x":10,"y":10,"width":20,"height":20},"coordinate_system":{"width":200,"height":200}}]}
```

repair按批准矩形替换像素，矩形外的规范化sRGB像素不变；补丁须同尺寸。extract同样要求当前coordinate_system。mask使用输入蒙版亮度×alpha，保留透明孔洞；composite用input_id/x/y进行alpha合成，不悄悄缩放图层。resize必须给width/height/fit；fill还须显式allow_distort=true，不默许拉伸。

文字先用 `asset font --file <明确TTF/OTF>` 登记字体CAS。annotate提供text/font_id/font_size/colour以及region/coordinate_system，文本统一转义；从实际字体读取family并检查字符覆盖。缺字体、缺字符或文字越界明确失败，不静默替换。字体作为输入之一随上下文ZIP保全。相同渲染指纹下，同键重放读取已有输出；变更操作或指纹须新意图。本地流程不读取图像服务凭证、不发送图像请求、不改写原生模型输出尺寸。

## E06 · 套图快照与图片包

`suite snapshot <owner-task-id> --expected-revision <rev>` 文件包含name（稳定系列名）、expected_id（上次快照ID）和slots，槽位为id/role/media_id/sha256，数组顺序即显示顺序。创建时核对本项目、当前上下文和实际媒体，保存目标/需求/epoch绑定。替换和增补追加原生spec版本，旧快照可用 `suite show <id>` 查询；不靠“七图v2”等文件名管理正式版本。

`suite accept <snapshot-id>` 文件为 `{"source":"user","reviewer":"<接受者>","statement":"<用户接受原文>","slots":[{"id":"02","sha256":"<该槽位真实hash>"}]}`。只接受明确槽位范围，逐图生成当前上下文的用户接受事实。未改变的图可保留接受；替换后的新hash不继承，认可两张不等于认可整套。

`suite export <snapshot-id> --to <独立目标.zip> --file <选版.json>`；文件为 `{"mode":"preview"}` 或 `{"mode":"delivery","from_id":"<同系列较早快照>"}`。省略from_id为完整图包；指定时只包含新增/替换图。总览、图片与manifest来自同一个冻结快照和同一范围，清单记录精确hash和总览坐标。preview允许未接受候选并标状态，delivery要求选中范围已接受、保持项通过、当前适用、无未知请求且声明的内容义务通过。

图片包格式为retouch.image-preview/v1或retouch.image-delivery/v1，restorable_workspace=false；它不能冒充retouch.context/v2完整项目包。目标先预检，准备后失败保留原生回执；同键同路径恢复，不覆盖不同内容，完成后重放不改文件。图像请求为0，导出不会自动关闭图像任务。

## 交换、验证与范围

新增语义通过retouch-result-revalidation/v1、retouch-flow-contracts/v1、retouch-postprocess/v1、retouch-suite/v1能力声明保护。项目ZIP保留原生版本、关系、来源、字体CAS、逐项检查和真实进度；缺能力、跨项目引用、异hash或悬空来源拒绝。历史执行授权仍不能在目标home直接使用。

验证入口：`node scripts/test.mjs --suite engineering --ygl-entry <已安装入口>`，完整回归不加suite。复现缺陷的原草案脚本不作为“修复通过”；回归验证预期行为，包括未知请求保护、并发revision、旧接受隔离、同键重放、ZIP恢复、像素保持、文字转义、9图/2图包hash。隔离语义断言不代表真实商品内容已通过视觉验收，本轮不自动调用图像服务。

2026-11-15最终完整结果为22/22 PASS、零失败/取消/跳过，类型检查PASS。60份源码/测试/配置起止指纹一致，最终报告source_stability=PASS；两处SKILL入口校验通过。E01–E07均有当前源码的隔离验收，0次真实图像请求。原草案与复现材料保留原样；E01–E07沿用本地编号，本轮未新增GitHub issue。
