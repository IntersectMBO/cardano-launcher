{ pkgs ? import <nixpkgs> {} }:
let
   workaround140774 = hpkg: with pkgs.haskell.lib;
    overrideCabal hpkg (drv: {
        enableSeparateBinOutput = false;
    });
in workaround140774 (pkgs.haskell.packages.ghc8107.callPackage ./myproject.nix { })