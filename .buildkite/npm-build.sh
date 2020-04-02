#!/usr/bin/env bash

set -euo pipefail

echo "--- Install"

npm install

echo "--- Build"

npm run build

echo "--- Test"

npm run test -- --collect-coverage

echo "--- Lint"

npm run lint

echo "--- Rebuild docs"

npm run typedoc
