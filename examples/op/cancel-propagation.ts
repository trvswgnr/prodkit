import { Op } from "@prodkit/op";
import { TaggedError } from "better-result";

export type ProductMetadata = {
  sku: string;
  source: "cache" | "origin";
};

export type Pricing = {
  sku: string;
  cents: number;
};

export type ReviewSummary = {
  averageRating: number;
};

export type ReviewHighlights = {
  quotes: string[];
};

export type CatalogDeps = {
  fetchMetadataFromCache: (sku: string, signal: AbortSignal) => Promise<ProductMetadata>;
  fetchMetadataFromOrigin: (sku: string, signal: AbortSignal) => Promise<ProductMetadata>;
  fetchPricing: (sku: string, signal: AbortSignal) => Promise<Pricing>;
  fetchReviewSummary: (sku: string, signal: AbortSignal) => Promise<ReviewSummary>;
  fetchReviewHighlights: (sku: string, signal: AbortSignal) => Promise<ReviewHighlights>;
};

export class CatalogFetchError extends TaggedError("CatalogFetchError")<{
  source: string;
  cause?: unknown;
}>() {}

export function createCatalogApp(deps: CatalogDeps) {
  const fetchMetadataFromCache = Op(function* (sku: string) {
    return yield* Op.try(
      (signal) => deps.fetchMetadataFromCache(sku, signal),
      (cause) => new CatalogFetchError({ source: "metadata-cache", cause }),
    );
  });

  const fetchMetadataFromOrigin = Op(function* (sku: string) {
    return yield* Op.try(
      (signal) => deps.fetchMetadataFromOrigin(sku, signal),
      (cause) => new CatalogFetchError({ source: "metadata-origin", cause }),
    );
  });

  const fetchPricing = Op(function* (sku: string) {
    return yield* Op.try(
      (signal) => deps.fetchPricing(sku, signal),
      (cause) => new CatalogFetchError({ source: "pricing", cause }),
    );
  });

  const fetchReviewSummary = Op(function* (sku: string) {
    return yield* Op.try(
      (signal) => deps.fetchReviewSummary(sku, signal),
      (cause) => new CatalogFetchError({ source: "review-summary", cause }),
    );
  });

  const fetchReviewHighlights = Op(function* (sku: string) {
    return yield* Op.try(
      (signal) => deps.fetchReviewHighlights(sku, signal),
      (cause) => new CatalogFetchError({ source: "review-highlights", cause }),
    );
  });

  const loadReviews = Op(function* (sku: string) {
    // Nested Op.all: review feeds share the same branch signal from the outer Op.all tree.
    return yield* Op.all([fetchReviewSummary(sku), fetchReviewHighlights(sku)]);
  });

  const loadProductPage = Op(function* (sku: string) {
    // Op.race: first metadata source wins; the slower sibling is aborted cooperatively.
    const metadata = yield* Op.race([fetchMetadataFromCache(sku), fetchMetadataFromOrigin(sku)]);

    // Outer Op.all: pricing and the nested review bundle run in parallel under one parent signal.
    const [pricing, reviews] = yield* Op.all([fetchPricing(sku), loadReviews(sku)]);

    return { metadata, pricing, reviews };
  });

  return { loadProductPage };
}
