# 同一快照的有限输出编排（Issue #12）

本入口复用原生suite snapshot、asset transform、execution/media/delivery和CAS，不建第二套账本。软件只保证明确的配置、身份、派生和字节检查，真实视觉与用户接受仍单独验收。

> 属主已明确确认首版契约：可选有限profile、组件目录target、逐组件独占发布/完成标记最后/同键恢复；超限仅reject，不纳入split；去重输入与全部计划派生图合计最多5000万像素。当前实现仍为Draft待复验，不推导合并、发版或真实业务执行授权。

## 入口与兼容

现有suite export无output_profile时仍生成完整/增量原图ZIP，不变更E06接口。传入output_profile时，--to是**新的独立组件目录**，不是单个ZIP路径：

    node src/cli.ts suite export <snapshot-id> --workspace <业务目录> --project <project-id> --file <输出配置.json> --to <新的组件目录> --request-id <稳定键> --json

目录位于业务工作区之外，父目录须存在且不能经链接改向，已有异内容/异键目标不覆盖。同键恢复只复用逐组件字节完全相同的文件；准备后的错误返回committed与delivery_id，不能称无副作用。

## 配置

    {
      "mode":"preview",
      "output_profile":{
        "schema":"retouch.suite-output/v1",
        "design":{"artifact_id":"<已读叙事design>","version":1,"content_hash":"<实际正文hash>"},
        "order":["recognition","usage","gift"],
        "gallery":{"size":2400,"padding":40,"background":"#ffffff","quality":90},
        "long":{"width":1600,"gap":24,"background":"#ffffff","max_pixels":50000000},
        "reading":{"width":800,"quality":80},
        "overflow":"reject"
      }
    }

- order明确包含本次选中全部槽位且不重复，顺序来自已读叙事design，不由工具按文件名猜。增量仍可用from_id，但order仅列该次新增/替换范围。
- 当前编排为1–29页（受现有transform多输入/操作预算约束），不是业务图数模板。旧suite快照仍支持其原范围。
- design固定当前原生ID/version/hash；文档过期先实际复核，不静默换正文。
- 图库边长16–6000，留边小于半边长；long宽16–6000、gap 0–1000，整个长图最多5000万像素且须在声明max_pixels内。reading宽不大于long宽。
- 渲染前聚合预算为50,000,000计划像素：去重输入源＋每槽位canonical/图库/长图页＋合成长图＋阅读图＋总览。每项乘法/求和须安全整数，超限OUTPUT_RESOURCE_LIMIT并列分项、总量和减尺寸/分批建议，在prepare、CAS新派生和像素分配前拒绝，不静默降画质。这不是实测RSS/峰值或绝对不OOM保证；单图/ZIP/文件限制继续各自生效。9张2400方图仅图库就超过预算，须降低尺寸或分批。
- 背景显式#RRGGBB、JPEG质量1–100。未知字段、HTML/代码、任意表达式/模板不支持。
- 页上文字/字体复用原媒体；追加标题等先走已有asset font/transform，编排不临时找字体或编造业务文案。

默认完整页，不cover裁商品、不fill拉伸。可选crops按槽位给裁切和精确来源，放在output_profile内：

    {"crops":{"usage":{"region":{"x":0,"y":0,"width":1200,"height":800},"coordinate_system":{"width":1600,"height":900},"approval":{"artifact_id":"<用户原文spec>","version":1,"content_hash":"<实际hash>"},"quote":"<批准该范围的精确原文>"}}}

原文角色须user-original，版本/hash/摘录必须吻合，区域在实际输入尺寸内。坐标明确使用源媒体编码像素宽高，不隐式应用EXIF旋转后的显示坐标；规范PNG不自动旋转，错误的交换宽高坐标拒绝。裁切operation/trace固定源media/hash、坐标、批准ID/version/hash及摘录；批准来源变化会产生独立执行/媒体溯源，像素相同仍可复用CAS字节，不继承旧接受。不自动推断“用户希望好看”就是批准切商品。原比例PNG和图库仍保留整页，crop只适用于明确的长图页并在trace/manifest留存。

## 输出与派生

一次冻结选版形成：

- 原比例规范sRGB PNG：保留整页宽高和来源，不冒充模型原始字节；原生结果仍在CAS。
- 图库：2400可配置的contain方形JPEG，完整页等比适配、显式留边，嵌入sRGB ICC。
- 高清长图：声明顺序、变高整页或批准crop，固定宽度等比缩放，记录每页位置/源坐标，不把方形图库机械堆叠。
- 轻量reading JPEG与总览JPEG；普通Markdown说明和精确manifest；无动态HTML。

