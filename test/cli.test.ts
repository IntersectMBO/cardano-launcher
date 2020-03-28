// Copyright © 2020 IOHK
// License: Apache-2.0

import { spawn } from 'child_process';
import os from 'os';
import * as process from 'process';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import { delay, expectProcessToBeGone } from './utils';

describe('CLI tests', () => {

  const killTest = (args: string[]) => async () => {
    const stateDir = (
      await tmp.dir({ unsafeCleanup: true, prefix: 'launcher-cli-test' })
    ).path;
    args.push(stateDir);
    const proc = spawn('cardano-launcher', args.concat([stateDir]), {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      ...(os.platform() === 'win32' ? { shell: true } : {}),
    });
    let nodePid: number | null = null;
    let walletPid: number | null = null;
    proc.on('message', (message: any) => {
      console.log('received message', message);
      if (message.node) {
        nodePid = message.node;
      }
      if (message.wallet) {
        walletPid = message.wallet;
      }
    });
    proc.on('error', (err: Error) => {
      console.error('spawn error: ' + err.message, err);
    });
    await delay(1000);
    expect(nodePid).not.toBeNull();
    expect(walletPid).not.toBeNull();
    proc.kill();
    await delay(1000);
    expectProcessToBeGone(nodePid as any, 9);
    expectProcessToBeGone(walletPid as any, 9);
  };

  const jormungandr = [
    'jormungandr',
    'self',
    path.join('test', 'data', 'jormungandr'),
  ];
  const byron = ['byron', 'mainnet', '' + process.env.BYRON_CONFIGS];

  it(
    'when the parent process is killed, child jormungandr gets stopped',
    killTest(jormungandr) as any
  );
  it(
    'when the parent process is killed, cardano-node byron gets stopped',
    killTest(byron)
  );
});
