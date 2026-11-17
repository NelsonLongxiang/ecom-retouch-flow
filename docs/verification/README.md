# 验证与复现

## Issue #18 · 当前实现候选与验证边界

后续已在新分支实现[当前SKU一致性与最终产品层](../ENGINEERING-CONTRACTS.md#商品一致性与最终产品层)：复用invariant spec钉可靠母版原文/视角/资格/hash、不可变必检、允许变化与必证内区；plan冻结并在每次dispatch核实际结构参考。protected-layer按有限配方固定mask/坐标/等比尺寸/前景/最终PNG或JPEG，原生从CAS重建实际最终字节。参考登记、父链或总体美感不能替代保护与语义复核。

| 本轮证据 | 实际结果与原范围 |
| --- | --- |
| 初始原生红测 | product-accurate无一致性规范仍能冻结计划，预期拒绝缺失；正式入口失败现场保留 |
| 类型检查 | 原第1次Buffer诊断FAIL及各候选旧type结果保留；属主另准仅1次最终type，第4次真实exit0、空诊断、84输入稳定，钉最终b3afbc85候选。该一次许可已消耗，不授更多重跑 |
| #18专项 | 第2/3次各3/3 PASS，均保留原始输入身份；不自动覆盖后续R3/惰性加载/最后测试修订 |
| 首次全量run-EFkce8 | 83项81pass/1原生调用unknown/1场景180秒取消，输入稳定。隔离crop有prepare与部分派生，最后派生prepared且无complete/seal；未将unknown当未执行重放 |
| 最终开发全量run-jCLJiq | 83/83 PASS、exit0、fail/cancel/skip/todo0，84输入起止/最终候选一致，11类领域原件PASS；报告SHA256a3b1df611741d43951eb61c4382cbb2315d181cd5e21f28ad2edd7ae4fd03111 |
| 独立运行复验 | 官方full83/83 PASS exit0、84输入稳定、11域原件PASS；一次targeted2/3 exit1，首case探针LF分段断言失败且断言前未存multipart原件，母版实际上传/职责/重放后续证据不足；最终结论INCOMPLETE_INDEPENDENT_ACCEPTANCE，不授软件验收done |

最终运行候选b3afbc85…及84输入digest e132e2d1…不是Git提交。R3将结构参考purpose固定为product-structure，编译器不再拼相反自由用途，正式用例比较完整参考段落；Sharp只在产品render/verify时惰性加载，实际渲染器/CAS/exact-byte门仍核，耗时收益未测。缓存收口场景只调整总时限180→600秒，单CLI60秒、全部断言和产品上限不变；原unknown现场和FAIL报告保全。

软件受验84输入保持冻结，仅状态摘要更新。独立原件independent-issue18-eca9af81 SHA256c45363cf9e254789b595bddd70d56ada4108deda14922bb391ea8f3e82fbf102和21份保全文件已核，原报告类型NOT_RUN是其生成时事实；后来明确获准的最终类型PASS单列，不改原报告。追加一次独立失败case补证确认超时未批准，未补跑。属主又明确允许仅将当前在途改动以未合并Draft保全以交回共享检出，再从已交付基线独立纠错；这不是验收放行或部署。真实商品视觉/毫米/隐藏几何/模型/收益仍未验，不自动关闭issue/发版。

## 已交付基线的开发与独立软件验收

2026-11-17，本轮在用户明确批准的有限执行窗口内，以Node24.12.0、已安装的ygl-trees0.125.0及项目正式入口，完成了真实开发门禁。使用隔离原生home、本机HTTP模拟服务与合成图片，不访问默认业务库，不改共享宿主，不调用真实图像或收费API。

| 门禁 | 实际结果与范围 |
| --- | --- |
| 语义类型检查 | 最终第4次编译器退出码0，完整诊断日志为空；80份源码/测试/配置/方法输入未变 |
| outputs专项 | 第3次33/33 PASS，退出0，失败/取消/跳过均0；原生尺寸/ICC/血缘、缓存、恢复、reject-only/像素预算和发布时序证据通过 |
| issues专项 | 第2次9/9 PASS，退出0，失败/取消/跳过均0；包含#16方法/facts/参考/计划接手、在途保护、引用更新、ZIP恢复与源权限隔离 |
| 完整原生回归 | 最终第2次80/80 PASS，退出0，失败/取消/跳过/todo均0；80份输入起止与当前磁盘一致，source_stability=PASS，十类领域证据全部PASS |
| 独立复验 | 原检测席亲跑同字节官方全量80/80及一次有界针对性3/3，均exit0，fail/cancel/skip/todo0；80输入起止/开发原件/最终磁盘一致，十域原件吻合，结论PASS_SOFTWARE_SCOPE |
| 真实商品与模型 | 实际生图、模型服从、物理毫米准确、独立视觉/用户接受及跨SKU收益均非本轮开发门禁结论 |

本机不可变报告标识：全量run-6HlWNt（SHA2561388e5672db3a51ac08cb1da66f526c96647162a1861d91315a11b049ef9174f）、outputs专项run-P8haml、issues专项run-bsWCJX。原件、TAP、stderr、开始/结束指纹及实际退出事实按本页下方规则保存在本机验证目录；机器JSON不随公开仓库分发，标识不是可下载报告链接。独立检测须亲读原件和当前磁盘，不以摘要代证据。 独立原件为independent-7a7e49e1（SHA256003b9511cad45876904abf675b0e165f34ac29d67214d8ffd83bfff274063af4），独立官方全量run-5xg4xl（SHA256628ef9532d8cc7c370c1976a8569f3a45ad54a9252befc5d9691094501340897）。本席已亲读完整报告、TAP、探针、十份领域原件并比对22份保全文件，未以320字A2A摘要放行。独立类型检查未另跑，开发编译器结果单列。

## 独立发布竞态与未验证边界

针对性一次执行包含after-seal、after-data、after-marker-check三个真实NativeClient/隔离数据库及Sharp/CAS场景。前两者检测到过期后拒绝新marker；最后一次成功check返回后立即改变需求时，marker可能已落盘，但完成命令返回SUITE_MEDIA_STALE、原生仍preparing且无complete回执。marker明确frozen-bytes-only、requires_native_current_check、not_business_acceptance；这不是文件系统/数据库跨域原子事务，也不提供只凭磁盘marker认定当前业务完成的保证。软件验收包含此限制，不把旧独立seal后FAIL改为历史PASS。

上述是eb55a962已交付基线的范围；后续[P1 #18](https://github.com/NelsonLongxiang/ecom-retouch-flow/issues/18)的原生实现、最终83项运行PASS、类型待验及独立运行状态单列在页首。旧80项和独立PASS不覆盖新字节，也不证明真实产品层视觉保真。

## 原失败、预算修正及隔离边界

| 原现场 | 原结果，原报告不改写 | 最小修复及保留判据 |
| --- | --- | --- |
| 早期类型检查 | TS2554：渲染夹具artifact查找缺项目参数；Bash退出采集被PowerShell解释，准确编译器exit未知，外层0不记PASS | 补项目参数；本轮采用真实PowerShell的$LASTEXITCODE独立采集，修后类型检查真实通过 |
| issues首次run-kfe2XD | 9项8pass/1fail，首次预期成功请求在100ms内API_TIMEOUT；隔离DB只1次派发/unknown，无接收和重发，输入稳定 | 成功profile5000ms与故意超时profile100ms分开；负例500ms延迟、requests==2、unknown、迟到回接和received本地恢复/不重发断言保留 |
| outputs首次run-WO2eEs | 33项32pass/1cancel，多导出/恢复整场景300秒取消，零断言fail，输入稳定 | 仅该场景总预算600秒，不改每个原生CLI60秒上限、像素/ZIP限制或断言 |
| outputs第二次run-mc5W65 | 33项32pass/1cancel，发布只读检查180秒取消，零断言fail，输入稳定 | 仅该多快照场景总预算600秒；只读不变性、marker和stale拒绝断言全留 |
| 首次全量run-gNU336 | 80项78pass/2cancel，局部marker/EXDEV/并发空目标及EXIF/JPEG alpha两个恢复场景180秒取消；零断言fail，输入稳定 | 只将这两个场景总预算600秒，文件默认180秒、单CLI60秒和全部断言不变；最终80项完整重跑通过 |

这些预算修正经过限定只读复核，不通过删断言、取消负例、提高产品安全上限或自动重试来放行。调大预算本身不等于PASS，只有后续真实同字节报告才给结论。所有失败、取消和中间报告保留，不将其回填为成功。

本轮有限日志例外只允许DSH自动日志沿原系统临时区，不是项目目录治理已修复或永久许可；产品夹具/日志/报告仍在项目既有位置，不清历史、不改DSH/共享配置/全局TEMP。授权到期或额度耗尽后不得自动续用；合并、关闭issue、发版、部署和真实图像调用均未授权。本轮源码/测试/方法正文在全量和独立执行期间保持冻结，后续只改非输入的公开验收摘要；提交前仍核这80份受验输入及精确暂存路径，不因摘要改字沿用未知代码结果。

## Issues #12/#16/#17的验证范围

- #12套图已完成派生可在非上下文任务revision变化后经只读检查复用；普通asset transform仍先执行完整请求意图的严格同键校验。complete/reuse/普通完成回放共用执行与输出交叉绑定，真实原生回归包含任务close后重导复用、同父图不同操作输出错挂拒绝、发布前后当前性竞态、reject-only和5000万聚合计划像素，以及原有恢复/EXDEV/编码像素场景。原夹具红测REQUEST_CONFLICT来自模拟请求门；其单元结果从未被升级为独立原生幂等验收。详见[快照输出](../SNAPSHOT-OUTPUTS.md)。
- #16的[公共方法](../PHYSICAL-REFERENCE-WORKFLOW.md)与原生接手回归已通过开发原生集成：精确方法/来源/facts/design、参考职责/hash/父链、冻结计划、在途unknown、引用stale与ZIP恢复/原权限隔离。方法的物理知识、书籍摆放、遮挡/相对截面与控制三层归因仍由Agent实际观察判断，不等于CLI自动看图、毫米精度或生图效果通过。
- #17与#16厚度补充的10个确定性用例以及运行器7个回归均已被本轮正式全量实际执行。invariant门禁验证的是给定观察记录的聚合，不是软件自动识图；相对FAIL/绝对UNKNOWN分项、错hash/上下文不放行、透视不机械判错等不产生真实视觉或行为收益证明。差异读取、主动纠偏和阶段耗时/成本的实际改善仍需同约束前后轨迹，未测量不报百分比。
- Skill0.1.5仍为方法候选，不作全局安装或产品发版。D1/D2文字修正、书籍靠墙定义及控制前检的限定静态审查保留原身份与范围；独立审查者选的踏凳文本已用于修订，不能再算修后未见盲测。上游真实图/像素计数及研究来源不冒充本席亲测。

## 历史已提交基线

已提交b428eed6的41/41和旧a7dd34d的37项常规通过/额外seal后反例FAIL均保持原范围；它们不是本次80项补丁的验收结论。旧FAIL不自动证明新版本仍失败，新开发PASS也不能替代修后独立验收。PR14/PR15保持未合并，issues不因开发报告自动关闭。

## 复现入口

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
node scripts/test.mjs --suite output-recovery --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/test.mjs --suite output-contract --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/demo.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
```

默认测试为 `native-*.test.ts`。当前正式全量已实际执行80项：b428eed6历史41项，加19项缓存/溯源/真实渲染兼容单元、2项真实原生缓存/错挂回归、#16的7项facts/提示词与1项原生接手、7项运行器证据回归、#17的3项给定观察聚合门禁。各测试可包含多条断言；本页当前80/80以最终同字节原生报告为准，不把单元计数误称80个原生数据库场景。历史0.2.0的42项仅通过 `node scripts/test.mjs --legacy --ygl-entry <入口>` 单独复现，是历史夹具与迁移来源，不充当新架构验收。

0.3.0 历史基线为原生 6/6、历史 42/42 与两步演示通过。0.4.0 的当前结果以本轮 native-wrapper-tests.json 与 api-tests.json 的实际 verdict／源码指纹为准，不以旧报告代替。这些自动化报告中的真实 AI 图像／收费 API 为 NOT_RUN，实调报告另列。

**历史开发基线（非当前修后独立验收）**：2026-11-16，#13冻结提交6e09d8e6窄修复完整29/29开发自验PASS；#11/#12冻结实现07a168e2最终完整33/33 PASS（rc0、零失败/取消/跳过），67份源码/测试/配置起止指纹相同。原生wrapper/API/documents/issues/engineering/ZIP/output/output-large证据均PASS。实际合成高清长PNG 41,116,951字节（32MiB条目限制33,554,432）经过拒绝与显式split、丢组件拒绝及context超限诊断。该记录是开发自验；该时点PR14/PR15保留Draft、issues未自动关闭；当前独立复验状态以本页上方表格为准。此前API长场景300s取消的失败报告保全；最终仅调整整场景预算600s，单请求1000ms及全部断言不变，完整重跑通过，不把失败回填为PASS。

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

`--suite outputs` 包含原生design矩阵/分镜独立接手、明确夹具观察的FAIL/UNKNOWN和交付拦截，以及两种页数/比例配置、实际2400方形JPEG的sRGB ICC/contain、整页长图、重放/局部替换复用、显式裁切、过期媒体、原生ZIP/clone和能力声明。首版契约以实际超过32MiB随机像素长PNG验证reject无正式目标、split不支持且零prepare/派生，以及context不能静默省略超限CAS；旧候选split成功证据仅保留为历史，不代表首版能力。

专项报告为outputs-tests.json，完整PASS还须native_output_evidence、native_output_large_evidence和native_output_recovery_evidence、native_output_contract_evidence均PASS。临时目录在本项目/隔离工作区tmp，故障/中间失败报告保全，不把原#13的29项旧PASS冒充新增特性的完整验证。真实视觉、独立盲复核、真实用户接受、图像服务及生产部署均另列，未由语义fixture或导出成功证明。

历史继续轮新增output-recovery专项4/4 PASS、rc0、source_stability=PASS。两项先红后绿分别证明旧恢复触发了postprocess、相同像素却丢失新裁切批准身份；修复新增原生发布前封存，并验证磁盘自洽伪造拒绝、全部组件已发布后不重渲染/不落暂存只补完成、marker晚失败恢复、模拟EXDEV不回退copy、并发/已有空目录保全、实际编码EXIF坐标与JPEG alpha背景像素、clone来源隔离。模拟EXDEV不是实际跨盘测试，注入竞态不是完整OS崩溃矩阵；a7dd34d独立37项全量和tsc通过，但额外seal后变更反例FAIL，不据全量PASS放行。用户随后明确首版组件目录/逐组件marker-last可恢复、仅reject不纳split、5000万聚合计划像素预算；修后b428eed6的41项开发全量已通过，当时独立席仅完成同版证据核对、执行NOT_RUN；当前修后独立执行状态见页首。旧报告和独立失败均保全，合并/发布仍另授权。

新增output-contract专项包括聚合metadata-only、实时split零准备拒绝及历史未完成拒绝、seal后/首文件后需求变更拒marker、只读原生check不写事件/工件、bytes-only marker/历史replay不当新current交付。marker含原生delivery身份、requires_native_current_check，读包成功不升级业务接受。
