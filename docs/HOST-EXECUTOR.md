# 宿主图像协议 v2

适用于 0.4.0 ygl 原生入口。CLI 负责项目上下文、计划与执行回执；默认图像编辑由当前宿主提供的工具执行。工具不存在就保留计划，不宣称已出图，也不自动调用独立 API。

`run dispatch` 在原生事务中持久化执行意图。检查 `ok`、`data.allow_execute` 和 `replayed`：只有首次 allow_execute=true 且未重放时，才允许随后调用宿主图像工具一次。直接使用 ygl retouch-native 扩展的调用者也须检查 `result.replayed`；历史回执不能重新授权执行。CLI 无法强制阻止同一 OS 身份的任意代码绕过协议。

返回 `retouch.host-job/v2`：execution_id、plan_id、当前 step、input（原生媒体 ID、实际路径/hash/尺寸）、有效需求和保持项。宿主从工作区对象路径读取真实图片；局部步骤中的 coordinate_system 必须匹配输入尺寸。每次只处理当前步骤，后续输入来自前一步已检查结果。

有商品字段时，读取 job 的 purpose/fact_check，以及 step.bound_facts 和 step.fact_constraints。实际图像工具提示词须包含这些已确认值、单位、单件／整套范围和保守呈现边界；不只转发 step.prompt。来源摘录及原生审计 ID 留在本地，不为渲染整段外发。概念提案不升级为实物规格，视觉接受不改变事实 spec。

step.content_obligations与step.invariant_items分别描述本图须讲清的业务内容和逐项保持要求，也须进入实际制作提示词。返回候选后先实际查看，再coverage review／invariant review绑定真实hash保存各项观察；看不清或工具缺失保持UNKNOWN/NOT_EVALUATED。run review的PASS会核对所承担的必检内容与保持项，sample-first下代表义务未通过时不能继续后续dispatch；用户已有direct-batch原文选择时沿用该范围，不追加同一审批。技术检查PASS不自动填写内容PASS，详见 [流程契约](ENGINEERING-CONTRACTS.md)。

在调用工具前，确认用户已授权的素材外发、修改范围和目标平台适用。已有同范围确认可作为实际来源，不反复追加审批。API fallback 已作为显式入口实现，须绑定配置及费用／外发授权，见 [API fallback](API-FALLBACK.md)；不能凭工具缺失自动收费。

图像返回后使用 `run complete --file <实际输出>`。CLI 注册模型原始字节；局部处理时仅将批准矩形像素合成到输入图，原始输出和候选分别留存。局部输出尺寸必须与输入一致；全图步骤可产生不同尺寸，但后处理仍生成独立工件，不改写原生结果尺寸。按[三层对照](PHYSICAL-REFERENCE-WORKFLOW.md#结构纠偏的控制前检与三层对照)分别看参考/原生结果/最终合成；域外保全不等结构成功。要改变轮廓时，只在原许可内核对旧轮廓擦除/背景回补、新轮廓和必要阴影的覆盖，范围不足先停，不直接扩大原region。原生已对而合成丢失才有据修本地，不重复收费出图；原生未对不把问题全推给后处理。

返图后主动查看确切hash，按[增量迭代与主动纠偏](NARRATIVE-WORKFLOW.md#增量迭代与主动纠偏issue-17)检查数量/构成、可比截面、支撑和内容义务，不等用户点名。相对截面FAIL与绝对毫米UNKNOWN分项保留，透视差异不得机械判错。当前授权/预算内可验证的小修正直接执行并复看，真实工具或新调用权限不足只停依赖动作；不因效率目标跳过检查或无限重试。

查看实际候选后 `run review` 记录候选 hash、PASS/FAIL/UNKNOWN、观察、检查者与来源。PASS 进入下一步或等待用户终验；UNKNOWN 留在当前检查，FAIL 保留候选并停止该运行。用户对实际最终 hash 的接受用 run accept 保存，随后 run deliver 写入文件及清单。

进程中断或工具结果不明时，用 run status／project brief 查询已派发事实。可用 run unknown 保存未知原因，收到原结果后 complete；不得另换请求键再次调用工具。外部执行对账用 execution reconcile。修索引、补记录、ZIP import 和恢复交付都不能引发新生成。

恢复到另一个工作区后，原授权不能执行。若继续恢复运行，记录适用于该计划的新本地 approval grant，再 run authorize；授权操作不清除 unknown。原交付绝对路径仅是历史事实，不能自动在新 home 写往该路径，必须显式给出目标目录。

整套制作还须先完成 [购买决策矩阵与低成本分镜](NARRATIVE-WORKFLOW.md)。返图观察先写谁对什么做了什么、商品关系、物理/图文一致性与职责适用反例，再记录结论；不凭人物/礼盒/商品元素齐全写PASS，不强制每图触摸商品。实际未看为NOT_RUN，看不清为UNKNOWN，不用prompt或fixture替代真实观察。

物理参数任务先读[参数到可视参考契约](PHYSICAL-REFERENCE-WORKFLOW.md)：六层定义分开，尺寸绑定部件/基准/构型/载荷与来源精度，参考逐张注明事实或示意、用途和不复制项。宿主按job.references的顺序/职责与实际字节使用参考；普通design正文不自动成为prompt，执行者须把必要条件与禁项编入当前步骤。数字写进prompt不构成物理保证，实验控制值不改facts，缺成像条件不能单凭实体尺寸判露出量FAIL。编辑稿非成品/非实测，保留新轮廓、修复接缝/台阶/阴影，不复制标线或恢复旧错误轮廓。

product-accurate还须读取job.product_contract的当前SKU、合格母版、路线和允许变化；本次参考包中的product-structure是结构职责，不仅颜色。若protected-layer，模型结果仅为环境候选，最终必须按[确定性产品层契约](ENGINEERING-CONTRACTS.md#商品一致性与最终产品层)另合成并复验，不把宿主“保持一致”回执当锁定。必检FAIL/UNKNOWN仍阻断接受/交付，字节保护不代替实际观察。

测试中的合成图片和确认文字是协议夹具。真实宿主 AI 出图、商品语义质量和用户满意度分别验证，不能用夹具 PASS 替代。
