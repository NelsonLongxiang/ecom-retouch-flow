# 显式图像 API fallback（0.4.0）

宿主能力仍为默认路径。CLI 不推测宿主是否具备工具，也不会因工具缺失、超时、质量或尺寸不合适自动转为收费 API。API 调用必须由用户明确选择，并绑定原生计划、执行配置、素材外发和请求数量授权。

本轮实现一个明确的兼容协议：`POST <api-base>/images/edits`，multipart，显式 model，`n=1`，PNG 输入／可选区域 mask／用途明确的参考图，返回单张 base64 图片。不自动改模型，不下载响应 URL，不跟随重定向，不自动重试。

执行配置存为 ygl 原生 executor-profile 工件：协议、受保护配置来源、明确模型、质量／尺寸、超时、响应上限与 endpoint 指纹。来源为显式环境变量，或用户已授权的当前 Codex 模型配置；base/key 只在调用进程内读取，不复制到文件、argv、原生 payload、日志或 ZIP。导入配置不是授权，目标 home 须有适用的新本地授权。

计划冻结 fallback profile 的原生身份／版本/hash。授权独立记录具体 profile、endpoint 指纹、最大请求数、费用与外发确认原文。每个步骤先原子写入 ygl 调用意图，然后最多发送一次请求；同键重放、并发调用、断开或超时不会再次提交。未知请求须先对账。

输入转为可追溯的 PNG 传输素材；mask 的透明区域表示允许编辑范围。图像输出先按实际字节／尺寸保全，再保存原生接收回执，最后复用现有局部合成与检查流程。模型原生结果、候选、视觉检查和用户接受分别记录。局部输出尺寸不符时保留原结果等待处理，不偷偷调整或重新出图。

已收到图片但后续写入／合成未完成时，恢复只读取已保存的内容寻址文件并补写原生记录，不再次访问图像 API。HTTP 拒绝、未知网络结果和已收到但不支持的响应分别说明；响应正文／认证头不写诊断。

验收以本地 HTTP 模拟服务和真实 ygl 原生工作区为主：成功回接、保持区、单次调用、重放、并发、超时、重定向、不支持的 URL 响应、凭证隔离、恢复与历史授权。真实收费 API 另行 opt-in，不以模拟服务通过宣称真实模型质量。

2026-11-15 已在用户明确授权下，用当前选定服务与合成素材完成一次 `gpt-image-2` 原生调用；size=auto，实际响应1254×1254 PNG，原生图片／回执及新会话接手核验通过，零自动重试。服务通道通过与商品图质量、用户接受分别记录，完整范围见 [验证摘要](verification/README.md)。这次授权不延续为后续自动付费探测。

## 配置与授权

由宿主的受保护配置入口将现有 API base 和 key 注入环境。base 含服务前缀（例如 `/v1`），不含具体 images 接口、查询参数或凭证。实际 key 不进项目 JSON、`.env`、命令行或聊天，也不从浏览器归档或其他工具的凭证文件自动提取。

`executor register --project <id> --file <profile.json> --request-id <稳定键> --workspace <目录>`，配置只保存变量名与明确模型：

```json
{
  "title":"显式图像服务",
  "profile":{
    "schema":"retouch.api-profile/v1",
    "protocol":"openai-images-edits/v1",
    "base_env":"RETOUCH_IMAGE_API_BASE",
    "credential_env":"RETOUCH_IMAGE_API_KEY",
    "model":"<实际支持该协议的模型>",
    "size":"auto","quality":"auto","timeout_ms":180000,
    "response_limit_bytes":50331648
  }
}
```

替换模型占位符，不自动替用户选用或切换模型。`executor check <profile-id>` 仅检查配置、凭证存在和 endpoint 指纹，不验证认证或模型服务。当前适配器可请求 size 为 auto、1024x1024、1536x1024、1024x1536；这是适配器的输入契约，不是对所有服务／模型的尺寸能力结论。实际返回以解码字节为准。

## 当前 Codex 配置与分层诊断

用户明确授权沿用当前配置后，可在 profile 中用以下来源代替手工注入变量；模型仍显式填写图像模型，不从 Codex 的语言模型字段猜测：

```json
{"configuration_source":{"kind":"codex-model","authorized":true,"authorization_ref":"<实际用户授权来源>"}}
```

只读取 CODEX_HOME 指定或当前用户 `.codex` 的 config.toml，选择当前 model_provider；仅使用该服务声明的 env_key 或 experimental_bearer_token。该服务明确 requires_openai_auth 时可读取同目录 auth.json 的专用 OPENAI_API_KEY，不复用 ChatGPT 登录/OAuth tokens，不扫描其他工具目录。TOML 由固定版本解析器读取，解析错误不回显配置行或凭证。

注册时绑定本地 workspace 与当前 provider，恢复到另一个 home 后读取授权失效。新本地登记须有真实 configuration_authorization_ref；切换 provider 或 endpoint 明确报告漂移，不自动替换服务。正常换会话无需用户重新粘贴密钥。

`executor diagnose --project <id> --file <候选配置.json>` 无需先登记：分别报告配置读取授权／存在性、凭证是否设置、适配器协议和本地准备状态。未授权不读文件；不支持的协议在配置读取前拒绝。`executor check` 检查已登记配置。ready 保留兼容，但 readiness_scope 明确是 LOCAL_CONFIGURATION_ONLY；network 始终 NOT_RUN。最近图像结果、最近绑定调用、未绑定历史结果分别显示时间、来源和状态，历史成功不证明当前认证。模型列表成功也不作为图像验收。

