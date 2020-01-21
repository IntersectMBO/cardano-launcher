#!/usr/bin/env bash

set -euo pipefail

rev=$(git rev-parse --short HEAD)
cd $(git rev-parse --show-toplevel)

echo "Building..."
rm -rf docs
npm run typedoc
touch docs/.nojekyll

if ! git diff-index --quiet HEAD --; then
    echo "There are uncommitted changes - aborting!"
    exit 1
fi

echo "Updating git index..."
git fetch origin
git checkout gh-pages
git reset --hard origin/gh-pages
GIT_WORK_TREE=$(pwd)/docs git add -A

if git diff-index --cached --quiet HEAD --; then
  echo "No changes to commit, exiting."
  exit 0
fi

echo "Committing changes..."
git commit --no-gpg-sign --message "Update gh-pages for $rev"
