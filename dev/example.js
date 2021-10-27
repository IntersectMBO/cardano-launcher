// Example of launching the wallet for mainnet.

var cardanoLauncher = require("cardanoLauncher");

var launcher = new cardanoLauncher.Launcher({
  networkName: "mainnet",
  stateDir: "/tmp/state-launcher",
  nodeConfig: {
    kind: "shelley"
  }
});

launcher.start().then(function(api) {
  console.log("*** cardano-wallet backend is ready, base URL is " + api.baseUrl);
  return launcher.stop();
}).then(function() {
  console.log("*** the cardano-wallet backend has finished");
}).catch(function(exitStatus) {
  console.log("*** there was an error starting cardano-wallet backend:\n" +
              cardanoLauncher.exitStatusMessage(exitStatus));
});
