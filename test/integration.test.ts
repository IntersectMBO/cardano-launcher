// Copyright © 2020 IOHK
// License: Apache-2.0

import { Launcher, LaunchConfig, ServiceStatus, Api } from '../src';

import * as http from 'http';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs';
import { stat } from 'fs-extra';

import * as jormungandr from '../src/jormungandr';
import * as byron from '../src/byron';
import { ExitStatus } from '../src/cardanoLauncher';
import { passthroughErrorLogger } from '../src/common';
import { makeRequest, setupExecPath, withByronConfigDir } from './utils';

// increase time available for tests to run
const longTestTimeoutMs = 15000;

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
    config: (stateDir: string) => LaunchConfig
  ): Promise<void> => {
    setupExecPath();

    const { launcher, cleanupLauncher } = await setupTestLauncher(config);
    const api = await launcher.start();
    const walletProc = launcher.walletService.getProcess();
    const nodeProc = launcher.nodeService.getProcess();

    expect(walletProc).toHaveProperty('pid');
    expect(nodeProc).toHaveProperty('pid');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info: any = await new Promise((resolve, reject) => {
      console.log('running req');
      const req = http.request(makeRequest(api, 'network/information'), res => {
        res.setEncoding('utf8');
        res.on('data', d => resolve(JSON.parse(d)));
      });
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
    'cardano-wallet-jormungandr responds to requests',
    () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'self',
          nodeConfig: {
            kind: 'jormungandr',
            configurationDir: path.resolve(__dirname, 'data', 'jormungandr'),
            network: jormungandr.networks.self,
          },
        };
      }),
    longTestTimeoutMs
  );

  // eslint-disable-next-line jest/expect-expect
  it(
    'cardano-wallet-byron responds to requests',
    () =>
      withByronConfigDir(configurationDir => {
        return launcherTest(stateDir => {
          return {
            stateDir,
            networkName: 'mainnet',
            nodeConfig: {
              kind: 'byron',
              configurationDir,
              network: byron.networks.mainnet,
            },
          };
        });
      }),
    longTestTimeoutMs
  );

  it('emits one and only one exit event', async () => {
    const { launcher, cleanupLauncher } = await setupTestLauncher(stateDir => {
      return {
        stateDir,
        networkName: 'self',
        nodeConfig: {
          kind: 'jormungandr',
          configurationDir: path.resolve(__dirname, 'data', 'jormungandr'),
          network: jormungandr.networks.self,
        },
      };
    });

    const events: ExitStatus[] = [];
    launcher.walletBackend.events.on('exit', st => events.push(st));

    await launcher.start();
    await Promise.all([launcher.stop(), launcher.stop(), launcher.stop()]);
    await launcher.stop();

    expect(events).toHaveLength(1);

    await cleanupLauncher();
  });

  it('Accepts a WriteStream, and pipes the child process stdout and stderr streams', () =>
    tmp.withFile(async (logFile: tmp.FileResult) => {
      const childProcessLogWriteStream = fs.createWriteStream(logFile.path, {
        fd: logFile.fd,
      });
      const launcher = new Launcher({
        stateDir: (
          await tmp.dir({
            unsafeCleanup: true,
            prefix: 'launcher-integration-test-2',
          })
        ).path,
        networkName: 'self',
        nodeConfig: {
          kind: 'jormungandr',
          configurationDir: path.resolve(__dirname, 'data', 'jormungandr'),
          network: jormungandr.networks.self,
        },
        childProcessLogWriteStream,
      });
      await launcher.start();
      const logFileStats = await stat(logFile.path);
      expect(logFileStats.size).toBeGreaterThan(0);
      await launcher.stop();
    }));

  it('handles case where (jormungandr) node fails to start', async () => {
    const { launcher, cleanupLauncher } = await setupTestLauncher(stateDir => {
      return {
        stateDir,
        networkName: 'self',
        nodeConfig: {
          kind: 'jormungandr',
          configurationDir: path.resolve(__dirname, 'data', 'jormungandr'),
          network: jormungandr.networks.self,
          extraArgs: ['--yolo'], // not a jormungandr arg
        },
      };
    });

    await expect(launcher.start().finally(cleanupLauncher)).rejects.toThrow(
      [
        'cardano-wallet-jormungandr exited with status 0',
        'jormungandr exited with status 1',
      ].join('\n')
    );
  });

  it('handles case where cardano-node fails during initialisation', () => {
    return new Promise((done, fail) => {
      expect.assertions(3);
      withByronConfigDir(
        configurationDir =>
          new Promise(resolve => {
            setupTestLauncher(stateDir => {
              // cardano-node will expect this to be a directory, and exit with an error
              fs.writeFileSync(path.join(stateDir, 'chain'), 'bomb');

              return {
                stateDir,
                networkName: 'mainnet',
                nodeConfig: {
                  kind: 'byron',
                  configurationDir,
                  network: byron.networks.mainnet,
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
