import { launchWalletBackend, ExitStatus } from '.';

function cli(args: string[]) {
  console.log(args);

  let launcher = launchWalletBackend({
    stateDir: "/tmp/test-state-dir",
    nodeConfig: {
      kind: "jormungandr",
      genesis: { kind: "hash", hash: "yolo" }
    }
  });
  launcher.start();

  launcher.walletBackend.events.on("exit", (status: ExitStatus) => {
    console.log(`${status.wallet.exe} exited with status ${status.wallet.code}`);
    console.log(`${status.node.exe} exited with status ${status.node.code}`);
    process.exit(Math.max(status.wallet.code, status.node.code));
  });
}

cli(process.argv);
