# 验证结果与复现

2026-11-14，在 Windows、Node 24.12.0 与 ygl-trees 0.125.0 下完成 M1–M2 验证：

| 检查 | 实际结果 |
|---|---|
| TypeScript 类型检查 | PASS |
| 单元、CLI 与原生 ygl 集成 | 22 项通过，0 失败，0 跳过 |
| 原生集成 | 两步交付、证据同步、context 隔离、跨进程竞争、图漂移拦截通过 |
| 进程中断 | 执行意图落账后退出，再恢复同一尝试；不新建生成请求 |
| 宿主协议夹具 | 输入绑定、真实文件回接、批准区域合成、检查与取消后留痕通过 |
| 离线命令行演示 | PASS，第二步使用第一步实际输出；原图保持 |
| 真实宿主 AI 出图／商品语义质量 | NOT_RUN |
| 独立图像 API | NOT_RUN，fallback 适配器尚未实现 |

## 复现命令

```text
npm ci
npm run typecheck
node scripts/test.mjs --unit-only
node scripts/test.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
node scripts/demo.mjs --ygl-entry <已安装的-ygl/dist/bundle/bin.cjs>
```

`--unit-only` 明确跳过原生集成，不能作为完整通过的依据。完整运行需要已验证的 ygl 发布包；所有测试使用项目 `tmp/` 下的隔离工作区，不依赖浏览器插件归档、初始研究目录或用户默认 ygl 数据库。

脚本会保存最新 JSON 索引及不可变运行报告，包含实际退出码、TAP 计数、源码 hash、原生图与证据身份。报告中的本机路径和原生记录不提交 Git，可在本地生成后审阅。本文为去除本机路径的公开摘要，后续提交的结果以对应源码和新运行报告为准。

单份授权只绑定一个运行、覆盖其已批准步骤；未解决的宿主请求不自动重发。完整生产故障矩阵、其他平台和独立第三方评审尚未因这些测试被宣称通过。
