# 宿主图像协议 v2

适用于 0.4.0 ygl 原生入口。CLI 负责项目上下文、计划与执行回执；默认图像编辑由当前宿主提供的工具执行。工具不存在就保留计划，不宣称已出图，也不自动调用独立 API。

`run dispatch` 在原生事务中持久化执行意图。检查 `ok`、`data.allow_execute` 和 `replayed`：只有首次 allow_execute=true 且未重放时，才允许随后调用宿主图像工具一次。直接使用 ygl retouch-native 扩展的调用者也须检查 `result.replayed`；历史回执不能重新授权执行。CLI 无法强制阻止同一 OS 身份的任意代码绕过协议。

返回 `retouch.host-job/v2`：execution_id、plan_id、当前 step、input（原生媒体 ID、实际路径/hash/尺寸）、有效需求和保持项。宿主从工作区对象路径读取真实图片；局部步骤中的 coordinate_system 必须匹配输入尺寸。每次只处理当前步骤，后续输入来自前一步已检查结果。

有商品字段时，读取 job 的 purpose/fact_check，以及 step.bound_facts 和 step.fact_constraints。实际图像工具提示词须包含这些已确认值、单位、单件／整套范围和保守呈现边界；不只转发 step.prompt。来源摘录及原生审计 ID 留在本地，不为渲染整段外发。概念提案不升级为实物规格，视觉接受不改变事实 spec。

在调用工具前，确认用户已授权的素材外发、修改范围和目标平台适用。已有同范围确认可作为实际来源，不反复追加审批。API fallback 已作为显式入口实现，须绑定配置及费用／外发授权，见 [API fallback](API-FALLBACK.md)；不能凭工具缺失自动收费。

图像返回后使用 `run complete --file <实际输出>`。CLI 注册模型原始字节；局部处理时仅将批准矩形像素合成到输入图，原始输出和候选分别留存。局部输出尺寸必须与输入一致；全图步骤可产生不同尺寸，但后处理仍生成独立工件，不改写原生结果尺寸。

查看实际候选后 `run review` 记录候选 hash、PASS/FAIL/UNKNOWN、观察、检查者与来源。PASS 进入下一步或等待用户终验；UNKNOWN 留在当前检查，FAIL 保留候选并停止该运行。用户对实际最终 hash 的接受用 run accept 保存，随后 run deliver 写入文件及清单。

进程中断或工具结果不明时，用 run status／project brief 查询已派发事实。可用 run unknown 保存未知原因，收到原结果后 complete；不得另换请求键再次调用工具。外部执行对账用 execution reconcile。修索引、补记录、ZIP import 和恢复交付都不能引发新生成。

恢复到另一个工作区后，原授权不能执行。若继续恢复运行，记录适用于该计划的新本地 approval grant，再 run authorize；授权操作不清除 unknown。原交付绝对路径仅是历史事实，不能自动在新 home 写往该路径，必须显式给出目标目录。

测试中的合成图片和确认文字是协议夹具。真实宿主 AI 出图、商品语义质量和用户满意度分别验证，不能用夹具 PASS 替代。
