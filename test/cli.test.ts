// Copyright © 2020 IOHK
// License: Apache-2.0

import { spawn } from 'child_process';
import * as process from 'process';
import os from 'os';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import { delay,
  // ensureBinShim,
  expectProcessToBeGone } from './utils';

const programPath = require('../package.json').bin['cardano-launcher'];
const platform = os.platform();
console.log('@!@',programPath);

describe('CLI tests', () => {

  // beforeAll(async () => {
  //   try {
  //     await ensureBinShim(programPath);
  //   } catch (error) {
  //     console.error(error.message)
  //   }
  // });

  const killTest = (args: string[]) => async () => {
    const stateDir = (
      await tmp.dir({ unsafeCleanup: true, prefix: 'launcher-cli-test' })
    ).path;
    const proc = spawn(programPath, args.concat([stateDir]), {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      ...(platform === 'win32' ? { shell: true } : {}),
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
    'when the parent process is killed, cardano-node gets stopped',
    killTest(byron)
  );
});
