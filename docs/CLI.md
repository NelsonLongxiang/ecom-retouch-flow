# 电商修图流 CLI v1 · 0.1.0

这里记录实际实现的 M1–M2 接口。命令入口为 `node src/cli.ts`；文中 `retouch` 是该入口的简称，当前未安装全局命令。最初设计目录中的更广命令不自动等于已实现能力。

## 最短路径

直接运行 `node scripts/demo.mjs --ygl-entry <已安装的 bin.cjs>` 可完整体验离线工作流。真实任务由 Agent 操作以下命令，用户通过自然语言描述需求、审阅计划和终验。

```text
retouch workspace init <空目录> --ygl-entry <ygl-bin.cjs>
retouch task new --image <原图> --brief <用户原文> --workspace <工作区> --json
retouch requirement set <task-id> --file <需求.json> --expected-revision <n> --workspace <工作区> --json
retouch plan submit <task-id> --file <计划.json> --expected-revision <n> --workspace <工作区> --json
retouch approval grant <task-id> --file <真实确认回执.json> --expected-revision <n> --workspace <工作区> --json
retouch run start <task-id> --expected-revision <n> --workspace <工作区> --json
retouch run advance <run-id> --request-id <唯一请求键> --expected-revision <n> --workspace <工作区> --json
retouch next <task-id> --workspace <工作区> --json
```

工作区默认 standard，执行器默认 host。`workspace init --demo` 才允许 offline 的确定性测试操作，不能把已有工作区切换成 demo。

每次写入使用响应中最新的 `revision`（任务）或 `run_revision`（运行）。创建任务、导入资产和初始化没有前序版本。推进、派发、结果回接、检查、终验及交付还需要 request-id。同一请求键重放相同意图返回原记录并置 `replayed:true`；内容或版本前提不同则冲突。

## 需求文件

```json
{
  "schema_version": "retouch.requirements/v1",
  "groups": [
    {"id":"handle","label":"把手","text":"将指定把手改为圆形","disabled":false,"scope":"operation"},
    {"id":"material","label":"门板","text":"改为浅橡木纹","disabled":false,"scope":"operation"},
    {"id":"keep","label":"保持项","text":"其他结构、背景和前序改动保持","disabled":false,"scope":"preserve"}
  ]
}
```

文本非空且未停用即参与，空白和停用项仍保存原文。scope 支持 operation、preserve、reference；reference 需求需要步骤绑定对应的 `reference_asset_ids`。`asset add --file` 返回可用于计划的规范化素材身份。

## 计划文件

```json
{
  "schema_version":"retouch.plan/v1",
  "title":"改把手，再换门板材质",
  "executor":"host",
  "steps":[
    {"id":"handle","name":"改把手","operation":"image.edit","input":"original","needs":[],"requirement_ids":["handle"],"region":{"x":8,"y":8,"width":8,"height":8}},
    {"id":"material","name":"换材质","operation":"image.edit","input":"step:handle","needs":["handle"],"requirement_ids":["material"],"region":{"x":40,"y":20,"width":20,"height":16}}
  ]
}
```

这些坐标仅展示格式；真实区域须按规范化工作图确认。首版支持单条连续图像写入链、固定画布、整数矩形。每个有效修改需求必须被覆盖，后一步的 input 与依赖需明确承接前一步；环、未知节点、越界区域和停用需求会被拒绝。可选 `prompt` 补充本步要求；CLI 自动携带有效需求和共享约束。

提交后冻结计划 hash，建立独立 ygl 树并验证结构，返回授权模板。模板的 `confirmation` 为空，不能直接当成已确认回执；须记录实际用户确认。一份授权绑定一次运行、覆盖其已批准步骤；取消未知请求不会恢复这份授权，新运行须有新的实际确认回执。需求改变会使旧运行不可再推进，旧计划、图片和事件保留。

## 执行、检查与交付

| 命令 | 实际行为 |
|---|---|
| `run status/timeline` | 查询状态、输入、候选、事件和待同步证据 |
| `run advance` | offline 处理一次本地图像；host 返回任务单，等待宿主 |
| `run dispatch` | 记录一次宿主执行意图，后续状态 unknown；只在首次非重放响应后调用工具 |
| `run complete --file` | 核对原请求绑定，导入真实宿主文件，保留原始结果并合成批准区域 |
| `run review --file` | 对实际合成候选记录 PASS／FAIL／UNKNOWN；PASS 才放行下一步 |
| `review accept/reject --file` | 记录指定运行、计划与图片 hash 的真实用户终验 |
| `deliver --to` | 在授权 exports 范围创建独占目录，验证图片，原子发布 manifest 作为交付完成标记 |
| `run resume/reconcile` | 恢复已准备的本地操作或未完交付；unknown 宿主请求只核对，不重新出图 |
| `run cancel` | 停止后续步骤；不宣称宿主已取消或费用已免除。迟到结果仍可回接留痕 |
| `ygl sync` | 仅补图、证据与状态投影，不重新生成图片 |
| `doctor` | 核对 CAS 与本工作区 ygl 健康，不联网探测图像 API |

宿主回执格式与操作顺序见 [宿主协议](HOST-EXECUTOR.md)。demo 演示的授权、检查与接受均明确标记为夹具，交付 manifest 包含 `mode:demo` 与 `NOT_RUN_OFFLINE_DEMO`。

## 机器契约与限制

`--json` 的 stdout 只输出一个 `retouch.cli/v1` 信封，诊断在 stderr。rc0 表示命令已处理，仍须看 result_status；rc1 表示运行／存储／冲突错误；rc2 表示参数、schema 或前置数据校验失败。错误的 `effect_status` 区分 none、submitted、unknown、committed；已落账的执行意图出错会携带 run／attempt 身份，不能据通用错误直接重新发图。

当前 `--dry-run`、独立 API fallback、批量、多提供商路由、任意 DAG 合流、软边／任意蒙版和自动宿主工具发现尚未实现。未知选项会报错。API key 不被读取或写入；宿主用量由宿主管理。确认回执依赖宿主／操作人真实授权，不构成同 OS 恶意 Agent 沙箱。

Node 24.12 的 SQLite 模块带实验性诊断，版本与依赖已钉住并纳入测试；当前原生 ygl 适配要求 0.125.0 发布包完整、源码身份一致，升级需重新核验。
