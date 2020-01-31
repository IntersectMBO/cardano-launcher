/**
 * Module for starting and managing a Cardano node and wallet backend.
 *
 * The main class is [[Launcher]].
 *
 * @packageDocumentation
 */

import path from 'path';
import fs from 'fs';

import _ from "lodash";
import { EventEmitter } from 'tsee';
import getPort from "get-port";
import waitOn from "wait-on";

import { Logger, prependName } from './logging';
import { Service, ServiceExitStatus, ServiceStatus, StartService, setupService, serviceExitStatusMessage } from './service';
import { DirPath } from './common';

import * as byron from './byron';
import * as shelley from './shelley';
import * as jormungandr from './jormungandr';

export { ServiceExitStatus,  serviceExitStatusMessage } from './service';

/**
 * Configuration parameters for starting the wallet backend and node.
 */
interface LaunchConfig {
  /**
   * Directory to store wallet databases, the blockchain, socket
   * files, etc.
   */
  stateDir: string;

  /**
   * Label for the network that will connected. This is used in the
   * state directory path name.
   */
  networkName: string;

  /**
   * TCP port to use for the `cardano-wallet` API server.
   * The default is to select any free port.
   */
  apiPort?: number;

  /**
   * IP address or hostname to bind the `cardano-wallet` API server
   * to. Can be an IPv[46] address, hostname, or `'*'`. Defaults to
   * 127.0.0.1.
   */
  listenAddress?: string;

  /**
   * Configuration for starting `cardano-node`. The `kind` property will be one of
   *  * `"byron"` - [[ByronNodeConfig]]
   *  * `"shelley"` - [[ShelleyNodeConfig]]
   *  * `"jormungandr"` - [[JormungandrConfig]]
   */
  nodeConfig: byron.ByronNodeConfig|shelley.ShelleyNodeConfig|jormungandr.JormungandrConfig;
}

/**
 * This is the main object which controls the launched wallet backend
 * and its node.
 *
 * Example:
 *
 * ```javascript
 * var launcher = new cardanoLauncher.Launcher({
 *   networkName: "mainnet",
 *   stateDir: "/tmp/state-launcher",
 *   nodeConfig: {
 *     kind: "byron",
 *     configurationDir: "/home/user/cardano-node/configuration",
 *     network: {
 *       configFile: "configuration-mainnet.yaml",
 *       genesisFile: "mainnet-genesis.json",
 *       genesisHash: "5f20df933584822601f9e3f8c024eb5eb252fe8cefb24d1317dc3d432e940ebb",
 *       topologyFile: "mainnet-topology.json"
 *     }
 *   }
 * });
 * ```
 *
 * Initially, the backend is not started. Use [[Launcher.start]] for that.
 */
export class Launcher {
  /**
   * Use this attribute to monitor and control the `cardano-wallet` process.
   */
  readonly walletService: Service;

  /**
   * Use this to access the `cardano-wallet` API server.
   */
  readonly walletBackend: WalletBackend;

  /**
   * Use this to monitor the `cardano-node` process.
   */
  readonly nodeService: Service;

  /** Logging adapter */
  protected logger: Logger;

  /** Wallet API server port - set once it's known. */
  private apiPort = 0;

  /**
   * Sets up a Launcher which can start and control the wallet backend.
   *
   * @param config - controls how the wallet and node are started
   * @param logger - logging backend that launcher will use
   */
  constructor(config: LaunchConfig, logger: Logger = console) {
    logger.debug("Launcher init");
    this.logger = logger;

    const start = makeServiceCommands(config, logger)
    this.walletService = setupService(start.wallet, prependName(logger, "wallet"));
    this.nodeService = setupService(start.node, prependName(logger, "node"));

    this.walletBackend = {
      getApi: () => new V2Api(this.apiPort),
      events: new EventEmitter<{
        ready: (api: Api) => void,
        exit: (status: ExitStatus) => void,
      }>(),
    };

    this.walletService.events.on("statusChanged", status => {
      if (status === ServiceStatus.Stopped) {
        this.logger.debug("wallet exited");
        this.stop();
      }
    });

    this.nodeService.events.on("statusChanged", status => {
      if (status === ServiceStatus.Stopped) {
        this.logger.debug("node exited");
        this.stop();
      }
    });
  }

  /**
   * Starts the wallet and node.
   *
   * Example:
   *
   * ```javascript
   * launcher.start().then(function(api) {
   *   console.log("*** cardano-wallet backend is ready, base URL is " + api.baseUrl);
   * });
   * ```
   *
   * @return a promise that will be fulfilled when the wallet API
   * server is ready to accept requests.
   */
  start(): Promise<Api> {
    this.nodeService.start();
    this.walletService.start()

    this.waitForApi(this.apiPort).then(() => {
      this.walletBackend.events.emit("ready", this.walletBackend.getApi());
    });

    return new Promise((resolve, reject) => {
      this.walletBackend.events.on("ready", resolve);
      this.walletBackend.events.on("exit", reject);
    });
  }

  /**
   * Poll TCP port of wallet API server until it accepts connections.
   * @param port - TCP port number
   * @return a promise that is completed once the wallet API server accepts connections.
   */
  private waitForApi(port: number): Promise<void> {
    return waitOn({
      resources: [`tcp:127.0.0.1:${port}`],
      delay: 10,// initial delay in ms, default 0
      interval: 250, // poll interval in ms, default 250
      timeout: 3600000,// timeout in ms, default Infinity
    });
  }

