#!/bin/sh
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
semgrep --metrics off --json --config /Users/steward/App/tPAAW/data/semgrep-rules/javascript --config /Users/steward/App/tPAAW/data/semgrep-rules/typescript --config /Users/steward/App/tPAAW/data/semgrep-rules/problem-based-packs --include "*.js" --include "*.mjs" --include "*.cjs" --include "*.jsx" --include "*.ts" --include "*.tsx" --include "*.py" --include "*.java" --include "*.go" --include "*.rb" --include "*.php" --include "*.c" --include "*.cpp" --include "*.cs" --exclude node_modules --exclude .git --exclude dist --exclude build --exclude coverage --exclude data/semgrep-rules --quiet /Users/steward/App/agent-sre
