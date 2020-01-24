{ sources ? import ./sources.nix }:
with
  { overlay = _: pkgs:
      { niv = import sources.niv {};
        cardanoWalletPackages = import sources.cardano-wallet {};
        cardano-node = (import sources.cardano-node {}).nix-tools.cexes.cardano-node.cardano-node;
      };
  };
import sources.nixpkgs
  { overlays = [ overlay ] ; config = {}; }
