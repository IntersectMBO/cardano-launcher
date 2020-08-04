// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * Integration tests which involve running the cardano-launcher code
 * in another process via `src/cli.ts`.
 *
 * These tests require that the code has already been built, so that
 * `dist/cli.js` exists.
 *
 * @packageDocumentation
 */

/* eslint-disable jest/expect-expect */

import * as tmp from 'tmp-promise';
import path from 'path';

import {
  delay,
  expectProcessToBeGone,
  setupExecPath,
  getShelleyConfigDir,
} from './utils';
import { fork } from 'child_process';

type Message = {
  node?: number;
  wallet?: number;
};

describe('CLI tests', () => {
  const killTest = (args: string[]) => async (): Promise<void> => {
    setupExecPath();
    const stateDir = (
      await tmp.dir({ unsafeCleanup: true, prefix: 'launcher-cli-test' })
    ).path;
    const proc = fork(
      path.resolve(__dirname, '..', 'dist', 'cli.js'),
      args.concat([stateDir]),
      {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: process.env,
      }
    );
    let nodePid: number | null = null;
    let walletPid: number | null = null;
    proc.on('message', (message: Message) => {
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
    if (nodePid) {
      expectProcessToBeGone(nodePid, 9);
    }
    if (walletPid) {
      expectProcessToBeGone(walletPid, 9);
    }
  };

  it(
    'when the parent process is killed, child jormungandr gets stopped',
    killTest([
      'jormungandr',
      'self',
      path.resolve(__dirname, 'data', 'jormungandr'),
    ])
  );

  it(
    'when the parent process is killed, cardano-node gets stopped - Shelley',
    killTest(['shelley', 'testnet', getShelleyConfigDir('testnet')])
  );
});
