// Copyright © 2020 IOHK
// License: Apache-2.0

import { Launcher, LaunchConfig, ServiceStatus, Api } from '../src';

import * as http from 'http';
import * as https from 'https';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs';
import { stat } from 'fs-extra';

import * as cardanoNode from '../src/cardanoNode';
import { ExitStatus } from '../src/cardanoLauncher';
import { passthroughErrorLogger } from '../src/common';
import {
  makeRequest,
  setupExecPath,
  withMainnetConfigDir,
  getShelleyConfigDir,
} from './utils';

// increase time available for tests to run
const longTestTimeoutMs = 15000;
const tlsDir = path.resolve(__dirname, 'data', 'tls');

// Increase time available for tests to run to work around bug
// https://github.com/input-output-hk/cardano-node/issues/1086
const veryLongTestTimeoutMs = 70000;

setupExecPath();

describe('Starting cardano-wallet (and its node)', () => {
  const setupTestLauncher = async (
    config: (stateDir: string) => LaunchConfig
  ): Promise<{ launcher: Launcher; cleanupLauncher: () => Promise<void> }> => {
    const stateDir = await tmp.dir({
      unsafeCleanup: true,
      prefix: 'launcher-integration-test-',
    });
    const launcher = new Launcher(config(stateDir.path));

    launcher.walletService.events.on(
      'statusChanged',
      (status: ServiceStatus) => {
        console.log('wallet service status changed ' + ServiceStatus[status]);
      }
    );

    launcher.nodeService.events.on('statusChanged', (status: ServiceStatus) => {
      console.log('node service status changed ' + ServiceStatus[status]);
    });

    launcher.walletBackend.events.on('ready', (api: Api) => {
      console.log('ready event ', api);
    });

    const cleanupLauncher = async (): Promise<void> => {
      launcher.walletBackend.events.removeAllListeners();
      launcher.walletService.events.removeAllListeners();
      launcher.nodeService.events.removeAllListeners();
      if (!process.env.NO_CLEANUP) {
        await stateDir.cleanup();
      }
    };

    return { launcher, cleanupLauncher };
  };

  const launcherTest = async (
    config: (stateDir: string) => LaunchConfig,
    tls = false
  ): Promise<void> => {
    const { launcher, cleanupLauncher } = await setupTestLauncher(config);
    const api = await launcher.start();
    const walletProc = launcher.walletService.getProcess();
    const nodeProc = launcher.nodeService.getProcess();

    expect(walletProc).toHaveProperty('pid');
    expect(nodeProc).toHaveProperty('pid');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info: any = await new Promise((resolve, reject) => {
      console.log('running req');
      const networkModule = tls ? https : http;
      const req = networkModule.request(
        makeRequest(
          api,
          'network/information',
          tls
            ? {
                ca: fs.readFileSync(path.join(tlsDir, 'ca.crt')),
                cert: fs.readFileSync(path.join(tlsDir, 'client.crt')),
                key: fs.readFileSync(path.join(tlsDir, 'client.key')),
              }
            : {}
        ),
        res => {
          res.setEncoding('utf8');
          res.on('data', d => resolve(JSON.parse(d)));
        }
      );
      req.on('error', (e: Error) => {
        console.error(`problem with request: ${e.message}`);
        reject(e);
      });
      req.end();
    });

    console.log('info is ', info);

    expect(info.node_tip).toBeTruthy();

    await launcher.stop(5);

    console.log('stopped');

    await cleanupLauncher();
  };

  // eslint-disable-next-line jest/expect-expect
  it(
    'cardano-wallet responds to requests',
    () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: getShelleyConfigDir('testnet'),
            network: cardanoNode.networks.testnet,
          },
        };
      }),
    longTestTimeoutMs
  );

  it(
    'emits one and only one exit event - Shelley',
    async () => {
      const { launcher, cleanupLauncher } = await setupTestLauncher(
        stateDir => {
          return {
            stateDir,
            networkName: 'testnet',
            nodeConfig: {
              kind: 'shelley',
              configurationDir: getShelleyConfigDir('testnet'),
              network: cardanoNode.networks.testnet,
            },
          };
        }
      );

      const events: ExitStatus[] = [];
      launcher.walletBackend.events.on('exit', st => events.push(st));

      await launcher.start();
      await Promise.all([launcher.stop(), launcher.stop(), launcher.stop()]);
      await launcher.stop();

      expect(events).toHaveLength(1);

      await cleanupLauncher();
    },
    veryLongTestTimeoutMs
  );

  it(
    'accepts WriteStreams to pipe each child process stdout and stderr streams',
    () =>
      withMainnetConfigDir(async configurationDir => {
        const walletLogFile = await tmp.file();
        const nodeLogFile = await tmp.file();
        const launcher = new Launcher({
          stateDir: (
            await tmp.dir({
              unsafeCleanup: true,
              prefix: 'launcher-integration-test-',
            })
          ).path,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir,
            network: cardanoNode.networks.testnet,
          },
          childProcessLogWriteStreams: {
            node: fs.createWriteStream(nodeLogFile.path, {
              fd: nodeLogFile.fd,
            }),
            wallet: fs.createWriteStream(walletLogFile.path, {
              fd: walletLogFile.fd,
            }),
          },
        });
        await launcher.start();
        const nodeLogFileStats = await stat(nodeLogFile.path);
        const walletLogFileStats = await stat(walletLogFile.path);
        expect(nodeLogFileStats.size).toBeGreaterThan(0);
        expect(walletLogFileStats.size).toBeGreaterThan(0);
        await launcher.stop();
      }),
    veryLongTestTimeoutMs
  );

  it(
    'accepts the same WriteStream for both the wallet and node to produce a combined stream',
    async () =>
      withMainnetConfigDir(async configurationDir => {
        const logFile = await tmp.file();
        const writeStream = fs.createWriteStream(logFile.path, {
          fd: logFile.fd,
        });
        const launcher = new Launcher({
          stateDir: (
            await tmp.dir({
              unsafeCleanup: true,
              prefix: 'launcher-integration-test-',
            })
          ).path,
          networkName: 'mainnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir,
            network: cardanoNode.networks.testnet,
          },
          childProcessLogWriteStreams: {
            node: writeStream,
            wallet: writeStream,
          },
        });
        await launcher.start();
        const logFileStats = await stat(writeStream.path);
        expect(logFileStats.size).toBeGreaterThan(0);
        await launcher.stop();
      }),
    veryLongTestTimeoutMs
  );

  // eslint-disable-next-line jest/expect-expect
  it(
    'can configure the cardano-wallet to serve the API with TLS',
    async () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: getShelleyConfigDir('testnet'),
            network: cardanoNode.networks.testnet,
          },
          tlsConfiguration: {
            caCert: path.join(tlsDir, 'ca.crt'),
            svCert: path.join(tlsDir, 'server.crt'),
            svKey: path.join(tlsDir, 'server.key'),
          },
        };
      }, true),
    veryLongTestTimeoutMs
  );

  it('handles case where cardano-node fails during initialisation', () => {
    return new Promise((done, fail) => {
      expect.assertions(3);
      withMainnetConfigDir(
        configurationDir =>
          new Promise(resolve => {
            setupTestLauncher(stateDir => {
              // cardano-node will expect this to be a directory, and exit with an error
              fs.writeFileSync(path.join(stateDir, 'chain'), 'bomb');

              return {
                stateDir,
                networkName: 'testnet',
                nodeConfig: {
                  kind: 'shelley',
                  configurationDir,
                  network: cardanoNode.networks.testnet,
                },
              };
            })
              .then(({ launcher, cleanupLauncher }) => {
                launcher.start().catch(passthroughErrorLogger);
                launcher.walletBackend.events.on(
                  'exit',
                  (status: ExitStatus) => {
                    expect(status.wallet.code).toBe(0);
                    expect(status.node.code).not.toBe(0);
                    expect(status.node.signal).toBeNull();

                    cleanupLauncher()
                      .then(resolve)
                      .catch(passthroughErrorLogger);
                  }
                );
              })
              .catch(fail);
          })
      )
        .then(done)
        .catch(fail);
    });
  });
});
