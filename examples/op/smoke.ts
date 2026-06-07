import { runCoreApiSmoke } from "./core/smoke.ts";
import { runSimpleExampleSmoke } from "./simple/smoke.ts";
import { runDeferResourceExampleSmoke } from "./defer-resource/smoke.ts";
import { runCancelPropagationExampleSmoke } from "./cancel-propagation/smoke.ts";
import { runWebhookExampleSmoke } from "./webhook/smoke.ts";
import { runQueueConsumerExampleSmoke } from "./queue-consumer/smoke.ts";
import { runCustomPolicyExampleSmoke } from "./custom-policy/smoke.ts";

export async function runOpExamplesSmoke() {
  await runCoreApiSmoke();
  await runSimpleExampleSmoke();
  await runDeferResourceExampleSmoke();
  await runCancelPropagationExampleSmoke();
  await runWebhookExampleSmoke();
  await runQueueConsumerExampleSmoke();
  await runCustomPolicyExampleSmoke();
}
