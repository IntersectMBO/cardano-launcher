import * as _ from "lodash";

import { launchWalletBackend, ExitStatus, ServiceExitStatus } from './cardanoLauncher';

function combineStatus(statuses: ServiceExitStatus[]): number {
  let code = _.reduce(statuses, (res: number|null, status) => res === null ? status.code : res, null);
  let signal = _.reduce(statuses, (res: string|null, status) => res === null ? status.signal : res, null);
  // let err = _.reduce(statuses, (res, status) => res === null ? status.err : res, null);

  return code === null ? (signal === null ? 0 : 127) : code;
}

export function cli(args: string[]) {
  const waitForExit = setInterval(function() {}, 3600000);
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
    clearInterval(waitForExit);
    process.exit(combineStatus([status.wallet, status.node]));
  });
}
