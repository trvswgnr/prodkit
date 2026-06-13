# DI examples

Runnable `@prodkit/op/di` samples. Each topic folder has `sample.ts` (the program) and `smoke.ts`
(assertions). `smoke.ts` at this level aggregates all topic smokes.

| Topic | Sample | What it shows |
| --- | --- | --- |
| `onboarding/` | [`sample.ts`](onboarding/sample.ts) | Tokens, `DI.provide`, registration flow |
| `cancellation/` | [`sample.ts`](cancellation/sample.ts) | Scoped bindings and abort during factory resolution |
| `http-handler/` | [`sample.ts`](http-handler/sample.ts) | Pool checkout, handler routing, typed errors |
