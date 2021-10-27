// Copyright © 2020 IOHK
// License: Apache-2.0

import { Launcher, LaunchConfig, ServiceStatus, Api } from '../src';

import * as http from 'http';
import * as https from 'https';
import * as tmp from 'tmp-promise';
import * as path from 'path';
import * as fs from 'fs';
import { stat, pathExists } from 'fs-extra';

import * as cardanoNode from '../src/cardanoNode';
import { ExitStatus } from '../src/cardanoLauncher';
import { passthroughErrorLogger } from '../src/common';
import {
  makeRequest,
  setupExecPath,
  withMainnetConfigDir,
  getShelleyConfigDir,
  listExternalAddresses,
  testPort,
  testDataDir,
} from './utils';
import { Logger, StdioLogger } from '../src/loggers';

// Increase time available for tests to run.
const longTestTimeoutMs = 25000;
const testsStopTimeout = 20;
// Path to self-signed certs and CA for HTTPS.
const tlsDir = path.resolve(testDataDir, 'tls');

setupExecPath();

describe('Starting cardano-wallet (and its node)', () => {
  beforeEach(before);
  afterEach(after);

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
    'emits one and only one exit event',
    async () => {
      const launcher = await setupTestLauncher(stateDir => {
        return {
          stateDir,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: getShelleyConfigDir('testnet'),
            network: cardanoNode.networks.testnet,
          },
        };
      });

      const events: ExitStatus[] = [];
      launcher.walletBackend.events.on('exit', st => events.push(st));

      await launcher.start();
      await Promise.all([
        launcher.stop(testsStopTimeout),
        launcher.stop(testsStopTimeout),
        launcher.stop(testsStopTimeout),
      ]);
      await launcher.stop(testsStopTimeout);

      expect(events).toHaveLength(1);
    },
    longTestTimeoutMs
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
        }, loggers.app);
        await launcher.start();
        await launcher.stop(testsStopTimeout);
        const nodeLogFileStats = await stat(nodeLogFile.path);
        const walletLogFileStats = await stat(walletLogFile.path);
        expect(nodeLogFileStats.size).toBeGreaterThan(0);
        expect(walletLogFileStats.size).toBeGreaterThan(0);
      }),
    longTestTimeoutMs
  );

  it(
    'accepts the same WriteStream for both the wallet and node to produce a combined stream',
    async () =>
      await withMainnetConfigDir(async configurationDir => {
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
        }, loggers.app);
        await launcher.start();
        const logFileStats = await stat(writeStream.path);
        expect(logFileStats.size).toBeGreaterThan(0);
        await launcher.stop(testsStopTimeout);
      }),
    longTestTimeoutMs
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
            svCert: path.join(tlsDir, 'server', 'server.crt'),
            svKey: path.join(tlsDir, 'server', 'server.key'),
          },
        };
      }, true),
    longTestTimeoutMs
  );

  it(
    'handles case where cardano-node fails during initialisation',
    async () => {
      expect.assertions(5);
      let chainDir: string;
      await withMainnetConfigDir(async configurationDir => {
        const launcher = await setupTestLauncher(stateDir => {
          // cardano-node will expect this to be a directory, and exit with an error
          chainDir = path.join(stateDir, 'chain');
          fs.writeFileSync(chainDir, 'bomb');

          return {
            stateDir,
            networkName: 'testnet',
            nodeConfig: {
              kind: 'shelley',
              configurationDir,
              network: cardanoNode.networks.testnet,
            },
          };
        });

        await launcher.start().catch(passthroughErrorLogger);
        expect((await fs.promises.stat(chainDir)).isFile()).toBe(true);

        const expectations = new Promise<void>((done, fail) =>
          launcher.walletBackend.events.on('exit', (status: ExitStatus) => {
            try {
              expect(status.wallet.code).toBe(0);
              expect(status.node.code).not.toBe(0);
              if (status.node.signal !== null) {
                // cardano-node is sometimes not exiting properly.
                loggers.test.error("Flaky test - cardano-node did not exit properly.", status.node.signal);
              }
              expect(status.node.signal).toBeNull();
            } catch (e) {
              fail(e);
            }
            done();
          })
        );

        await launcher.stop(testsStopTimeout);

        await expectations;
      });
    },
    longTestTimeoutMs
  );

  it(
    'services listen only on a private address',
    async () => {
      const launcher = await setupTestLauncher(stateDir => {
        return {
          stateDir,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: getShelleyConfigDir('testnet'),
            network: cardanoNode.networks.testnet,
          },
        };
      });

      await launcher.start();
      const walletApi = launcher.walletBackend.api;
      const nodeConfig =
        launcher.nodeService.getConfig() as cardanoNode.NodeStartService;
      for (const host of listExternalAddresses()) {
        loggers.test.log(`Testing ${host}`);
        expect(
          await testPort(host, walletApi.requestParams.port, loggers.test)
        ).toBe(false);
        expect(await testPort(host, nodeConfig.listenPort, loggers.test)).toBe(
          false
        );
      }

      await launcher.stop(testsStopTimeout);
    },
    longTestTimeoutMs
  );

  it(
    'applies RTS options to cardano-node',
    async () => {
      let hp = 'cardano-node.hp';
      const launcher = await setupTestLauncher(stateDir => {
        hp = path.join(stateDir, hp);
        return {
          stateDir,
          networkName: 'testnet',
          nodeConfig: {
            kind: 'shelley',
            configurationDir: getShelleyConfigDir('testnet'),
            network: cardanoNode.networks.testnet,
            rtsOpts: ['-h'], // generates a basic heap profile
          },
        };
      });

      await launcher.start();
      expect(await pathExists(hp)).toBe(true);
      await launcher.stop(testsStopTimeout);
    },
    longTestTimeoutMs
  );
});

