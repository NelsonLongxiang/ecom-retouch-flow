# Retouch validation project data pack

This is the existing pure-data project pack, revision1.1.0; not an upstream frozen spec or a second engine. Execution reuses [the maintained runner](../../../scripts/test.mjs) and [existing validation tests](../../../tests/native-validation.test.ts).

## Owner-ratified construction contract

- This dataset requires at least one required observation. Empty/all-optional data is NEEDS-MATERIAL, never PASS.
- [SQLite schema](fixtures/schema.sql) uses STRICT plus ANY/typeof to reject NULL/non-integer/out-of-range required values without numeric-text coercion. Optional verdictNULL is allowed. Required verdictNULL/FAIL/UNKNOWN blocks PASS. Native domain observation UNKNOWN remains UNKNOWN; the SQL gate verdict FAIL merely means its “must be PASS” assertion failed.
- [Candidate](candidates.json) scans required=1 and finds explicit IS NULL or !=PASS violations. Schema admission is mandatory; candidate-only execution on arbitrary unvalidated schemas is not supported. The construction test uses a fixed SQL oracle for the pinned AST; it is not an upstream renderer or engine.
- [Responsibilities](coverage.json) maps S1 to the SQL construction slice and S2/S3 to real maintained test consumers. It does not exempt S2/S3 or claim one S1 candidate covers the full material. Full-material upstream freeze remains NOT_READY until each clause has adequate upstream representation and independent review.

## Verification scope and preservation

Run only construction checks with `node --test --test-name-pattern="project pack construction required-domain and NULL cases" tests/native-validation.test.ts` through the existing capture transport with a project task logRoot. Other native/CLI tests are not run by this selected slice. The maintained `--suite validation` still includes this file for a future fully admitted integration run.

The existing positive/negative/unknown fixture keys remain for native consumers. New row datasets and invalid inputs use in-memory SQLite; no DB files or cleanup are needed. Package hashes cover all construction inputs. Genuine independent reviews must identify exact candidate/schema/coverage bytes; empty pending reviews or prior author notes are not acceptance.

Current upstream0.125 prepare: attachment-free/no-run first draft is only a conditionally investigated path, not zero-delete admission. Existing review/input and complete side-effect gates must pass first. Run always makes and cleans working snapshots; full corpus cleanup conflicts with the no-delete instruction. `--no-cases` skips, and current limit is applied after all cases execute. Do not bypass, modify shared installation, deep-import a parallel engine, or call skipped self-check green.

Old1.0.0 inputs are exclusively preserved in the project ignored durable verification area before revision. Source and business originals/cache remain in place; no delete/move. This package revision, developer checks and independent construction review do not resolve H1–H4, C1delivery, full upstream triple, whole-batch HOLD or authorize a next batch.
