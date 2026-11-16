#!/usr/bin/env bash
# Applies repository security settings (R-SEC-5, R-SEC-13, R-SEC-15). Needs repo admin via `gh auth`.
# Usage: scripts/apply-repo-security.sh [owner/repo]
set -euo pipefail
REPO="${1:-brevolt/brevolt}"
# Code Security (CodeQL) is off until the repo is public or has a GitHub Code Security license.
# Run with ENABLE_CODE_SECURITY=1 to turn it on.
ADVANCED_SECURITY=disabled; [ "${ENABLE_CODE_SECURITY:-0}" = 1 ] && ADVANCED_SECURITY=enabled

# GitHub Code Security (needed by CodeQL on private repos), secret scanning + push protection.
gh api -X PATCH "repos/$REPO" --input - <<JSON
{"security_and_analysis":{
  "advanced_security":{"status":"$ADVANCED_SECURITY"},
  "secret_scanning":{"status":"enabled"},
  "secret_scanning_push_protection":{"status":"enabled"}}}
JSON

# Protected main: required checks, mandatory review, linear history, no force-push.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<JSON
{
  "required_status_checks": {"strict": true,
    "contexts": ["lint","typecheck","test","secrets","audit"]},
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 1,
    "dismiss_stale_reviews": true},
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

# Signed commits on main.
gh api -X POST "repos/$REPO/branches/main/protection/required_signatures"
echo "Applied to $REPO"
