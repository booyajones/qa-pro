#!/usr/bin/env bash
# qa-pro self-test — validates the skill is installed and working
# Runs: doctor → init in temp project → smoke against test URL → cleanup
#
# Usage: bash selftest.sh [test-url]
#  Default test-url: https://chriswyatt.dev

set -e

TEST_URL="${1:-https://chriswyatt.dev}"
SKILL_DIR="$HOME/.claude/skills/qa-pro"
TEST_PROJECT_RAW="${TMPDIR:-$HOME/Downloads}/qa-pro-selftest-$(date +%s)"
mkdir -p "$TEST_PROJECT_RAW"
# On Git-Bash-for-Windows, Node is a native Windows binary and needs Windows-style paths.
# cygpath converts /c/... → C:\... so Node doesn't double the drive letter.
if command -v cygpath >/dev/null 2>&1; then
  # -m gives mixed style (C:/Users/...) which works in both bash and native Windows tools
  TEST_PROJECT=$(cygpath -m "$TEST_PROJECT_RAW")
  SKILL_DIR_W=$(cygpath -m "$SKILL_DIR")
else
  TEST_PROJECT="$TEST_PROJECT_RAW"
  SKILL_DIR_W="$SKILL_DIR"
fi
trap 'rm -rf "$TEST_PROJECT_RAW"' EXIT

echo "=== qa-pro self-test ==="
echo "Skill: $SKILL_DIR"
echo "Test project: $TEST_PROJECT"
echo "Test URL: $TEST_URL"
echo

echo "Step 1/4: init"
node "$SKILL_DIR_W/scripts/init.js" "$TEST_PROJECT" --url "$TEST_URL" --type static-site --name selftest --non-interactive
echo

echo "Step 2/4: doctor (post-init; allow yellow, fail on red)"
node "$SKILL_DIR_W/scripts/doctor.js" "$TEST_PROJECT"; DOCTOR_RC=$?
if [ "$DOCTOR_RC" -gt 1 ]; then
  echo "FAIL: doctor reported red rows (rc=$DOCTOR_RC)"
  exit 1
fi
echo

echo "Step 3/4: validate config"
node "$SKILL_DIR_W/scripts/validate-config.js" "$TEST_PROJECT/.qa/config.yml" > "$TEST_PROJECT/.qa/config.json"
echo "config validated"
echo

echo "Step 4/4: smoke run"
node "$SKILL_DIR_W/scripts/smoke-runner.js" "$TEST_PROJECT/.qa/config.json" > "$TEST_PROJECT/.qa/findings.json"
COUNT=$(node -e "console.log((JSON.parse(require('fs').readFileSync('$TEST_PROJECT/.qa/findings.json','utf8')).findings||[]).length)")
echo "smoke complete: $COUNT findings"
echo

echo "=== self-test PASSED ==="
echo "Cleanup: rm -rf $TEST_PROJECT"
rm -rf "$TEST_PROJECT"
