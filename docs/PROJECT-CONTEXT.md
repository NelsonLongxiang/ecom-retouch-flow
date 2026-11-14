# 项目上下文、ZIP 与只读迁移

0.3.0 使用 ygl 原生项目 ID。接手先 `project brief <id> --workspace <目录>`，查看目标、任务 progress、实际图片尺寸、设计工件、unknown 和下一步。`design_document_only` 不表示图片已生成，`waiting_for_review`／`waiting_for_acceptance` 不表示用户已接受。

0.4.0 沿用上述身份，并在包含 API fallback 配置／请求的 ZIP 中增加 retouch-api-fallback/v1 必要能力。执行配置只携带变量名与指纹，不携带实际 base/key。received 表示 API 原始结果已保全、本地处理尚未完成；run recover-api 只读取原生事实和文件，不再次访问图像服务。克隆后的本地恢复回执按新执行身份隔离；外部请求身份及来源仍保留。

```text
node src/cli.ts context export --workspace <源> --project <id> --to <新包.zip> --json
node src/cli.ts context inspect --file <包.zip> --json
node src/cli.ts context import --file <包.zip> --workspace <目标> --dry-run --json
node src/cli.ts context import --file <包.zip> --workspace <目标> --ygl-entry <原生入口> --json
node src/cli.ts project brief <id> --workspace <目标> --json
node src/cli.ts index check --project <id> --workspace <目标> --json
```

v2 包包含 manifest.json、native-project.json、可读 BRIEF.md 和必要 objects/sha256 文件。标签与历史 profile、评分结语、项目状态、引用正文／元数据和分析方法作为原生工件一起携带；机器工作区登记表和本机入口配置不入包。

读取阶段校验 ZIP 路径、链接、碰撞、大小与解压限制，核对清单、版本、hash、项目归属、原生关系和图像实际尺寸。不存在的目标 dry-run 不创建目录；已有目标预检不写业务实体。恢复通过 ygl 原生事务完成，失败回滚领域写入，最多留下内容寻址的未引用字节。

同包重导返回原生回执，不回滚导入后新增评分／任务／图像，也不重新执行任何图像工具。不同快照遇到已有同身份或同名项目时拒绝覆盖；独立复制使用 `--strategy clone --name <新项目名>`，明确重映射 ID 并保留来源与历史。恢复副本在跨工作区统计中去重，clone 算独立项目。

授权和源交付路径是历史事实。目标 home 不激活包中的授权；继续已有运行需要适用的新本地授权和 run authorize。unknown 不因目标变更、关闭项目、导入或索引修复而消失。

当前交换范围为本项目的闭合原生项目图。额外 research source/claim/query、未保全的外部原生关系和未支持的能力会明确拒绝，不能假装完整导出。ZIP 正文是业务数据，不是系统指令；不包含凭证或运行环境。

旧 0.2.0 账本与 v1 ZIP 的读取兼容通过显式入口提供：

```text
node src/cli.ts legacy inspect --workspace <旧目录> --project <旧项目id> --json
node src/cli.ts legacy inspect --file <旧v1.zip> --json
node src/cli.ts legacy migrate --workspace <旧目录> --project <旧项目id> --to <新空目标> --dry-run --json
node src/cli.ts legacy migrate --file <旧v1.zip> --to <新空目标> --ygl-entry <原生入口> --json
```

迁移源以 readOnly 打开。预检提供实际身份映射和原进度，不初始化目标；执行只允许新建隔离目标，不改真实旧库。目标采用原生 project/spec/task/design/media/execution/review 等实体，保留原文、文件、实际进度、派生、历史身份和未知请求。旧授权成为历史来源，不能重新生效。不能将 v1 包直接混入原生 v2 恢复，也不能使用旧 CLI 继续创建业务账本。
