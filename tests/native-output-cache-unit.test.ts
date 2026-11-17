import test from "node:test";
import { outputCacheCases } from "./helpers/output-cache-cases.ts";

// Same callable cases are used by the official suite and bounded in-process checks.
for (const scenario of outputCacheCases) test(scenario.name, scenario.run);
