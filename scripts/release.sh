#!/usr/bin/env bash
# Cut a release: tag the current `main` and let CI publish the image.
#
#   scripts/release.sh 0.3.0            # full release
#   scripts/release.sh 0.3.0 --dry-run  # run every check, change nothing
#
# The image is built, pushed to ghcr.io, signed (cosign keyless) and given an SBOM by
# .github/workflows/release.yml when the tag lands. It is not built here: a local build
# would be unsigned and would match the laptop's CPU architecture, not the server's.
# `main` only accepts changes through pull requests, so the script never commits or pushes `main`:
# it tags the commit already on origin/main and pushes only the tag. The tag is the version; the
# root package.json version is not used. Releases do not deploy anything: production moves to the new
# version only when BREVOLT_VERSION is changed in Dokploy (docs/deployment.md#production).
set -euo pipefail

usage() {
  echo "usage: $0 <X.Y.Z> [--dry-run]" >&2
  exit 2
}

VERSION="${1:-}"
DRY_RUN=false
if [[ $# -eq 2 && "$2" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ $# -ne 1 ]]; then
  usage
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
TAG="v$VERSION"

step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

for cmd in git gh pnpm; do
  command -v "$cmd" >/dev/null || fail "$cmd is required"
done

cd "$(git rev-parse --show-toplevel)"

step "Checking the repository"
[[ "$(git branch --show-current)" == "main" ]] || fail "run from main"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean"
git fetch --quiet --tags origin main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail "main is not in sync with origin/main"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && fail "tag $TAG already exists"

LAST_TAG="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
if [[ -n "$LAST_TAG" ]]; then
  HIGHEST="$(printf '%s\n%s\n' "${LAST_TAG#v}" "$VERSION" | sort -V | tail -n1)"
  [[ "$HIGHEST" == "$VERSION" ]] || fail "$TAG is not newer than $LAST_TAG"
  echo "previous release: $LAST_TAG"
fi

step "Checking CI on $(git rev-parse --short HEAD)"
CI="$(gh run list --workflow CI --commit "$(git rev-parse HEAD)" --event push --limit 1 \
  --json status,conclusion --jq '.[0] | "\(.status)/\(.conclusion)"')"
[[ "$CI" == "completed/success" ]] || fail "CI for HEAD is '${CI:-missing}', wait for it to pass"

step "Building and testing locally"
pnpm install --frozen-lockfile
pnpm lint
pnpm format
pnpm typecheck
pnpm test

if $DRY_RUN; then
  step "Dry run: would tag $(git rev-parse --short HEAD) as $TAG and push the tag"
  exit 0
fi

step "Tagging $(git rev-parse --short HEAD) as $TAG"
git tag -a "$TAG" -m "$TAG"

step "Pushing $TAG"
if ! git push origin "refs/tags/$TAG"; then
  # Drop the local tag so the release can be retried once the push problem is fixed.
  git tag -d "$TAG" >/dev/null
  fail "could not push $TAG"
fi

step "Waiting for the Release workflow"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --workflow release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
  [[ -n "$RUN_ID" ]] && break
  sleep 5
done
[[ -n "$RUN_ID" ]] || fail "Release workflow did not start for $TAG; check GitHub Actions"
gh run watch "$RUN_ID" --exit-status

step "Creating the GitHub release"
PRERELEASE=()
[[ "$VERSION" == 0.* ]] && PRERELEASE=(--prerelease)
# The ${a[@]+...} form keeps macOS bash 3.2 happy with an empty array under `set -u`.
gh release create "$TAG" --verify-tag --generate-notes ${PRERELEASE[@]+"${PRERELEASE[@]}"}

IMAGE="ghcr.io/$(gh repo view --json nameWithOwner --jq .nameWithOwner):$VERSION"
if command -v cosign >/dev/null; then
  step "Verifying $IMAGE"
  REPO_URL="https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  cosign verify "$IMAGE" \
    --certificate-identity "$REPO_URL/.github/workflows/release.yml@refs/tags/$TAG" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null
  echo "signature ok"
else
  echo "cosign not installed; skipped signature check (see docs/deployment.md#cut-a-release)"
fi

step "Released $TAG: $IMAGE"
echo "To upgrade production, set BREVOLT_VERSION=$VERSION in Dokploy and redeploy (docs/deployment.md#production)."
