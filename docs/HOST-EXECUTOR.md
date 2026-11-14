# 宿主图像执行协议 v1

用户于 2026-11-14 确认：优先使用 Codex／ChatGPT 当前宿主提供的图像能力，独立图像 API 为 fallback。此决定替代初始设计中“先接独立提供商才能真实出图”的实施顺序。

## 使用步骤

1. Agent 通过 CLI 建立任务、需求、冻结计划，向用户展示区域、保持项与步骤。记录真实用户确认后，通过独立 `approval grant` 命令绑定回执。计划中的 `approved:true` 会被拒绝。
2. `run advance` 默认生成 `retouch.host-request/v1` 任务单，状态为 `waiting_for_host`。任务单包含当前输入文件与 hash、蒙版、区域预览、参考职责、提示词和结果契约。此时尚未调用图像工具。
3. Agent 先检查当前宿主是否真的暴露图像编辑工具。可用时调用 `run dispatch`，收到首次、非 replayed 的 `host_execution_authorized_once` 后，调用该工具一次。CLI 先将结果状态置为 unknown，进程中断后由接手者核对同一尝试，不能盲目重新生成。
4. 工具返回真实本地文件后，填写 `retouch.host-result/v1` 回执，用 `run complete` 回接。回执绑定 request、plan、step、input hash，并保留实际工具与响应观察。
5. CLI 保留宿主原始输出，规范化方向／颜色后，仅采用批准矩形内的像素合成到当前工作图。画布尺寸不符会被拒绝；保持区采用原工作图像素。候选仍需检查，合成不会自动证明语义合格。
6. Agent 用实际看图工具查看合成候选、原图及区域对照，提交绑定输出 hash 的 `retouch.step-review/v1`。PASS 才能进入后一步；UNKNOWN 保留检查状态，FAIL 要求修正。
7. 全部步骤完成后，将实际成图交给用户终验。`retouch.final-review/v1` 的接受绑定指定图片，随后 `deliver` 在授权 exports 范围交付图片与清单。

没有图像工具时，保留 `waiting_for_host` 并说明缺少的能力；可以在另一个具备能力的宿主执行同一任务单，再回接结果。CLI 不依赖浏览器 DOM，也不把 ChatGPT 网页能力当成 shell 可调用端点。

## 回执格式

宿主输出回执的字段由任务单 `result_contract` 提供。`output_file` 填真实文件路径，`tool`、`tool_receipt` 记录真实来源。不要把提示词、工具自述或临时 URL 当成本地图像。

步骤检查使用以下字段：

```json
{
  "schema_version": "retouch.step-review/v1",
  "attempt_id": "<actual-attempt-id>",
  "plan_hash": "<actual-plan-hash>",
  "input_sha256": "<actual-input-hash>",
  "output_sha256": "<actual-composite-hash>",
  "verdict": "PASS",
  "observations": "对实际候选的观察、未解决问题及保持项检查",
  "reviewer": "<actual-vision-tool-or-human>"
}
```

终验回执使用 schema `retouch.final-review/v1`，携带 `run_id`、`plan_hash`、`output_sha256`、`verdict: accept|reject`、`issuer: human|host-human` 和实际确认文字 `confirmation`。

回执来源由用户／宿主工具权限约束。本地 CLI 记录这些声明及绑定关系，同一 OS 身份可写文件时，它不构成对恶意 Agent 的安全沙箱，也不能单独证明 JSON 中的 human 确实由人签署。demo 来源只允许在 demo 工作区使用，交付清单始终标记离线演示。

每份授权只绑定一次运行，覆盖该运行中的已批准步骤。取消结果未知的宿主任务不会重新开放旧授权；另一次运行要记录新的实际确认，原请求仍可补回结果留痕。

## 首版范围

- host 为默认执行器；工具的具体存在、参数和额度由当前宿主确认。
- offline 仅用于 demo 工作区的确定性图像处理测试，语义验收记为 NOT_APPLICABLE，不能宣称 AI 已修好。
- 当前批准区域为固定画布上的整数矩形；可查看蒙版与预览。软边、任意形状及画布变换留待后续实现。
- API fallback 的策略和扩展边界已预留，独立 API 适配器尚未实现；不会自动读取密钥或从宿主失败静默切换为收费请求。
- 宿主用量由宿主管理，CLI 不把它报告为零费用或宣称已计入独立 API 预算。

本轮会话未暴露 `image_gen` 工具，原生图像生成端到端验证为 NOT_RUN。任务单、结果回接、合成与检查协议使用真实本地图片夹具验证。已读取的本机 imagegen 技能规定优先使用内置工具；官方文档页面读取返回 403，未将未取回的页面作为能力证据。
