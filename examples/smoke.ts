import { runOpExamplesSmoke } from "./op/smoke.ts";
import { runDiExamplesSmoke } from "./op/di/smoke.ts";
import { runStdExamplesSmoke } from "./std/smoke.ts";

await runOpExamplesSmoke();
await runDiExamplesSmoke();
await runStdExamplesSmoke();
