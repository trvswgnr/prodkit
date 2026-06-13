import { createCatalogApp, CatalogFetchError } from "./sample.ts";
import { assert } from "../../support/assert.ts";
import { Policy } from "@prodkit/op/policy";
import { waitUntilAbort } from "../../support/helpers.ts";

export async function runCancelPropagationExampleSmoke() {
  const happyPathApp = createCatalogApp({
    fetchMetadataFromCache: async (sku) => ({ sku, source: "cache" }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (sku) => ({ sku, cents: 1_299 }),
    fetchReviewSummary: async () => ({ averageRating: 4.5 }),
    fetchReviewHighlights: async () => ({ quotes: ["solid build quality"] }),
  });

  const pageOk = await happyPathApp.loadProductPage.run("sku-1");
  assert(pageOk.isOk(), "signal propagation happy path failed");
  if (pageOk.isOk()) {
    assert(pageOk.value.pricing.cents === 1_299, "signal propagation pricing check failed");
    assert(pageOk.value.reviews.length === 2, "signal propagation nested all check failed");
    assert(
      pageOk.value.reviews[0].averageRating === 4.5,
      "signal propagation review summary check failed",
    );
  }

  let cacheMetadataAborted = false;
  const raceApp = createCatalogApp({
    fetchMetadataFromCache: async (sku, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ sku, source: "cache" }), 50);
        signal.addEventListener(
          "abort",
          () => {
            cacheMetadataAborted = true;
            clearTimeout(timer);
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (sku) => ({ sku, cents: 999 }),
    fetchReviewSummary: async () => ({ averageRating: 4.1 }),
    fetchReviewHighlights: async () => ({ quotes: ["fast shipping"] }),
  });

  const raceResult = await raceApp.loadProductPage.run("sku-1");
  assert(raceResult.isOk(), "signal propagation race path failed");
  if (raceResult.isOk()) {
    assert(
      raceResult.value.metadata.source === "origin",
      "signal propagation race winner check failed",
    );
  }
  assert(cacheMetadataAborted, "signal propagation race loser abort check failed");

  const abortedBranches: string[] = [];
  let pricingStarted = false;
  const cancelApp = createCatalogApp({
    fetchMetadataFromCache: async (sku) => ({ sku, source: "cache" }),
    fetchMetadataFromOrigin: async (sku) => ({ sku, source: "origin" }),
    fetchPricing: async (_sku, signal) => {
      pricingStarted = true;
      await waitUntilAbort(signal, () => abortedBranches.push("pricing"));
      throw new Error("unreachable");
    },
    fetchReviewSummary: async (_sku, signal) => {
      await waitUntilAbort(signal, () => abortedBranches.push("review-summary"));
      throw new Error("unreachable");
    },
    fetchReviewHighlights: async (_sku, signal) => {
      await waitUntilAbort(signal, () => abortedBranches.push("review-highlights"));
      throw new Error("unreachable");
    },
  });

  const controller = new AbortController();
  const cancelledRun = cancelApp.loadProductPage
    .with(Policy.cancel(controller.signal))
    .run("sku-1");
  // oxlint-disable-next-line no-unmodified-loop-condition
  for (let attempt = 0; attempt < 20 && !pricingStarted; attempt += 1) {
    await Promise.resolve();
  }
  assert(pricingStarted, "signal propagation cancel setup failed to start nested all work");
  controller.abort(new Error("navigation cancelled"));

  const cancelled = await cancelledRun;
  assert(cancelled.isErr(), "signal propagation external cancel should fail");
  assert(
    cancelled.error instanceof CatalogFetchError,
    "signal propagation external cancel error type check failed",
  );
  assert(
    abortedBranches.includes("pricing"),
    "signal propagation external cancel pricing abort check failed",
  );
  assert(
    abortedBranches.includes("review-summary"),
    "signal propagation external cancel review-summary abort check failed",
  );
  assert(
    abortedBranches.includes("review-highlights"),
    "signal propagation external cancel review-highlights abort check failed",
  );
}
