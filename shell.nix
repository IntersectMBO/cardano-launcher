{ pkgs ? import ./nix/nivpkgs.nix {} }:

with pkgs;

mkShell {
  buildInputs = [
    # javascript
    nodePackages.npm
    # documentation tools
    pandoc mscgen gnumake
    # util to update nixpkgs pins
    niv.niv
    # cardano
    cardanoWalletPackages.cardano-wallet-jormungandr
    cardanoWalletPackages.jormungandr
  ];
}
