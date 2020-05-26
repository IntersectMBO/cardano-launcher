// Copyright © 2020 IOHK
// License: Apache-2.0

import { Launcher, LaunchConfig, ServiceStatus, Api } from '../src';

import * as http from 'http';
import * as https from 'https';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs';
import { stat } from 'fs-extra';

import * as jormungandr from '../src/jormungandr';
import * as cardanoNode from '../src/cardanoNode';
import { ExitStatus } from '../src/cardanoLauncher';
import { passthroughErrorLogger } from '../src/common';
import { makeRequest, setupExecPath, withByronConfigDir } from './utils';

// increase time available for tests to run
const longTestTimeoutMs = 15000;
const tlsDir = path.resolve(__dirname, 'data', 'tls');

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
              network: cardanoNode.networks.mainnet,
            },
          };
        });
      }),
    longTestTimeoutMs
  );

  // eslint-disable-next-line jest/expect-expect
  it(
    'cardano-wallet-shelley responds to requests',
    () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'ff',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: path.resolve(
              __dirname,
              'data',
              'cardano-node',
              'ff'
            ),
            network: cardanoNode.networks.ff,
          },
        };
      }),
    longTestTimeoutMs
  );

  it('emits one and only one exit event - Byron', () =>
    withByronConfigDir(async configurationDir => {
      const { launcher, cleanupLauncher } = await setupTestLauncher(
        stateDir => {
          return {
            stateDir,
            networkName: 'mainnet',
            nodeConfig: {
              kind: 'byron',
              configurationDir,
              network: cardanoNode.networks.mainnet,
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
    }));

  it('emits one and only one exit event - Shelley', async () => {
    const { launcher, cleanupLauncher } = await setupTestLauncher(stateDir => {
      return {
        stateDir,
        networkName: 'ff',
        nodeConfig: {
          kind: 'shelley',
          configurationDir: path.resolve(
            __dirname,
            'data',
            'cardano-node',
            'ff'
          ),
          network: cardanoNode.networks.ff,
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

  it('accepts WriteStreams to pipe each child process stdout and stderr streams', () =>
    withByronConfigDir(async configurationDir => {
      const walletLogFile = await tmp.file();
      const nodeLogFile = await tmp.file();
      const launcher = new Launcher({
        stateDir: (
          await tmp.dir({
            unsafeCleanup: true,
            prefix: 'launcher-integration-test-',
          })
        ).path,
        networkName: 'mainnet',
        nodeConfig: {
          kind: 'byron',
          configurationDir,
          network: cardanoNode.networks.mainnet,
        },
        childProcessLogWriteStreams: {
          node: fs.createWriteStream(nodeLogFile.path, { fd: nodeLogFile.fd }),
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
    }));

  it('accepts the same WriteStream for both the wallet and node to produce a combined stream', async () =>
    withByronConfigDir(async configurationDir => {
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
          kind: 'byron',
          configurationDir,
          network: cardanoNode.networks.mainnet,
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
    }));

  // eslint-disable-next-line jest/expect-expect
  it('can configure the cardano-wallet-byron to serve the API with TLS', async () =>
    withByronConfigDir(configurationDir =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'mainnet',
          nodeConfig: {
            kind: 'byron',
            configurationDir,
            network: cardanoNode.networks.mainnet,
          },
          tlsConfiguration: {
            caCert: path.join(tlsDir, 'ca.crt'),
            svCert: path.join(tlsDir, 'server.crt'),
            svKey: path.join(tlsDir, 'server.key'),
          },
        };
      }, true)
    ));

  // eslint-disable-next-line jest/expect-expect
  it('can configure the cardano-wallet-shelley to serve the API with TLS', async () =>
    launcherTest(stateDir => {
      return {
        stateDir,
        networkName: 'ff',
        nodeConfig: {
          kind: 'shelley',
          configurationDir: path.resolve(
            __dirname,
            'data',
            'cardano-node',
            'ff'
          ),
          network: cardanoNode.networks.ff,
        },
        tlsConfiguration: {
          caCert: path.join(tlsDir, 'ca.crt'),
          svCert: path.join(tlsDir, 'server.crt'),
          svKey: path.join(tlsDir, 'server.key'),
        },
      };
    }, true));

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
                  network: cardanoNode.networks.mainnet,
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
