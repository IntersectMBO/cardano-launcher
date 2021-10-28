#!/usr/bin/env bash

set -euo pipefail

cd $(dirname "$0")/..

force=""
dry_run=""

for i in "$@"
do
case $i in
    -f|--force)
      force="$1"
      shift
    ;;
    -n|--dry_run)
      dry_run="echo"
      shift
    ;;
    *)
      echo "Usage: $0 [-f | --force] [-n | --dry-run]"
      exit 1
    ;;
esac
done

version=$(jq -r .version package.json)
mapfile -t versions < <(git tag --list '0.20*' | grep -v "$version" | sort -r)
prev_version="${versions[0]}"

wallet_rev=$(jq -r '.["cardano-wallet"].rev' nix/sources.json)

wallet_version=$(cardano-wallet version | cut -d\  -f1)
node_version=$(cardano-node --version | head -1 | cut -d\  -f2)

$dry_run git tag --sign $force -a -m "$version" "$version"

release_notes="release-notes-$version.md"

get_merged_pr_list() {
    git log --pretty=%s --grep '^Merge.*' "$prev_version..$version" | sed -ne 's=^Merge.*\(refs/pullreqs/\|#\)\([0-9]\+\).*=\2=p'
}

list_prs() {
    curl --silent -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/input-output-hk/cardano-launcher/pulls?state=all&sort=created&direction=desc"
}

get_merged_pr_info() {
    list_prs | jq --slurpfile prs <(get_merged_pr_list) '.[]|select(.number as $num|$prs|contains([$num]))|{title,number,html_url,labels: [.labels[].name]}'
}

format_pr_list() {
  jq -r --slurp '.|sort_by(.labels)|.[]|"* [\(.labels|join(" "))]  \(.title)  [#\(.number)](\(.html_url))\n"'
}

gen_release_notes() {
    cat <<EOF
# cardano-launcher $version

This release contains [cardano-wallet $wallet_version](https://github.com/input-output-hk/cardano-wallet/releases/tag/$wallet_version) (revision [${wallet_rev:7}](https://github.com/input-output-hk/cardano-wallet/commit/$wallet_rev) and [cardano-node $node_version](https://github.com/input-output-hk/cardano-node/releases/tag/$node_version).

* :package: [NPM Package](https://www.npmjs.com/package/cardano-launcher/v/$version)
* :green_book: [API Documentation](https://input-output-hk.github.io/cardano-launcher/$version/modules.html)

## Changes since $prev_version

### New features
### Improvements
### Chores

### Uncategorized

EOF

    get_merged_pr_info | format_pr_list

    cat <<EOF
## Signatures

Name                           | Role                | Approval
---                            | ---                 | ---:
Rodney Lorrimar @rvl           | Adrestia Team Lead  | :hourglass:
Piotr Stachyra @piotr-iohk     | QA Engineer         | :hourglass:
Laurence Jenkins @LaurenceIO   | Release Manager     | :hourglass:

EOF
}

if [[ -n "$dry_run" ]]; then
    gen_release_notes
elif [[ ! -e "$release_notes" || -n "$force" ]]; then
    gen_release_notes | tee "$release_notes"
else
    echo "$release_notes: Refusing to overwrite file without --force"
    exit 2
fi