  /**
   * Stops the wallet backend. Attempts to cleanly shut down the
   * processes. However, if they have not exited before the timeout,
   * they will be killed.
   *
   * @param timeoutSeconds - how long to wait before killing the processes.
   * @return a [[Promise]] that is fulfilled at the timeout, or before.
   *
   * @event exit - `walletBackend.events` will emit this when the
   *   wallet and node have both exited.
   */
  stop(timeoutSeconds = 60): Promise<{ wallet: ServiceExitStatus, node: ServiceExitStatus }> {
    this.logger.debug(`Launcher.stop: stopping wallet and node`);
    return Promise.all([
      this.walletService.stop(timeoutSeconds),
      this.nodeService.stop(timeoutSeconds)
    ]).then(([wallet, node]) => {
      const status = { wallet, node };
      this.logger.debug(`Launcher.stop: both services are stopped.`, status);
      this.walletBackend.events.emit("exit", status);
      return status;
    });
  }
}

interface RequestParams {
  port: number;
  path: string;
  hostname: string;
};

/**
 * Connection parameters for the `cardano-wallet` API.
 * These should be used to build the HTTP requests.
 */
export interface Api {
  /**
   * API base URL, including trailling slash.
   */
  baseUrl: string;

  /**
   * URL components which can be used with the HTTP client library of
   * your choice.
   */
  requestParams: RequestParams;
}

class V2Api implements Api {
  /** URL of the API, including a trailling slash. */
  readonly baseUrl: string;
  /** URL components which can be used with the HTTP client library of
   * your choice. */
  readonly requestParams: RequestParams;

  constructor(port: number) {
    let hostname = "127.0.0.1";
    let path = "/v2/";
    this.baseUrl = `http://${hostname}:${port}${path}`;
    this.requestParams = { port, path, hostname };
  }
}

/**
 * The result after the launched wallet backend has finished.
 */
export interface ExitStatus {
  wallet: ServiceExitStatus;
  node: ServiceExitStatus;
}

/**
 * Format an [[ExitStatus]] as a multiline human-readable string.
 */
export function exitStatusMessage(status: ExitStatus): string {
  return _.map(status, serviceExitStatusMessage).join("\n");
}

/**
 * Represents the API service of `cardano-wallet`.
 */
export interface WalletBackend {
  /**
   * @return HTTP connection parameters for the `cardano-wallet` API server.
   */
  getApi(): Api,

  /**
   * An [[EventEmitter]] that can be used to register handlers when
   * the process changes status.
   *
   * ```typescript
   * launcher.walletBackend.events.on('ready', api => { ... });
   * ```
   */
  events: WalletBackendEvents,
}

/**
 * The type of events for [[WalletBackend]].
 */
type WalletBackendEvents = EventEmitter<{
  /**
   * [[Launcher.walletBackend.events]] will emit this when the API
   *  server is ready to accept requests.
   * @event
   */
  ready: (api: Api) => void,
  /** [[Launcher.walletBackend.events]] will emit this when the
   *  wallet and node have both exited.
   * @event
   */
  exit: (status: ExitStatus) => void,
}>;

interface WalletStartService extends StartService {
  apiPort: number;
};

function makeServiceCommands(config: LaunchConfig, logger: Logger): { wallet: Promise<WalletStartService>, node: Promise<StartService> } {
  const baseDir = path.join(config.stateDir, config.nodeConfig.kind, config.networkName);
  logger.info(`Creating base directory ${baseDir} (if it doesn't already exist)`);
  const mkBaseDir = fs.promises.mkdir(baseDir, { recursive: true })
  const node = mkBaseDir.then(() => nodeExe(baseDir, config));
  const wallet = node.then(nodeService => walletExe(baseDir, config, nodeService));
  return { wallet, node };
}

async function walletExe(baseDir: DirPath, config: LaunchConfig, node: StartService): Promise<WalletStartService> {
  const apiPort = config.apiPort || await getPort();
  const base: WalletStartService = {
    command: `cardano-wallet-${config.nodeConfig.kind}`,
    args: ["serve", "--port", "" + apiPort, "--database", path.join(baseDir, "wallet")]
      .concat(config.listenAddress ? ["--listen-address", config.listenAddress] : []),
    supportsCleanShutdown: true,
    apiPort,
  };
  const addArgs = (args: string[]): WalletStartService =>
     _.assign(base, { args: base.args.concat(args) });

  switch (config.nodeConfig.kind) {
    case "jormungandr":
      return addArgs([
        "--genesis-block-hash", config.nodeConfig.network.genesisBlock.hash,
        "--node-port", "" + config.nodeConfig.restPort
      ]);
    case "byron":
      return addArgs(config.nodeConfig.socketDir ? ["--node-socket", config.nodeConfig.socketDir] : []);
    case "shelley":
      return base;
  }
}

function nodeExe(baseDir: DirPath, config: LaunchConfig): Promise<StartService> {
  switch (config.nodeConfig.kind) {
    case "jormungandr":
      return jormungandr.startJormungandr(baseDir, config.nodeConfig);
    case "byron":
      return byron.startByronNode(baseDir, config.nodeConfig);
    case "shelley":
      return shelley.startShelleyNode(config.nodeConfig);
  }
}
