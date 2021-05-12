#!/usr/bin/env bash

set -euo pipefail

cd $(dirname "$0")/..

force=""

for i in "$@"
do
case $i in
    -f|--force)
    force="$1"
    shift
    ;;
    *)
          echo "Usage: $0 [-f | --force]"
          exit 1
    ;;
esac
done

version=$(jq -r .version package.json)
mapfile -t versions < <(git tag --list '0.20*' | grep -v "$version" | sort -r)
prev_version="${versions[0]}"

git tag --sign $force -a -m "$version" "$version"

release_notes="release-notes-$version.md"

get_merged_pr_list() {
    git log --pretty=%s --grep '^Merge.*' "$prev_version..$version" | sed -ne 's=^Merge.*\(refs/pullreqs/\|#\)\([0-9]\+\).*=\2=p'
}

list_prs() {
    curl --silent -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/input-output-hk/cardano-launcher/pulls?state=all&sort=created&direction=desc"
}

get_merged_pr_info() {
    list_prs | jq --slurpfile prs <(get_merged_pr_list) '.[]|select(.number as $num|$prs|contains([$num]))|{title,number,url,labels: [.labels[].name]}'
}

gen_release_notes() {
    echo "# cardano-launcher $version"
    echo
    echo "Previous version: $prev_version"
    echo "cardano-wallet rev: $(jq -r '.["cardano-wallet"].rev' nix/sources.json)"
    echo
    echo "### New features"
    echo "### Improvements"
    echo "### Chores"
    echo

   get_merged_pr_info | jq -r --slurp '.|sort_by(.labels)|.[]|"* [\(.labels|join(" "))]  \(.title)  [#\(.number)](\(.url))\n"'
}

if [ -e "$release_notes" -a -z "$force" ]; then
    echo "$release_notes: Refusing to overwrite file without --force"
    exit 2
else
    gen_release_notes | tee "$release_notes"
fi
