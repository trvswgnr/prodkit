import { createApp as createCustomPolicyApp } from "./custom-policy.ts";
import { assert } from "../assert.ts";

export async function runCustomPolicyExampleSmoke() {
  const app = createCustomPolicyApp();

  const openResult = await app.loadDashboard(false).run("user-123");
  assert(openResult.isOk(), "custom policy open path failed");
  if (openResult.isOk()) {
    assert(openResult.value.userId === "user-123", "custom policy open user id check failed");
    assert(openResult.value.widgets.length === 2, "custom policy open widgets check failed");
  }

  const blockedResult = await app.loadDashboard(true, "emergency").run("user-123");
  assert(blockedResult.isErr(), "custom policy maintenance gate should fail");
  if (blockedResult.isErr()) {
    assert(
      blockedResult.error._tag === "MaintenanceBlocked" && blockedResult.error.mode === "emergency",
      "custom policy maintenance error shape check failed",
    );
  }
}
