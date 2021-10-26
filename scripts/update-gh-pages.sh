#!/usr/bin/env bash

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "usage: $0 GIT_REF_NAME"
    exit 1
fi

site="$(jq -r .typedocOptions.out tsconfig.json)"

if [ ! -f "$site/modules.html" ]; then
    echo "Doc file $site/modules.html does not exist. First build with:"
    echo "  npm run typedoc"
    exit 2
fi

if [[ "$1" =~ ^refs/tags/ ]]; then
  tag="${1/refs\/tags\//}"
  dir="$tag"
else
  dir="dev"
  tag=""
fi

mkdir "$site.tmp"
mv "$site" "$site.tmp/$dir"
mv "$site.tmp" "$site"
touch "$site/.nojekyll"

if [ -n "$tag" ]; then
    cat > $site/index.html <<EOF
<!DOCTYPE html>
<meta charset="utf-8">
<title>Redirecting to $tag</title>
<meta http-equiv="refresh" content="0; url=./$tag/">
EOF
fi
