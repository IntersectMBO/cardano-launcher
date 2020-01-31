import * as process from 'process';
import * as tmp from 'tmp-promise';

import { delay, expectProcessToBeGone } from './utils';
import { spawn } from 'child_process';

describe('CLI tests', () => {
  const killTest = (args: string[]) => async () => {
    const stateDir = (await tmp.dir({ unsafeCleanup: true, prefix: "launcher-cli-test" })).path;
    const proc = spawn("./bin/cardano-launcher", args.concat([stateDir]),
                       { stdio: ["inherit", "inherit", "inherit", "ipc"] });
    let nodePid: number|null = null;
    let walletPid: number|null = null;
    proc.on("message", (message: any) => {
      console.log("received message", message);
      if (message.node) {
        nodePid = message.node;
      }
      if (message.wallet) {
        walletPid = message.wallet;
      }
    });
    await delay(1000);
    expect(nodePid).not.toBeNull();
    expect(walletPid).not.toBeNull();
    proc.kill();
    await delay(1000);
    expectProcessToBeGone(<any>nodePid, 9);
    expectProcessToBeGone(<any>walletPid, 9);
  };

  const jormungandr = ["jormungandr", "self", "test/data/jormungandr"];
  const byron = ["byron", "mainnet", "" + process.env.BYRON_CONFIGS];

  it('when the parent process is killed, child jormungandr gets stopped', <any>killTest(jormungandr));
  it('when the parent process is killed, cardano-node gets stopped', killTest(byron));
});
