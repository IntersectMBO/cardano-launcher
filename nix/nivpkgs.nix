{ sources ? import ./sources.nix }:
with
  { overlay = self: pkgs:
      { niv = import sources.niv {};
        cardanoWalletPackages = import sources.cardano-wallet {};
        cardano-node = (import sources.cardano-node {}).nix-tools.cexes.cardano-node.cardano-node;
        inherit (import sources.iohk-nix {}) jormungandrLib;
        jormungandrConfigs = self.jormungandrLib.forEnvironments self.jormungandrLib.mkConfigHydra;
      };
  };
import sources.nixpkgs
  { overlays = [ overlay ] ; config = {}; }
