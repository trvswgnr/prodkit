# Security policy

## Reporting a vulnerability

Report security defects in published prodkit npm packages through GitHub Private Vulnerability
Reporting (PVR) on this repository. Open the [Security tab](https://github.com/trvswgnr/prodkit/security)
and use **Report a vulnerability**. Do not file public issues for undisclosed security defects.

PVR is the only supported reporting channel. There is no separate security email alias.

## In scope

Security defects in published npm packages that consumers can trigger through the public API:

- `@prodkit/op`
- `@prodkit/std`

## Out of scope

- Examples, benchmarks, and maintainer tooling (`@prodkit/tools`)
- CI workflows and repository automation
- Documentation without a plausible exploit path
- Vulnerabilities in third-party dependencies (report upstream; maintainers still ship dependency
  updates through the normal release process)

Dependency CVEs in the monorepo lockfile are handled through Dependabot security PRs, not PVR.
See [Dependency security](CONTRIBUTING.md#dependency-security) in `CONTRIBUTING.md`.

## What to include

- Affected package and version
- Reproduction steps or proof of concept
- Impact (confidentiality, integrity, availability, or privilege boundary crossed)

## Supported versions

Supported releases follow the deprecation policy in [`CONTRIBUTING.md`](CONTRIBUTING.md#deprecation-policy):
the latest release on each supported major line receives security fixes.

`@prodkit/op` releases before `0.2.0` (`0.1.x`) do not receive security fixes.

## Response and disclosure

- **Acknowledgment:** within 7 days of a valid PVR report
- **Disclosure:** coordinated. Prefer shipping a fix before public disclosure. Target 90 days from
  report unless the reporter and maintainer agree otherwise.
- **Rewards:** no bug bounty program
