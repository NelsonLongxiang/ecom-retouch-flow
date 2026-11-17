import test from "node:test";
import { runnerEvidenceCases } from "./helpers/runner-evidence-cases.ts";

for (const scenario of runnerEvidenceCases) test(scenario.name, scenario.run);
