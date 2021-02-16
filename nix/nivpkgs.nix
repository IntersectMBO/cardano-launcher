{ sources ? import ./sources.nix }:
with
  { overlay = self: pkgs:
      {
        cardanoWalletPackages = import sources.cardano-wallet { gitrev = sources.cardano-wallet.rev; };
      } // (if (sources ? cardano-node) then {
        # Use cardano-node override.
        cardanoNodePackages = builtins.trace
          "Note: using cardano-node from cardano-launcher/nix/sources.json"
          (import (sources.cardano-node) {});
        inherit (self.cardanoNodePackages) cardano-node;
      } else {
        # Normally, cardano-wallet should pick the cardano-node version.
        inherit (self.cardanoWalletPackages) cardano-node;
      });
  };
import sources.nixpkgs
  { overlays = [ overlay ] ; config = {}; }
