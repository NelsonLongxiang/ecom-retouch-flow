# Retouch validation project criteria v1.1

S1 当前必检观察数据集的required必须为整数0或1且非NULL；空表或无required=1时不具备验收条件（NEEDS-MATERIAL）；required=1的verdict为NULL或不为PASS时阻断通过。

S2 软件记录与工具自检通过不改变原业务图像FAIL、UNKNOWN或人工接受。

S3 CLI经本仓目录链接启动仍必须输出完整retouch.cli/v2 JSON；import不执行。

Scope: isolated given observations and process evidence only. S1 is the SQL construction slice; S2/S3 retain their maintained native test consumers. This is not a single upstream frozen spec covering all three clauses.
