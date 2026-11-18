# SUPERSEDED · implicit latest navigation only

This pointer supersedes only the use of `native-design-capture.json` as an implicit current result. It does not retire the [native design capture tool](../../scripts/capture-context-design.mjs), change the old report, promote its verdict, or authorize cleanup.

- Original local report: `native-design-capture.json` (machine evidence, not distributed with Git).
- Preserved original SHA-256: `0791d7772e48abfb418063852cc8a18374963ebc5c8f74752e17f5a906f69956` (197981 bytes).
- Historical source baseline: `5cef8cb9227aaf3414c638fb52c614f74ed0b944` (display SHA16 `5cef8cb9227aaf341`).
- Successor navigation: the exact unique report returned by the maintained tool, under `runs/native-design-capture-<unique-id>.json`; do not infer latest from filename order. The source commit containing this pointer is bound by the task evidence map after narrow commit.
- Consumer rule: design capture now requires explicit `--probe-report <project-owned immutable report>` and validates it before native work. Runtime reports stay ignored; no business images or credentials are copied here.
- Recovery: retain and read the original report at its old position and preserved copy manifest. Any future code rollback requires review of later work; do not delete evidence or overwrite subsequent artifacts.

Scope and exclusions: [ADR-005](../ADR-005-validation-convergence.md) and [project pack](../../verify/packs/retouch-validation/README.md). This is source navigation, not software/business acceptance.
