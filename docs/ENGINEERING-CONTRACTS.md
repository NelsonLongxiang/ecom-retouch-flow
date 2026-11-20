# 产品意图、证据和套图流程契约（E01–E07）

这七项来自2026-11-15的本地草案，以 `4c6d108` 为复现基线。E01–E07是本地需求编号，不是GitHub issue编号。本文是产品开发规范；实际项目的意图、冲突、保持项、候选复核、变换和套图选版仍保存在业务工作区的ygl原生工件中。源码文档和图片包不成为第二套业务账本。

所有命令使用 `node src/cli.ts`，传入 `--workspace <业务目录> --project <项目ID>`；写入带稳定 `--request-id`。JSON示例均为 `--file` 内容，真实ID、hash和来源从项目读取。评估结论必须来自实际观察；软件校验绑定、完整性和流程条件，不凭提示词或文件数量判断商品含义。

结构化意图、冲突、保持项和套图用本文专用命令追加版本，不通过通用artifact revise修改其受保护角色。历史仍用artifact show/history读取，普通design/spec继续沿用既有修订接口。

## 普通原生对象与修图元数据

ygl普通produce文档的空meta是合法的无角色记录，不应因参与brief／保持项／后处理上下文扫描而触发JSON错误。共用元数据读取只将缺失、原始null或空字符串映射为空对象；非空畸形JSON报METADATA_JSON，数组、标量及JSON null报METADATA_SHAPE，不能吞错后伪装reference／授权或已接受。

没有retouch上下文的普通治理task在brief中显示native_task／workflow_scope=native，不进入修图候选、接受、交付或修图next_actions；修图写命令仍要求合法profile，跨项目ID和伪profile拒绝且事务不追加领域事实。共用绑定也核schema／kind，使套图读口不能将伪profile展示为当前已接受。计划与待执行查询按项目读取工件，再统一严格解析meta，不用json_valid过滤洗白坏JSON。已有FAIL／UNKNOWN与真实CAS不改写。普通治理task的完整ZIP交换仍有独立兼容限制，外部relation／SNAPSHOT_TASK问题不在本补丁范围，不作为出图前置。兼容修复使用隔离的mixed-native专项，不代表历史全量重跑、真实业务恢复或生图执行；入口为`node scripts/test.mjs --suite mixed-native --ygl-entry <实际入口> --run-parent tmp/<任务>/runs --process-dir tmp/<任务>/check`。

## #26 · 文档修订的类型化失效传播

`artifact revise`继续校验当前ID/version/content_hash，普通原生治理task关联的design/spec可追加版本并继承关联，不补造retouch对象、不改普通任务的status/owner。真实retouch消费者及依赖闭包仍进入needs_review、锁回节点，已done者重新doing；声明了retouch但schema/kind/goal/requirements/revision/依赖类型无效者以安全类型码拒绝，不能按普通任务跳过。非空坏meta仍由严格metadata读取拒绝。原生文档/关系/task/node_state/领域事件和收据的回滚通过隔离快照比对核验，不从错误码推断所有版本均无副作用。

修订design只更新当前design_id属于该确切原生系列的直接消费者；decided-by等治理关联可触发复核，但不能将另一个已选择design指针替换为治理ADR。依赖任务只标失效，不继承上游design。旧版及关系保持，同键重放不重复追加版本或失效操作，异意图及stale请求继续拒绝；citation快照和受保护角色不可借通用修订改写。普通node-less治理task不能凭本修复成为retouch task-new支持的依赖节点；普通治理task的完整交换SNAPSHOT_TASK遗留不在本修复范围。

正式定向入口：`node scripts/test.mjs --suite document-invalidation --ygl-entry <已安装入口> --run-parent tmp/<任务>/runs --process-dir tmp/<任务>/check`。测试仅合成隔离home；坏profile/JSON故障注入只操作测试自身数据库，不修改真实业务记录。

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

Issue #11 在既有接口上补充 [购买决策叙事与返图观察](NARRATIVE-WORKFLOW.md)：先参考/事实、矩阵与整套低成本分镜，再按风险选代表样张；观察指向具体商品对象和义务，保留合法包装、无人白底等正例。原生接口保存真实观察，不自动判断图片语义，不改变sample-first/direct-batch授权边界。

