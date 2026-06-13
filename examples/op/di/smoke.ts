import { runOnboardingExampleSmoke } from "./onboarding/smoke.ts";
import { runCancellationExampleSmoke } from "./cancellation/smoke.ts";
import { runHttpHandlerExampleSmoke } from "./http-handler/smoke.ts";

export async function runDiExamplesSmoke() {
  await runOnboardingExampleSmoke();
  await runCancellationExampleSmoke();
  await runHttpHandlerExampleSmoke();
}
