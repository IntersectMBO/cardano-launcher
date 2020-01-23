{ sources ? import ./sources.nix }:
with
  { overlay = _: pkgs:
      { niv = import sources.niv {};
        cardanoWalletPackages = import sources.cardano-wallet {};
      };
  };
import sources.nixpkgs
  { overlays = [ overlay ] ; config = {}; }
