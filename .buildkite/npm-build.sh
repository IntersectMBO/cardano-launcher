#!/usr/bin/env bash

set -euo pipefail

echo "--- Install node_modules"

npm install

echo "--- Build"

npm run build

echo "--- Test"

npx tsdx test --collect-coverage 

echo "--- Rebuild docs"

npm run typedoc