Issue #16进一步提供[物理参数→结构/成像→可视参考→生成/回接→观察修订](PHYSICAL-REFERENCE-WORKFLOW.md)的公共方法，复用facts、design/spec、references.purpose与保持项；六层语义和参考冲突由Agent按正文核对，不引入新schema或自动毫米校验。

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

相对一致性与绝对精度用不同invariant id和观察记录，允许相对FAIL与绝对UNKNOWN同时存在，聚合仍由既有必检门禁决定。适用scope/required在观察前按真实任务声明，不能事后删除失败或降级精度要求放行；可比证据不足为UNKNOWN，未提交检查保持NOT_EVALUATED，NOT_RUN是未观察的验证状态而非新增接口枚举。详见[截面分项方法](PHYSICAL-REFERENCE-WORKFLOW.md#相对截面一致性与绝对毫米分项复核)。

保持项的文本和适用范围随计划进入宿主任务单和API提示词，原始来源留在本地审计。规范变化使依赖的计划待复核，并重新锁定相关任务节点；旧运行不能绕过新规范继续派发。

## #18 · 当前SKU一致性与受保护产品层

product-accurate任务必须通过保持项中的product_consistency（schema=retouch.product-consistency/v1）绑定当前SKU、master.media_id/sha256、basis.artifact_id/version/content_hash/quote、相容view和qualification；basis须为可靠user-original/confirmed-fact且摘录覆盖SKU、母版hash、视角及合格依据。immutable_ids与must_prove_ids引用当前必检items，allowed_changes列有限kind/conditions。未声明契约不进入实物准确派发，已有任务也不能通过改plan.purpose降为concept绕过。

reference／whole-image路线在每步实际输入或references中包含该确切母版，职责为product-structure；不能仅登记过或只写colour-only。计划、宿主job和API上传准备绑定同一契约版本/hash及角色；软参考不承诺模型硬锁。protected-layer路线可只请求环境，但最终必须以本地product-composite完成产品合成并验证最终字节。

protected-layer还须绑定mask、visible_regions及有限compositions配方（id、canvas_width/height、x/y、等比width/height、明确PNG或JPEG编码，可选前景）。首版只支持平移、等比缩放和显式遮挡；不能用一张平面任意透视伪造三维。所有母版、mask、前景都在asset transform.inputs声明真实ID/hash/role，product-composite是唯一最终操作，并携带contract_id/version/hash及recipe_id。必证区域须可见，来源、renderer及最终输出的确切对象均核对；同字节换ID不继承证明，之后crop/resize/融合或正式套图output_profile也不自动继承。

检查、接受、交付完成、缓存复用及ZIP封包检查均保留对应门：晚到required FAIL拒绝完成且不补写完成回执；重新构造最终PNG/JPEG字节，而非仅信任声明的父链。retouch-product-consistency/v1能力保护完整交换／clone；历史授权不变为新执行权限。普通治理任务交换SNAPSHOT_TASK遗留仍单列，不由本特性扩修。软件绑定检查不能证明母版真实资格、隐藏结构、毫米精度或用户视觉接受。

定向入口：


```text
node scripts/test.mjs --suite product-consistency --ygl-entry <已安装入口> --run-parent tmp/<任务>/runs --process-dir tmp/<任务>/check
```

该套件包含产品层、原三项边界（真实loopback multipart／晚到FAIL／等字节异对象及renderer漂移）、元数据兼容、received纠错和runner证据回归；原始请求及全部part在断言前独占留证。原独立2/3缺证据报告保留，不追认为PASS；新的开发与同SHA独立复验分别记录，真实服务/视觉/用户接受另验。

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

Issue #12 的 [快照输出编排](SNAPSHOT-OUTPUTS.md) 在suite export上增加可选有限output_profile。旧单ZIP模式不变；新模式目标为独立组件目录，声明式原比例PNG、contain方形sRGB JPEG、变高整页/crop长图、轻量阅读/总览/说明共用冻结选版；extend/encode复用原生postprocess。组件逐个独占发布、完成清单最后写入，准备后故障按committed同键恢复，不声称多文件事务原子性。属主确认首版超限只reject、不纳split；输入与全部计划派生合计5000万像素的渲染前准入不等于RSS安全保证。seal后及每个组件/marker前重新核只读原生门禁；marker仅字节完整，当前业务交付仍需原生状态/接受。所有图片包均不可恢复工作区。

## 交换、验证与范围

新增语义通过retouch-result-revalidation/v1、retouch-flow-contracts/v1、retouch-postprocess/v1、retouch-suite/v1能力声明保护。项目ZIP保留原生版本、关系、来源、字体CAS、逐项检查和真实进度；缺能力、跨项目引用、异hash或悬空来源拒绝。历史执行授权仍不能在目标home直接使用。

验证入口：`node scripts/test.mjs --suite engineering --ygl-entry <已安装入口>`，完整回归不加suite。复现缺陷的原草案脚本不作为“修复通过”；回归验证预期行为，包括未知请求保护、并发revision、旧接受隔离、同键重放、ZIP恢复、像素保持、文字转义、9图/2图包hash。隔离语义断言不代表真实商品内容已通过视觉验收，本轮不自动调用图像服务。

2026-11-15最终完整结果为22/22 PASS、零失败/取消/跳过，类型检查PASS。60份源码/测试/配置起止指纹一致，最终报告source_stability=PASS；两处SKILL入口校验通过。E01–E07均有当前源码的隔离验收，0次真实图像请求。原草案与复现材料保留原样；E01–E07沿用本地编号，本轮未新增GitHub issue。

## #24 · 六动作恢复契约现状矩阵（C0）

本节为当前已读实现与证据映射，不是统一SDK已实现或本轮运行全部故障矩阵。固定功能源码基线为 `6e535978f5dc7aafa079c8c2117d50fa7d393a12`（PR27）。上游 [#296](https://github.com/NelsonLongxiang/ygl-trees/issues/296)／[#297](https://github.com/NelsonLongxiang/ygl-trees/issues/297) 在核查基线 `62559ef4aa5f41519e3bc24525c4b84f2143394d` 为OPEN；没有可消费首片的验收证据，不自动升级当前0.125绑定。

共享准则：现有 retouch.command 收据保存在原生 events；请求意图 digest 覆盖 action/body，请求键按该home现有范围查询，不把现状冒称已实现上游跨project/namespace复合事务合同。同键历史结果不证明当前执行资格；不自动重发。CLI启动/传输审计与业务事务分开判断。六动作共同核对local_commit（committed/not_committed/unknown）、cleanup/output、external_state和原workspace/project/request_key/run查询身份。未发送只在有证据时not_sent；这是逻辑矩阵，不声称0.125已有SDK envelope。

| 动作 | 身份 | 前置 | 幂等 | 副作用 | 恢复 | 完成依据 |
|---|---|---|---|---|---|---|
| 修改上下文 | workspace/project/task、goal ID/version、task revision/epoch | 当前规范/可用引用；unknown先对账 | 同键/意图返回历史结果；异意图拒绝 | 原生事务内更新task与关系/节点，旧媒体/接受不覆盖 | 读task与原receipt；不凭旧receipt推断新epoch已资格通过 | 当前task绑定和失效闭包；#26仅更新确切消费design系列 |
| 派发 | workflow execution、冻结plan、input/reference IDs/hash/role、本workspace grant | prepared、当前goal/requirements/contract、有效授权 | 同key重放不是新allow_execute；已dispatched/unknown不得换键重发 | 本地dispatch意图可先提交，外部动作在其后，非跨系统原子事务 | 先查原key/run/实际外部回执；unknown不是not_sent | 当前运行意图与实际执行事实分开；提供商受理不等返图/质量 |
| 接收 | run、确切raw/processed/candidate media/hash/parents、原API回执 | 已接收身份与当前输入；保全原件 | 原键重放一致来源/输出；变来源拒绝 | CAS/落盘可先于原生回接；received不是accepted | 原件已存登记失败只补登记/本地恢复，不再请求提供商 | 原生结果注册、实际hash/父链/尺寸；仍待观察/保持项/采用 |
| 接受 | task/plan、候选ID/hash、goal/requirements/epoch、来源 | qualified接受仍要求当前适用、逐项必检PASS和明确用户依据 | 同键无重复review；旧接受不转给新图/上下文 | review/accepted-by在原生事务；业务采用另层 | 历史决定可读但不恢复新执行权限；不能补造用户原话 | qualified_acceptance与business_adoption分开，source=user非身份鉴真 |
| 发布 | delivery/sealed components、当前task/plan/媒体与目标 | 目标预检、当前接受/保持项、seal与marker前复查 | 原键同目标恢复；完成只读验证，目标异内容拒绝 | DB事务不覆盖FS；部分组件/EIO/EXDEV有已提交副作用 | 完整已发布组件核原生seal/CAS/manifest后补complete，不重渲染 | 磁盘marker仅冻结字节完整；原生completed/current检查与业务接受另核 |
| 导入 | package fingerprint/schema/capabilities/project/CAS | inspect严格校验；restore/clone显式策略 | 同snapshot不回滚本地进度；历史grant隔离 | CAS保全可能早于DB，失败可留未引用字节；非总零写 | 核原fingerprint/receipt/目标冲突，不删原件重试 | 原生图/工件/关系与能力齐全；导入不授执行/接受/下批许可 |

当前六动作源码入口（固定父基线，行号随之后修复变化）：[上下文复核](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/plugin/commands.mjs#L1928-L1951)、[派发](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/plugin/commands.mjs#L2743-L2820)、[接收](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/plugin/commands.mjs#L3146-L3220)、[接受](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/plugin/commands.mjs#L3311-L3363)、[套图发布](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/plugin/flow-commands.mjs#L567-L682)、[导入](https://github.com/NelsonLongxiang/ecom-retouch-flow/blob/ed46eb3a3b6f8982e20d5763ad83d9974b2e2146/src/native/exchange.ts#L392-L474)。相关新#26修订见本页该节，其余动作没有在本次文档中重新实现。

### C1 已有证据与真正缺项

- 同键/异意图、stale版本、旧context/接受：[native-documents](../tests/native-documents.test.ts)、[invalidation](../tests/native-documents-invalidation.test.ts)、[mixed-metadata](../tests/native-mixed-metadata.test.ts)已有具名断言。#26最终开发25/25于run-9OB4LM，包括4类consumer×spec/design和明确领域快照范围的回滚（artifacts/relations/nodes/node_state及非cmd.run事件/收据）；同SHA独立run-psZlKy也25/25exit0，结论PASS_INDEPENDENT_SOFTWARE_SCOPE；原完整报告SHA256 da2dadff694d85202b0f2787287c501d085a91ebb8ef020dbce45bf60f097c64，102输入digest `8e0fb1dbc2d34723e56305332f06c1370bb34504dd2500e746d9e5577d5a0ed8`，独立原始run-psZlKy SHA256 `bc49be574c0320be74224356dcf6bc9ca3387bffae5799b97ed33f7ef9682ded`，该门仅#26及直接消费者。PR23的run-boBrKy与独立run-bzKyyn 24/24仅其确切受验字节，不移作#26全量PASS。其软件受验提交 `ed46eb3a3b6f8982e20d5763ad83d9974b2e2146`，101输入digest `10681fe2af6f8ab8f89ab8b90dba18dcbb78e6df64273a158b9143499a9d84b2`；独立原始报告SHA256 `820898faf6f2f4826f601f9fda7648d8b3f9585e52110c917d472bb71418ad42`。更早API/发布矩阵的原scope与完整报告身份见[验证历史](verification/README.md)，存在旧报告不等于本次C1运行。
- 外部已发unknown、received本地恢复、同键不重发：[native-api](../tests/native-api.test.ts) 与 [physical-reference](../tests/native-issues-physical-reference.test.ts)有fixture。已知历史PR20/PR15报告保留原范围，本轮未重跑API全场景，不凭测试名记本轮PASS。
- 发布中失效与只补complete：native-outputs-contract/recovery已有after-seal/after-data/after-marker-check、模拟EIO/EXDEV等；marker存在≠原生当前完成。新#26未重跑该矩阵。
- 导入历史授权隔离：received纠错与product-consistency隔离ZIP/clone有原报告；普通governance SNAPSHOT_TASK/外部rel遗留另列，不能借C0宣称所有项目可交换。
- 发布恢复已有证据的确切时点：[outputs-recovery:37–42](../tests/native-outputs-recovery.test.ts#L37-L42)在调用suite-export-complete前抛出synthetic lost completion request，证明已发布组件之后、原生完成调用未执行时的恢复；不等同于DB已commit而客户端响应丢失。后者仍待明确故障注入，不能把两者合并记PASS。
- 钉住0.125的原生writes.runTx（安装版0.125:73–105，属于外部钉装依赖）亲读可见整回调SQLITE_BUSY重入（最多初次加4次），提交后事件best-effort发出；当前retouch在该事务回调内还执行verifyProductPixels等CAS读取/像素重建，不能称纯DB回调。已有只读、固定hash的重建不等于已发收费请求，但未来#297数据库-only callback合同须评审这类读取与重校验的位置/一致性；不本轮改架构或盲搬到事务外而制造TOCTOU。实际重入次数及无副作用仍NOT_RUN。
- 真正待证：commit后响应丢失且原key可恢复的指定原生故障注入、0.126 cleanup/local_commit映射、回调忙锁重入次数、派生缓存丢失后的最小重建。先给具体可判红输入与实际合同，不一口气重复旧全量。原媒体CAS/业务原件不得当缓存删除。
- C2仍依赖上游#296/#297的已评审版本化schema/capabilities/可固定消费实现。当前retouch仍锁0.125；不改shared安装、不deep-import新SDK、不让插件持锁递归CLI。跨领域research/task运行未取得，NOT_RUN。

## #25 · 业务采用分层设计提案（未批准／未实现）

决策级别：公共语义P1候选，已做独立方向评审，公共语义仍待属主必要裁定；本提案不实现命令。推荐使用原生 kind=review、专用 role=business-adoption（名字候选），由专用受限领域动作追加，不复用accepted位、不把任意user-original spec或decided-by关系都提升为当前采用。

候选写入逻辑在一个原生事务中核：workspace/project，合法retouch task，精确goal ID/version、requirements hash/context epoch，media ID/hash（adopt须当前适用；reject/revoke可精确引用历史链头而不恢复适用），冻结业务scope（scope_id+描述hash+purpose+batch+完整成员ID/hash），decision=adopt/reject/revoke，人工来源原件的artifact ID/version/content_hash/quote、记录者与原话。role/source声明仅证明来源绑定一致，绝不称密码学身份鉴真。

- 每个精确subject binding+scope_id是一条追加链。调用须携previous_decision_id（首条null）；事务内比较该链最新项，竞争/过期明确冲突。顺序以该原生链为准，不以用户可填时间或跨题max(version)抢权威。不得同title跨subject错误合并。
- P1推荐：revoke追加revoked/needs_review终态，不寻找最近未撤销项；adopt A→reject B→revoke B不能复活A。adopt要求当前适用；reject/revoke可精确针对旧epoch链头但只产历史决定，不使旧图重新适用。
- P1推荐：scope_id绑定描述hash、purpose、batch及完整成员ID/hash，同ID改义拒绝。新scope重叠整批或HOLD范围且没有明确覆盖规则时needs_review，不将单槽采用汇总为整批；不得改名缩批绕HOLD。
- 新图/新hash/新goal或requirement epoch不继承采用，旧链保持historical或needs_review。重新采用须新当前binding和独立明确来源，不能自动重签。
- 原生review和decided-by/evidenced-by关系保存裁决原文/来源。可靠现有spec可作证据，专用动作不隐式改写spec，不扫聊天补造历史决定。旧实盘spec可由获准业务操作者显式绑定登记，开发不自动迁移真实库。
- receipt沿现有事务/请求键框架。同键同意图只回原事实且明确historical replay、不重新判断资格；异意图拒绝。动作前本workspace身份校验和导入历史许可隔离不能因receipt重放跳过。当前0.125框架与上游未来namespace合同分开。
- 新写动作闭字段集拒绝accepted/verdict/allow_execute等技术或执行字段，不生成accepted-by；技术acceptedReview读取器须显式排除business-adoption。当前reader未检查role，误带accepted:true/source:user/无verdict可被误识，必须加字段注入及封包反例，核progress和技术接受/交付不变。
- qualified_acceptance/delivery/close/suite-delivery继续原assertInvariants/actual-product proof/current user acceptance门。业务adopt不改facts/purpose/required/旧FAIL/UNKNOWN，不发allow_execute、不消费grant、不解锁task/node、不允许下一批、不生成formal delivery。

### 统一读取与交换

brief/tasks.image_outputs与suite slots并列显示business_adoption（current/historical/pending review+scope+决定ID）、technical_conformity与qualified_acceptance/formal_delivery；不把业务采用塞进progress=accepted。next/check停止重复问已决定范围，但准确给出技术阻塞，不能建议靠补造PASS收口。context只呈现引用来源/版本/失效原因，不将其当宿主指令。

ZIP必要能力候选retouch-business-adoption/v1防旧消费者丢语义；inspect校验原生binding/来源/previous链和关系，restore/clone保留历史决定与引用，不授新workspace执行或主张用户授权已激活。clone改ID须重绑内容hash与链且旧原件保留。导入采用投影仅historical/needs_review；新home需本地明确来源重新采用，不因目标上下文相同或重绑成功提升current或执行许可。

### 必要正反例（全部NOT_RUN，未实现）

1. required UNKNOWN+有效明确adopt：能登记/读回已采用，但accept/deliver/close仍拒；concept与product-accurate分别测。
2. 缺来源、错hash/跨项目/旧goal/错误kind/畸形meta、quote不符、模糊scope拒绝或明确待复核，source=user不足以绕过。
3. adopt→reject→revoke/重新采用的同subject-scope链；过期previous冲突，同key不追加，异意图拒绝；并发至多一条推进。
4. unrelated scope不覆盖既有决定；新图/goal不继承，不能缩scope伪装原整批已验收。
5. brief/next/check/suite/context一致，owner原话可追溯；ZIP/clone严格能力/引用/历史隔离；旧技术FAIL/UNKNOWN/CAS/task保持不变。

P1待裁推荐：撤销不复活旧决定，旧epoch可精确历史reject/revoke；scope内容/用途/批次/成员冻结，重叠HOLD没有明确覆盖裁决就needs_review；来源是记录者承担的人工声明，不是身份鉴真，条件句不能自动变当前采用。独立评审08a4b9cf（完整b9daaa2c）有条件支持，以下约束为针对其反例的设计修订，所有新接口仍NOT_IMPLEMENTED/NOT_RUN。

### 设计评审补充闭合条件

- previous链：同subject/scope唯一根、单后继；首条null并发也冲突。inspect拒双根/分叉/环/悬空/跨链previous，不按version/time任选一条洗白。
- 来源：quote须支撑精确subject/scope/decision；“改好后可以采用”等有条件原话只能pending review，不能仅凭字面匹配记adopt。
- clone：保全来源原字节与原身份，ID映射另列、目标引用显式重绑；不递归改写原话。imported adopt只能historical/needs_review，新home重新采用须本地明确来源，不能凭重绑或同epoch提升current；workspace前置不得被通用receipt提前返回跳过。
- 必需补例：业务role注入技术字段仍不技术接受；adopt→reject→revoke不复活；epoch变后历史撤销；同scope_id改描述/成员拒绝；子scope不汇总原批；坏决定链/导入历史/条件来源拒绝。
- 不新增认证系统、范围推理器或第二ledger；独立方向审查不是属主P1裁定或实现验收。

本节只记录契约盘点与候选设计；源码读口的字段注入是新设计必需反例，不声称当前不存在的business-adoption动作已造成生产接受绕过。正式规范中的现有accepted/交付合同不因提案改变。#25实现、#24 C1新增故障执行和C2迁移均未在此文档增量执行。C0完成的是当前范围盘点与引用，不代表C1所有故障已覆盖；C1各待证项仅列退出判据，不因本页入册自动启动执行。
