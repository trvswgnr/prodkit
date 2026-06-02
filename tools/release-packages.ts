import { unsafeCoerce } from "@prodkit/shared/runtime";

export const RELEASE_PACKAGES = {
  op: {
    npmName: "@prodkit/op",
    packageDir: "packages/op",
    tagPrefix: "op",
  },
  std: {
    npmName: "@prodkit/std",
    packageDir: "packages/std",
    tagPrefix: "std",
  },
} as const;

export type ReleasePackageId = keyof typeof RELEASE_PACKAGES;

export const ReleasePackageId = unsafeCoerce(Object.keys(RELEASE_PACKAGES));

export function isReleasePackageId(value: string): value is ReleasePackageId {
  return Object.hasOwn(RELEASE_PACKAGES, value);
}

export function releaseTag(id: ReleasePackageId, version: string): string {
  return `${RELEASE_PACKAGES[id].tagPrefix}-v${version}`;
}

export const RELEASE_CUT_USAGE = "usage: node ./tools/release-cut.ts <op|std> <patch|minor|major>";

export const CHANGELOG_CHECK_USAGE = "usage: node ./tools/check-changelog-version.ts <op|std>";
