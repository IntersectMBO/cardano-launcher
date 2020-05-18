// Copyright © 2020 IOHK
// License: Apache-2.0

import { withDir, DirectoryResult } from 'tmp-promise';
import * as fs from 'fs';
import * as path from 'path';
import _ from 'lodash';

import { Service, ServiceStatus, Api } from '../src';
import { StartService, ShutdownMethod } from '../src/service';
import { Logger, LogFunc } from '../src/logging';
import { ServerOptions } from 'http';
import { ServerOptions as HttpsServerOptions } from 'https';

/*******************************************************************************
 * Utils
 ******************************************************************************/

/** Construct a promise to a service command. */
export function testService(
  command: string,
  args: string[],
  shutdownMethod = ShutdownMethod.CloseStdin
): Promise<StartService> {
  return new Promise(resolve => resolve({ command, args, shutdownMethod }));
}

/**
 * Expect the given process ID to not exist.
 */
export const expectProcessToBeGone = (pid: number, signal = 0): void => {
  expect(() => process.kill(pid, signal)).toThrow();
};

/**
 * @return mutable array which will contain events as they occur.
 */
export const collectEvents = (service: Service): ServiceStatus[] => {
  const events: ServiceStatus[] = [];
  service.events.on('statusChanged', status => events.push(status));
  return events;
};

export interface MockLog {
  severity: 'debug' | 'info' | 'error';
  msg: string;
  param: object | undefined;
}

export interface MockLogger extends Logger {
  getLogs(): MockLog[];
}

export function mockLogger(echo = false): MockLogger {
  const logs: MockLog[] = [];

  const mockLog = (severity: 'debug' | 'info' | 'error'): LogFunc => {
    return (msg: string, param?: object): void => {
      if (echo) {
        if (param) {
          console[severity](msg, param);
        } else {
          console[severity](msg);
        }
      }
      logs.push({ severity, msg, param: param || undefined });
    };
  };

  return {
    debug: mockLog('debug'),
    info: mockLog('info'),
    error: mockLog('error'),
    getLogs: (): MockLog[] => logs,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sets up the parameters for `http.request` for this Api.
 *
 * @param path - the api route (without leading slash)
 * @param options - extra options to be added to the request.
 * @return an options object suitable for `http.request`
 */
export function makeRequest(
  api: Api,
  path: string,
  options?: ServerOptions | HttpsServerOptions
): object {
  return Object.assign(
    {},
    api.requestParams,
    {
      path: api.requestParams.path + path,
    },
    options
  );
}

/**
 * Adds the current working directory to the PATH, only when running
 * under Windows.
 *
 * This means that the wallet and node executables can be "installed"
 * in the source directory.
 *
 * If the node backend is run in a different working directory,
 * Windows will still be able to find the executables
 */
export function setupExecPath(): void {
  if (process.platform === 'win32') {
    const cwd = process.cwd();
    const paths = (process.env.PATH || '')
      .split(path.delimiter)
      .filter(p => p !== cwd);
    paths.unshift(cwd);
    process.env.PATH = paths.join(path.delimiter);
    console.info('PATH=' + process.env.PATH);
  }
}

/**
 * Set up a temporary directory containing configuration files for
 * Byron mainnet.
 *
 * This is needed because files in the cardano-node configuration file
 * are resolved relative to the current working directory, rather than
 * relative to the path of the config file.
 *
 * The temporary directory is deleted after the callback completes,
 * unless the environment variable `NO_CLEANUP` is set.
 */
export async function withByronConfigDir<T>(
  cb: (configDir: string) => Promise<T>
): Promise<T> {
  const base = process.env.BYRON_CONFIGS;
  if (!base) {
    const msg =
      'BYRON_CONFIGS environment variable is not set. The tests will not work.';
    console.error(msg);
    throw new Error(msg);
  }

  return await withDir(
    async (o: DirectoryResult) => {
      const configs = _.mapValues(
        {
          configuration: 'configuration.yaml',
          genesis: 'genesis.json',
          topology: 'topology.json',
        },
        (f: string) => {
          return {
            src: path.join(base, 'defaults', 'byron-mainnet', f),
            dst: path.join(o.path, f),
          };
        }
      );

      await fs.promises.copyFile(configs.genesis.src, configs.genesis.dst);
      await fs.promises.copyFile(configs.topology.src, configs.topology.dst);

      const config = await fs.promises.readFile(
        configs.configuration.src,
        'utf-8'
      );
      const configFixed = config.replace(/^.*SocketPath.*$/gm, '');
      await fs.promises.writeFile(configs.configuration.dst, configFixed);

      return await cb(o.path);
    },
    {
      unsafeCleanup: true,
      keep: !!process.env.NO_CLEANUP,
      prefix: 'launcher-test-config-',
    }
  );
}
