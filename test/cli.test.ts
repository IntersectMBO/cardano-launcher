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

import * as tmp from 'tmp-promise';
import path from 'path';

import {
  delay,
  expectProcessToBeGone,
  setupExecPath,
  withByronConfigDir,
} from './utils';
import { fork } from 'child_process';

describe('CLI tests', () => {
  const killTest = (args: string[]) => async () => {
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

  it(
    'when the parent process is killed, child jormungandr gets stopped',
    killTest([
      'jormungandr',
      'self',
      path.resolve(__dirname, 'data', 'jormungandr'),
    ])
  );

  it('when the parent process is killed, cardano-node gets stopped', () =>
    withByronConfigDir(configs => killTest(['byron', 'mainnet', configs])()));
});
