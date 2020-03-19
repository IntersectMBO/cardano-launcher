import { Launcher, LaunchConfig, ServiceStatus, Api } from '../src';

import * as http from 'http';
import * as tmp from 'tmp-promise';
import * as path from 'path';

import * as jormungandr from '../src/jormungandr';
import * as byron from '../src/byron';
import { makeRequest } from './utils';

// increase time available for tests to run
const longTestTimeoutMs = 15000;

describe('Starting cardano-wallet (and its node)', () => {
  const setupTestLauncher = async (
    config: (stateDir: string) => LaunchConfig
  ) => {
    const stateDir = (
      await tmp.dir({
        unsafeCleanup: true,
        prefix: 'launcher-integration-test',
      })
    ).path;
    const launcher = new Launcher(config(stateDir));

    expect(launcher).toBeTruthy();

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

    return launcher;
  };

  const launcherTest = async (config: (stateDir: string) => LaunchConfig) => {
    const launcher = await setupTestLauncher(config);
    const api = await launcher.start();
    const walletProc = launcher.walletService.getProcess();
    const nodeProc = launcher.nodeService.getProcess();

    expect(walletProc).toHaveProperty('pid');
    expect(nodeProc).toHaveProperty('pid');
    expect(nodeProc?.stderr).not.toBe(null);
    expect(nodeProc?.stdout).not.toBe(null);
    expect(walletProc?.stderr).not.toBe(null);
    expect(walletProc?.stdout).not.toBe(null);

    const info: any = await new Promise((resolve, reject) => {
      console.log('running req');
      const req = http.request(makeRequest(api, 'network/information'), res => {
        res.setEncoding('utf8');
        res.on('data', d => resolve(JSON.parse(d)));
      });
      req.on('error', (e: any) => {
        console.error(`problem with request: ${e.message}`);
        reject(e);
      });
      req.end();
    });

    console.log('info is ', info);

    expect(info.node_tip).toBeTruthy();

    await launcher.stop(5);

    console.log('stopped');
  };

  it(
    'cardano-wallet-jormungandr responds to requests',
    () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'self',
          nodeConfig: {
            kind: 'jormungandr',
            configurationDir: path.join('test', 'data', 'jormungandr'),
            network: jormungandr.networks.self,
          },
        };
      }),
    longTestTimeoutMs
  );

  it('emits one and only one exit event', async () => {
    const launcher = await setupTestLauncher(stateDir => {
      return {
        stateDir,
        networkName: 'self',
        nodeConfig: {
          kind: 'jormungandr',
          configurationDir: path.join('test', 'data', 'jormungandr'),
          network: jormungandr.networks.self,
        },
      };
    });

    const events = [];
    launcher.walletBackend.events.on('exit', st => events.push(st));

    await launcher.start();
    await Promise.all([launcher.stop(), launcher.stop(), launcher.stop()]);
    await launcher.stop();

    expect(events.length).toBe(1);
  });

  it('handles case where node fails to start', async () => {
    const launcher = await setupTestLauncher(stateDir => {
      return {
        stateDir,
        networkName: 'self',
        nodeConfig: {
          kind: 'jormungandr',
          configurationDir: path.join('test', 'data', 'jormungandr'),
          network: jormungandr.networks.self,
          extraArgs: ['--yolo'], // not a jormungandr arg
        },
      };
    });
    await expect(launcher.start()).rejects.toThrow(
      [
        'cardano-wallet-jormungandr exited with status 0',
        'jormungandr exited with status 1',
      ].join('\n')
    );
  });

  // cardano-wallet-byron is still wip
  xit(
    'cardano-wallet-byron responds to requests',
    () =>
      launcherTest(stateDir => {
        return {
          stateDir,
          networkName: 'mainnet',
          nodeConfig: {
            kind: 'byron',
            configurationDir: '' + process.env.BYRON_CONFIGS,
            network: byron.networks.mainnet,
          },
        };
      }),
    longTestTimeoutMs
  );
});