宿主实际工具清单用 `executor observe --file` 记录 `{"state":"unavailable","source":"<实际工具清单观察来源>"}`，状态也可 available/unknown。带时间的观察及 profile 摘要进入 project brief/context build；它是观察记录，不是调用授权或永久可用保证。

## 显式私网 HTTP 兼容通道

HTTPS 是默认。测试的 allow_loopback_http 只开放明确本机地址。现有私网 HTTP 服务可单独声明：

```json
{"private_http":{"enabled":true,"confirmation":"<用户对当前私网 HTTP 传输的实际确认来源>"}}
```

该兼容仅接受 RFC1918 IPv4 或 ULA IPv6 字面地址；不接受公共 HTTP 或未经解析约束的域名，不伪装 localhost、不代理、不关闭证书验证。HTTP 会明文传输所选素材与认证信息，使用者须明确接受当前服务的传输条件。实际调用仍要冻结 profile/version/hash/endpoint、取得适用费用与素材外发授权并限定请求次数；此选项不会自动探测或重发。私网配置与受保护来源分别声明 ZIP 所需能力，旧工具不能静默忽略。

在完整 plan submit 文件中添加 `"fallback":{"profile_id":"<原生 executor-profile id>"}`。每步可声明 `references:[{"media_id":"<原生 media id>","purpose":"仅参考木纹"}]`，最多 15 张参考加 1 张编辑目标；规范化 PNG 每张上限 32 MiB。用途进入冻结计划及实际提示词，不把参考商品升级为当前商品事实。product-accurate还须按[商品一致性契约](ENGINEERING-CONTRACTS.md#商品一致性与最终产品层)钉本SKU合格母版；每步母版input_role/reference.role为product-structure，结构参考的purpose固定为product-structure，实际有序上传父链与规范化字节核对。结构职责会明确进入提示词，不仅依赖purpose自由文本；protected-layer只生成环境候选，最终本地合成必须另核原生proof，不能因API收到图就放行。

返回的 approval_template.api_fallback 含 profile 身份／版本/hash、endpoint 指纹和 max_requests。取得真实用户同意后填入非空 cost_confirmation 与 upload_confirmation，再 approval grant。可省略 api_fallback，此时仍只允许宿主。max_requests 按每份授权计数、不超过计划步数；它限制请求次数，不能保证提供商实际货币费用。

## 执行与恢复

以下命令都传实际 workspace/project：

```text
run execute-api <run-id> --profile <profile-id> --expected-revision <rev> --request-id <稳定键>
run status <run-id>
run recover-api <run-id>
run recover-api <run-id> --fit-input
```

execute-api 只处理未派发的当前步骤，先保存原生编译提示词、传输素材和调用意图，再提交一次。成功后为 waiting_for_review，沿用 run review／accept／deliver，不自动记录质量通过或用户接受。

原始结果与局部画布尺寸不符时返回 API_LOCAL_RECOVERY_REQUIRED，原图已保全。显式 --fit-input 才按当前画布宽高重采样（可能改变长宽比），另建 postprocess 并合成批准矩形；保留模型原始尺寸与完整派生。恢复无需 API 密钥，也不访问图像服务。

图片已登记但接收状态回执失败时，恢复从原生 media 中的去敏提供商回执补记状态。克隆后按新执行 ID 隔离本地回执键，保持原外部请求身份；不会把源项目的已执行回执冒充目标项目已完成。若图片或原生事实未能保全，保留未知并核对提供商原请求，不重新出图。

超时、连接失败、5xx／429、格式或解析失败保留 unknown；常见明确拒绝的 4xx 保存 failed、HTTP 状态、去敏错误代码及提供商请求 ID，不保存原始错误消息或认证头。两者均不自动重试。

迟到图片用 `run api-result <id> --file <真实图片> --metadata <来源.json> --expected-revision <rev>`，来源文件：

```json
{"operation_key":"<原 execute-api 请求键>","provider_request_id":"<实际原请求 id>","statement":"从提供商原请求回执取回，未重新出图"}
```

明确失败或仍未知时用 `run api-reconcile <id> --file <对账.json> --expected-revision <rev> --request-id <键>`，文件含原 operation_key、status（failed/unknown）、真实 statement 与 source。不覆盖前序输出，不发送请求，不能把操作员猜测写成提供商确认。

## 交换与验证

配置、提示词、图像、意图和回执随原生 ZIP 携带，声明 retouch-api-fallback/v1；私网 HTTP 与 Codex 配置来源额外声明 retouch-private-http/v1 和 retouch-configuration-source/v1。旧工具拒绝不理解的能力。凭证和环境不入包，源授权不激活目标 home；新请求需适用的新本地授权和配置绑定。

定向检查：`node scripts/test.mjs --suite api --ygl-entry <实际入口>`。完整回归不加 --suite，要求原生主流程及本机 API 模拟证据同时通过。该协议是一个明确的 multipart/base64 子集，不代表所有兼容中转／模型均支持相同字段；真实图像服务和费用另行验收。
