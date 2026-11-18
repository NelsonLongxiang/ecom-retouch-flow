# Retouch validation project data pack

Formal execution reuses [the maintained test runner](../../../scripts/test.mjs), [native transport](../../../scripts/lib/native-ygl.mjs) and product invariant gates. This directory is pure data, not a second engine. See [ADR-005](../../../docs/ADR-005-validation-convergence.md).

`pack.json` uses an explicitly project-local schema. Candidate AST and author notes are traceable construction inputs, **not a frozen or independently blind-reviewed upstream spec**. ygl0.125.0 prepare/run/full corpus paths automatically delete transient snapshots; under this task no-delete instruction those paths are NOT_RUN. A draft/manual instance registration is not execution evidence.

The formal `--suite validation` executes known-positive PASS, required-item FAIL and UNKNOWN with actual native witnesses, rejects acceptance for the failed case, and checks byte/JSON/reference/request preservation. Its project self-check is not the upstream full self-check. A supplied business FAIL remains separate. No private product bytes or real native business state are imported.

Runtime outputs stay under the task tmp and are copied exclusively to the existing ignored durable verification evidence area; no runs or local asset paths enter Git. No source-asset deletion, move or historical report replacement is performed. The native engine still manages ephemeral locks using its normal lifecycle; this is not a whole-call-chain zero-delete claim. The isolated fixture explicitly retains request JSON on initialize/open/call, while existing business defaults remain unchanged.
