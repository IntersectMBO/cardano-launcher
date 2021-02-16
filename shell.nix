{ pkgs ? import ./nix/nivpkgs.nix {} }:

with pkgs;

mkShell {
  buildInputs = [
    # javascript
    nodejs nodePackages.npm
    # documentation tools
    pandoc librsvg gnumake
  ] ++ lib.optional stdenv.isLinux mscgen ++ [
    # util to update nixpkgs pins
    niv
    # cardano-wallet shelley
    cardano-node
    cardanoWalletPackages.cardano-wallet
  ];

  # Test data from cardano-wallet repo used in their integration tests.
  TEST_CONFIG_SHELLEY = cardanoWalletPackages.src + /lib/shelley/test/data/cardano-node-shelley;

  # Corresponds to
  # https://hydra.iohk.io/job/Cardano/iohk-nix/cardano-deployment/latest/download/1/index.html
  CARDANO_NODE_CONFIGS = cardanoWalletPackages.cardano-node.deployments;
}
