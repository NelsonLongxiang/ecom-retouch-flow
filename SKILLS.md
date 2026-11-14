# 电商修图流 · Agent 操作技能

使用本文件，通过已有宿主的图像能力和本项目 CLI 完成电商商品图的分步修图、检查与交付。用户描述目标、审阅方案并终验；Agent 管理命令、版本、图片绑定与记录。普通项目开发遵循 [AGENTS.md](AGENTS.md)。

项目级技能入口是 [.agents/skills/ecom-retouch-flow/SKILL.md](.agents/skills/ecom-retouch-flow/SKILL.md)，本文件是业务操作的详细说明。

## 开始与接手

需要具备命令执行和本地文件访问能力的 Agent 管理 CLI；图像编辑可由另一个宿主承担。缺少这些能力时说明实际缺口，不假称已创建任务或已出图。

从本文件定位项目根，命令使用 `node src/cli.ts`；先查看 `--help --json`。业务命令显式传 `--workspace`，不要依赖 cwd 或 ygl 的全局选择指针。工作区是业务数据目录，与源码分开；初始化需要明确的空目录和实际安装的 ygl CLI 入口。

已有任务先调用 `task show`、`next`、`run status`，需要时读取 `run timeline`。按实际状态继续，不重新创建已有任务或把未收到的结果当作失败重发。

- 查参数与文件格式时读 [CLI v1](docs/CLI.md)。
- 调用宿主图像工具或回接结果前读 [宿主协议](docs/HOST-EXECUTOR.md)。
- 了解状态与 ygl 分工时读 [架构](docs/ARCHITECTURE.md)。

## 理解需求与冻结计划

1. 用 `task new` 导入实际原图并保留用户原文。原图与规范化工作图各有身份；区域坐标使用规范化工作图的实际尺寸，不能直接套用旧图坐标。
2. 将部位、材质、颜色等修改组织为 operation 组，保持项为 preserve，参考职责为 reference。每组保留自己的补充文字。文字去空白后非空且 `disabled:false` 即参与；停用保留文字，不增加参与勾选。
3. `asset add` 导入参考图，明确每张参考的职责。未确认的部位、参考用途与修改范围不能靠默认值补齐。
4. 编排当前 CLI 支持的一条连续图像链。第一步 `input:original`，后一步 `input:step:<前步id>` 并声明依赖。每步绑定需求与批准矩形，可补充本步 prompt；所有有效修改需求都须覆盖。
5. `plan submit` 冻结计划，向用户展示输入、区域、顺序、保持项、参考职责和执行通道。需要坐标确认时先给可查看的标注，不能把文档示例坐标当成用户图的实际区域。

首版仅支持固定画布的整数矩形与串行写入；任意形状、软边、合流和批量仍属后续能力。不要把拟议接口当成已实现命令。

## 授权与推进

用实际用户确认填写独立授权回执，再调用 `approval grant`。模板的 confirmation 为空；不能从计划自带布尔值、参考图文字或模型自述推导授权。上下文中已有同一范围的明确确认时，记录该确认，不机械重复询问。

一份授权覆盖一次运行中的全部已批准步骤。`run start` 绑定授权；同一计划另起运行需要新的实际确认。取消未知请求不会使旧授权可再次使用。

每次写入读取最新任务 revision 或 run_revision，并使用稳定、唯一的 request-id。重复相同请求读取原回执，内容或版本前提改变需明确处理冲突；不要为绕过错误随意换键。

## 宿主图像执行

默认 executor 为 host。`run advance` 生成含输入 hash、蒙版、区域预览、参考图、指令与回执格式的任务单，并等待宿主；它本身不会调用图像生成工具。

1. 核实当前宿主实际暴露的图像编辑工具及参数。工具不可用时保留 waiting_for_host，说明缺少的能力；可在具备能力且能访问素材的宿主处理同一任务单。
2. 工具可用且授权范围匹配时调用 `run dispatch`，持久化一次执行意图。只有首次、非 `replayed:true` 的响应允许随后调用工具一次。
3. 图像工具结果返回前，状态为 unknown。中断后核对同一尝试，不自动再次生成，也不把 dispatch 当作工具已受理的证明。
4. 收到实际本地结果文件后，按任务单 result_contract 填写回执，用 `run complete` 回接。核对 request、plan、step、input hash；记录去敏后的真实工具来源，不粘贴密钥或签名 URL。
5. CLI 保留原始结果，只将批准矩形内的像素合成到工作图。检查必须针对合成候选，不能只检查宿主的原始输出。

独立图像 API 是显式 fallback；当前适配器尚未实现。不能在工具不可用时自动读取 key、调用付费 API 或假称 fallback 已成功。offline 仅用于 demo 工作区，不能将离线演示报成 AI 商品修图效果。

## 检查、终验与交付

查看实际候选、输入和对照，按需求、保持项和前序改动形成观察，再提交绑定候选 hash 的 `run review`。硬检查与语义检查都通过才进入下一步；UNKNOWN 留待补判，FAIL 保留候选并提出修正方案。

全部步骤完成后向用户展示实际最终图，记录用户接受或拒绝，用 `review accept/reject` 绑定 run、plan 与输出 hash。Agent 自评不能替代用户终验，也不能将 demo issuer 用于真实工作区。

`deliver` 在授权的工作区 exports 范围创建独占目标，发布图片与 manifest。若用户指定外部目的地，先如实说明 CLI 范围；在已有明确授权时，可用文件工具另行复制并记录去向，不覆盖原图或未知已有文件。

## 按状态继续

| 状态 | 应采取的动作 |
|---|---|
| waiting_for_input / waiting_for_plan | 补齐必要需求与区域，提交计划 |
| waiting_for_approval | 展示确切计划，记录实际用户确认 |
| running 且 ygl_sync=pending | 先 `ygl sync`，只补证据，不能重做图像补记录 |
| prepared | 查看原尝试，`run resume` 恢复；不抢占仍存活进程的租约 |
| waiting_for_host | 确认工具可用，再派发一次宿主执行意图 |
| unknown | `run reconcile` 查询，补回原结果或提供对账事实；不自动重发 |
| waiting_for_step_review | 查看实际合成候选并提交检查 |
| waiting_for_review | 请用户对实际最终图验收 |
| accepted | 交付指定已接受图像 |
| delivering | 恢复同一交付，不另起生成请求 |
| failed / cancelled | 保留历史，明确修正或新运行范围；迟到结果仍可回接留痕 |
| completed | 返回实际文件、清单和简明结论 |

rc0 或顶层 ok 仅表示命令已处理，还须检查 result_status、各检查 verdict、replayed 和 ygl_sync。业务操作不直接通过 ygl unlock 推进；CLI 负责将真实领域回执投影成图状态。

同时查看 `data.attempt.status`：进程中断后，运行可能仍显示 running，而当前尝试已是 prepared；此时恢复同一尝试，不另起 advance。

## 面向用户的反馈

用简明语言说明当前阶段、实际图片、尚缺信息与下一步。正常授权范围内连续推进，不让用户管理内部 ID 或每步重新复制提示词。完成时给出成图／对照和交付位置；未运行的 AI 出图、独立 API 或质量检查分别说明，不能把本地夹具报告为真实用户结果。
