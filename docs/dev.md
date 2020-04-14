# Development docs

## How to update the website

To update https://input-output-hk.github.io/cardano-launcher/, run the
[update-gh-pages](./scripts/update-gh-pages.sh) script:

    ./scripts/update-gh-pages.sh
    git push origin gh-pages

## How to update the cardano-wallet and cardano-node versions

Use the `niv` tool. To get it, run `nix-shell`. Then:

    niv update cardano-wallet

This will use the branches configuration in
[`nix/sources.json`](../nix/sources.json). Niv also provides options
for choosing another branch or git rev.

### cardano-node

The `cardano-node` version is set by `cardano-wallet`. To temporarily
override this version, add a source, using something like:

    niv add local $HOME/iohk/cardano-node

Once this is set, `nix-shell` should report `trace: Note: using cardano-node from ...`.

When finished, remove the source override with:

    niv drop cardano-node

## cardano-node configurations for tests

Before running tests, ensure that you have the `BYRON_CONFIGS`
environment pointing to the `configuration` subdirectory of the
`cardano-node` repo.

If running in a `nix-shell`, the `BYRON_CONFIGS` variable is set
automatically.

If running under Windows Powershell, do:

    $Env:BYRON_CONFIGS = "E:\cardano-node\configuration"
    
## How to set up windows for testing

See the [Windows](https://github.com/input-output-hk/adrestia/wiki/Windows) page on the wiki.