派生由既有asset transform产生，media保留父链、实际尺寸/hash、操作trace与渲染指纹。新增有限操作为extend（非负边距/背景，受像素预算约束）和encode（PNG/JPEG、sRGB、JPEG质量与透明背景合成颜色）；不是新万能DSL。

原生postprocess请求身份由项目/任务当前binding、输入ID/hash、操作与renderer派生，不含整个snapshot的无关变化。相同页和配方复用已有execution/media/CAS；局部替换只重做依赖该页的输出。完成同键重放校验全部组件，既不重写未变文件，也不新增业务记录/图像请求。

过期媒体不因渲染换goal或复制成当前候选。先task context-review、实际artifact revalidate adopt/reject，再冻结新suite；旧接受不继承。preview可包含当前但未接受候选并标状态，不能冒充delivery；delivery仍核对接受、覆盖、保持项和未知请求。

## 首版超限拒绝与完整性

不放松ZIP 32MiB单条、数量、总量、压缩比及路径安全限制。高清long-hd.png超单条时：

- overflow=reject 是首版唯一可执行策略：给对象ID/实际字节/限制以及降尺寸/分批建议，不发布新正式目标；已登记准备与派生不叫“零副作用”。
- overflow=split 不纳入首版，新请求在prepare/CAS派生/正式路径前以OUTPUT_SPLIT_UNSUPPORTED拒绝；历史未完成split回执不继续执行，保留原delivery_id并如实committed。历史已完成回执可核原文件/读取审计，不形成新split执行权限，旧工件/旧包不改写。

首版不自动外置任何文件；超限页或长图须降低尺寸/编码或分批，不静默省略。像素预算在渲染前判断；精确压缩大小在发布前判断。context export继续按CAS/ZIP限额诊断；含超限对象时拒绝，不省略后冒称完整可恢复。

组件先在工具工作区tmp/suite-outputs的独占暂存区写入校验（正式目标须与其同卷，跨卷明确失败），正式组件以独占hard link逐个发布，components.json最后发布；**不声称跨文件或跨文件系统事务原子性**。中断可能留下preparing事实和部分组件目录，只能同键同路径同配置恢复，异内容拒绝覆盖。原生completed与全部组件校验一致才算导出成功。seal返回之后、正式目录创建之前，以及每个组件/marker发布之前都会重新运行同一只读原生当前性/接受/覆盖/保持项/unknown门禁；不使用幂等seal回放假装重新检查。seal后失效无正式组件，数据文件已发布后失效保留该部分文件但拒marker。原生数据库与文件系统不在同一事务，不能承诺任意外部写入时序都不会在最后一次检查后改变事实。

发布前先在同一个原生delivery保存精确组件/hash和媒体清单（suite-export-seal），不新建账本。已发布components.json但complete未成功时，恢复先核原生封存、marker、review.zip内清单、每个必需组件及原生媒体/CAS；全部吻合才只补原生complete，不调用postprocess、不重写ZIP或进入渲染暂存。磁盘自身清单即使与伪造ZIP相互一致，也不能替代原生封存。旧开发包缺少封存时保留现场并明确拒绝自动猜测完成。marker还未发布的部分目录仍走原同键恢复，exclusive写入不覆盖异内容。

完成后的重放只核历史完成文件，不是重新授权或声明已适配新上下文；新当前交付仍须新快照、实际接受和所有现行门禁。封存和裁切溯源使用context必要能力retouch-output-recovery/v1；clone把源封存转为不可执行的历史来源，不从旧目标路径恢复授权。

组件marker的authority=frozen-bytes-only，含native_delivery_id、requires_native_current_check=true、not_business_acceptance=true；只证明冻结selection的组件字节齐全，不权威声明实时current、用户接受或native completed。消费者必须另读原生状态与当前接受范围；只拿离线包不得宣称当前业务验收。

图片包始终restorable_workspace=false，context inspect/import不会把它当retouch.context/v2。用户接受、任务关闭、上架/部署不由导出自动产生。

## 验证边界

专项入口为node scripts/test.mjs --suite outputs --ygl-entry <实际入口>。覆盖不同页数/比例、实际PNG/JPEG尺寸/ICC、单页复用、来源/裁切/过期拒绝、重放/恢复、实际超过32MiB合成随机像素长图的发布前拒绝、新split零副作用拒绝、5000万聚合准入及seal后当前性反例；完整回归包含这些场景。零真实图像请求；fixture和本地文件验证不等于真实商品视觉、独立盲复核或用户接受。
