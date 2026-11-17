import test from "node:test";
import { physicalReferenceCases } from "./helpers/physical-reference-cases.ts";

// Existing native facts/prompt functions only: no database, CLI or visual evaluation.
for (const scenario of physicalReferenceCases)
  test(scenario.name, scenario.run);
