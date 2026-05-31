import { runOpExamplesSmoke } from "./op/smoke.ts";
import { runDiExamplesSmoke } from "./op/di/smoke.ts";

await runOpExamplesSmoke();
await runDiExamplesSmoke();
