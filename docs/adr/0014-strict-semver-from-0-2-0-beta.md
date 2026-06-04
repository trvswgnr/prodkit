---
status: accepted
title: Strict SemVer from 0.2.0 beta
packages:
  - "@prodkit/op"
---

# Strict SemVer from 0.2.0 beta

Before beta, `@prodkit/op` shipped many `0.1.x` releases while the public surface was still
moving. Consumers needed a clear signal that the library is entering a supported beta line and
that version numbers encode compatibility promises.

## Decision

- **0.2.0** is the first **beta** release of `@prodkit/op`.
- From **0.2.0** onward, published versions follow [Semantic Versioning](https://semver.org/) strictly:
  - **Major**: incompatible API changes.
  - **Minor**: new functionality in a backward-compatible way.
  - **Patch**: backward-compatible bug fixes.
- Pre-0.2.0 `0.1.x` history does not define post-beta compatibility; treat 0.2.0 as the baseline for
  semver guarantees going forward.

Public README and deprecation policy docs state this scheme for consumers.

## Why not stay on open-ended 0.x semantics

Some projects treat all `0.y.z` releases as "minor may break." That convention conflicts with
calling a release **beta** while also promising predictable upgrades. Strict semver from 0.2.0
makes the beta line legible without jumping to `1.0.0` before the maintainer is ready to signal
long-term API stability.

## Considered options

**Stay on `0.1.x` with informal breaking minors.** Rejected: does not match the beta milestone or
the need for an explicit compatibility contract.

**Ship `1.0.0-beta.x` prereleases.** Rejected: implies a 1.0 stability promise the project is not
making yet; `0.2.0` beta is a clearer staging label.

## Consequences

- Release tooling and changelog discipline must classify changes into major, minor, and patch
  buckets before publish.
- Breaking changes after 0.2.0 require a major version bump (for example `1.0.0` when the first
  post-beta breaking change ships).
