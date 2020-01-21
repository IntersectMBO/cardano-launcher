/**
 * Module for starting and managing a Cardano node and wallet backend.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'tsee';

/**
 * Starts the wallet backend.
 *
 * @param config - controls how the wallet and node are started
 * @param logger - logging backend that launcher will use
 * @returns an object that can be used to access the wallet backend
 */
export function launchWalletBackend(config: LaunchConfig, logger: Logger = console): Launcher {
  return new Launcher(config, logger);
}

/**
 * Configuration parameters for starting the wallet backend and node.
 */
interface LaunchConfig {
  /**
   * TCP port to use for the `cardano-wallet` API server.
   * The default is to select any free port.
   */
  apiPort?: number;

  /**
   * Directory to store wallet databases, the blockchain, socket
   * files, etc.
   */
  stateDir: string;

  /**
   * Configuration for starting `cardano-node`.
   */
  nodeConfig: ShelleyNodeConfig;
}

/**
 * Configuration parameters for starting the node.
 */
interface ShelleyNodeConfig {
  /**
   * Network parameters. To be determined.
   */
  genesis: GenesisHash|GenesisBlockFile;
  /**
   * File to use for communicating with the node.
   * Defaults to a filename within the state directory.
   */
  socketFileName?: string;

  /**
   * Contents of the `cardano-node` config file.
   */
  extraConfig?: { [propName: string]: any; };

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extraArgs?: string[];
}

interface GenesisHash {
  kind: "hash";
  hash: string;
}

interface GenesisBlockFile {
  kind: "block";
  filename: string;
}

/**
 * Function which logs a message and optional object.
 */
interface LogFunc {
  (msg: string, param?: object): void;
}

/**
 * Logging adapter.
 */
interface Logger {
  debug: LogFunc,
  info: LogFunc,
  error: LogFunc
}

/**
 * This is the main object which controls the launched wallet backend and its node.
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

  /**
   * Starts the wallet backend.
   *
   * @param config - controls how the wallet and node are started
   * @param logger - logging backend that launcher will use
   **/
  constructor(config: LaunchConfig, logger: Logger) {
    logger.debug("hello launch");

    this.logger = logger;
    this.walletService = startService();
    this.nodeService = startService();
    this.walletBackend = {
      getApi: () => { return {
        baseUrl: "http://127.0.0.1:8090/v2/",
        requestParams: {},
      }; },
      events: new EventEmitter<{
        ready: (api: Api) => void,
      }>(),
    };
  }

  /**
   * Stops the wallet backend. Attempts to cleanly shut down the
   * processes. However, if they have not exited before the timeout,
   * they will be killed.
   *
   * @param timeoutSeconds - how long to wait before killing the processes.
   * @return a [[Promise]] that is fulfilled at the timeout, or before.
   */
  stop(timeoutSeconds = 60) {
    return Promise.all([
      this.walletService.stop(timeoutSeconds),
      this.nodeService.stop(timeoutSeconds)
    ]);
  }
}

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
   * Extra options that should be added to the request with
   * `Object.assign`.
   */
  requestParams: { [propName: string]: any; };
}

/**
 * States for a launched process.  The processes are not guaranteed to
 * use all of these states. For example, a process may go directly
 * from `Started` to `Stopped`.
 */
export enum ServiceStatus {
  /** Initial state. Subprocess has been spawned. */
  Starting,
  /** Subprocess has started and has a PID. */
  Started,
  /** Caller has requested to stop the process. Now waiting for it to exit, or for the timeout to elapse. */
  Stopping,
  /** Subprocess has exited or been killed. */
  Stopped,
}

/**
 * A launched process.
 */
export interface Service {
  /**
   * @return a promise that will be fulfilled when the process has
   *   started. The returned PID is not guaranteed to be running. It may
   *   already have exited.
   */
  start(): Promise<Pid>;

  /**
   * Stops the process.
   * @return a promise that will be fulfilled when the process has stopped.
   */
  stop(timeoutSeconds?: number): Promise<void>;

  /**
   * @return the status of this process.
   */
  getStatus(): ServiceStatus;

  /**
   * An [[EventEmitter]] that can be used to register handlers when
   * the process changes status.
   *
   * ```typescript
   * launcher.walletService.events.on('statusChanged', status => { ... });
   * ```
   */
  events: ServiceEvents;
}

/** Process ID */
export type Pid = number;

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
 * The type of events for [[Service]].
 */
type ServiceEvents = EventEmitter<{
  statusChanged: (status: ServiceStatus) => void,
}>;

/**
 * The type of events for [[WalletBackend]].
 */
type WalletBackendEvents = EventEmitter<{
  ready: (api: Api) => void,
}>;

/********************************************************************************
 * Internal
 */

/**
 * Stub function
 * @hidden
 */
function startService(): Service {
  return {
    start: async () => 0,
    stop: async (timeoutSeconds) => {},
    getStatus: () => ServiceStatus.Starting,
    events: new EventEmitter<{
      statusChanged: (status: ServiceStatus) => void,
    }>(),
  };
}