async function setupTestLauncher(
  config: (stateDir: string) => LaunchConfig
): Promise<Launcher> {
  const stateDir = await tmp.dir({
    unsafeCleanup: true,
    prefix: 'launcher-integration-test-',
  });

  if (!process.env.NO_CLEANUP) {
    cleanups.push(() => stateDir.cleanup());
  }

  const launcher = new Launcher(config(stateDir.path), loggers.app);

  launcher.walletService.events.on('statusChanged', (status: ServiceStatus) => {
    loggers.test.log('wallet statusChanged to ' + ServiceStatus[status]);
  });

  launcher.nodeService.events.on('statusChanged', (status: ServiceStatus) => {
    loggers.test.log('node statusChanged to ' + ServiceStatus[status]);
  });

  launcher.walletBackend.events.on('ready', (api: Api) => {
    loggers.test.log('ready event ', api);
  });

  cleanups.push(async () => {
    loggers.test.debug('Test has finished; stopping launcher.');
    await launcher.stop(2);
    loggers.test.debug('Stopped. Removing event listeners.');
    launcher.walletBackend.events.removeAllListeners();
    launcher.walletService.events.removeAllListeners();
    launcher.nodeService.events.removeAllListeners();
  });

  return launcher;
}

async function launcherTest(
  config: (stateDir: string) => LaunchConfig,
  tls = false
): Promise<void> {
  const launcher = await setupTestLauncher(config);
  const api = await launcher.start();
  const walletProc = launcher.walletService.getProcess();
  const nodeProc = launcher.nodeService.getProcess();

  expect(walletProc).toHaveProperty('pid');
  expect(nodeProc).toHaveProperty('pid');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info: any = await new Promise((resolve, reject) => {
    loggers.test.log('running req');
    const networkModule = tls ? https : http;
    const req = networkModule.request(
      makeRequest(
        api,
        'network/information',
        tls
          ? {
              ca: fs.readFileSync(path.join(tlsDir, 'ca.crt')),
              cert: fs.readFileSync(path.join(tlsDir, 'client', 'client.crt')),
              key: fs.readFileSync(path.join(tlsDir, 'client', 'client.key')),
            }
          : {}
      ),
      res => {
        res.setEncoding('utf8');
        res.on('data', d => resolve(JSON.parse(d)));
      }
    );
    req.on('error', (e: Error) => {
      loggers.test.error(`problem with request: ${e.message}`);
      reject(e);
    });
    req.end();
  });

  loggers.test.log('info is ', info);

  expect(info.node_tip).toBeTruthy();

  await launcher.stop(testsStopTimeout);
  loggers.test.log('stopped');
}

type CleanupFunc = () => Promise<void>;

const cleanups: CleanupFunc[] = [];
let testNum = 0;
let loggers: {
  test: Logger;
  app: Logger;
};

function testName() {
  return expect.getState().currentTestName;
}

function setupLogging(suite: string) {
  testNum++;
  loggers = loggers || {};
  loggers.test = new StdioLogger({
    fd: process.stderr.fd,
    prefix: `${suite}[${testNum}] `,
    timestamps: true
  });
  loggers.app = new StdioLogger({
    fd: process.stdout.fd,
    prefix: `app[${testNum}] `,
    timestamps: true
  });
}

function before() {
  setupLogging("integration");
  loggers.test.info(`Starting test: ${testName()}`);
  setupCleanupHandlers();
}

async function after() {
  loggers.test.info(`Cleaning up after test: ${testName()}`);
  await runCleanupHandlers();
  loggers.test.info("Cleanups done.");
}

function setupCleanupHandlers() {
  expect(cleanups).toHaveLength(0);
}

async function runCleanupHandlers() {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop() as CleanupFunc;
    await cleanup();
  }
}
