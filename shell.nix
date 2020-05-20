{ pkgs ? import ./nix/nivpkgs.nix {} }:

with pkgs;

mkShell {
  buildInputs = [
    # javascript
    nodejs nodePackages.npm
    # documentation tools
    pandoc mscgen librsvg gnumake
    # util to update nixpkgs pins
    niv.niv
    # jormungandr
    cardanoWalletPackages.jormungandr
    cardanoWalletPackages.cardano-wallet-jormungandr
    # cardano-node
    cardano-node
    cardanoWalletPackages.cardano-wallet-byron
    cardanoWalletPackages.cardano-wallet-shelley
  ];

  BYRON_CONFIGS = cardanoWalletPackages.cardano-node.configs;
}
