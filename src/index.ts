/**
 * Module for starting and managing a Cardano node and wallet backend.
 *
 * @packageDocumentation
 */

import { EventEmitter } from 'tsee';
import { spawn, ChildProcess } from 'child_process';

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
  nodeConfig: ByronNodeConfig|ShelleyNodeConfig|JormungandrConfig;
}

/**
 * Configuration parameters for starting cardano-node (Shelley).
 */
export interface ShelleyNodeConfig {
  kind: "shelley";

  /**
   * File to use for communicating with the node.
   * Defaults to a filename within the state directory.
   */
  socketFileName?: string;

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extraArgs?: string[];
}

/**
 * Configuration parameters for starting the rewritten version of
 * cardano-node (Byron).
 */
export interface ByronNodeConfig {
  kind: "byron";

  /**
   * Contents of the `cardano-node` config file.
   */
  extraConfig?: { [propName: string]: any; };

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extraArgs?: string[];
}
/**
 * Configuration parameters for starting the node.
 */
export interface JormungandrConfig {
  kind: "jormungandr";

  /**
   * Network parameters. To be determined.
   */
  genesis: GenesisHash|GenesisBlockFile;

  restPort?: number;

  /**
   * Contents of the `jormungandr` config file.
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
    let start = makeServiceCommands(config)
    this.walletService = startService(start.wallet);
    this.nodeService = startService(start.node);
    this.walletBackend = {
      getApi: () => new V2Api(start.apiPort),
      events: new EventEmitter<{
        ready: (api: Api) => void,
        exit: (status: ExitStatus) => void,
      }>(),
    };
  }

  start(): Promise<Api> {
    return new Promise(resolve => {
      this.walletBackend.events.on("ready", resolve);
    });
  }

  /**
   * Stops the wallet backend. Attempts to cleanly shut down the
   * processes. However, if they have not exited before the timeout,
   * they will be killed.
   *
   * @param timeoutSeconds - how long to wait before killing the processes.
   * @return a [[Promise]] that is fulfilled at the timeout, or before.
   */
  stop(timeoutSeconds = 60): Promise<{ wallet: ServiceExitStatus, node: ServiceExitStatus }> {
    return Promise.all([
      this.walletService.stop(timeoutSeconds),
      this.nodeService.stop(timeoutSeconds)
    ]).then(([wallet, node]) => { return { wallet, node }; });
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

  /**
   * Sets up the parameters for `http.request` for this Api.
   *
   * @param path - the api route (without leading slash)
   * @param options - extra options to be added to the request.
   * @return an options object suitable for `http.request`
   */
  makeRequest(path: string, options?: object): object;
}

class V2Api implements Api {
  readonly baseUrl: string;
  readonly requestParams: { [propName: string]: any; };

  constructor(port: number) {
    let hostname = "127.0.0.1";
    let path = "/v2/";
    this.baseUrl = `http://${hostname}:${port}${path}`;
    this.requestParams ={  port, path, hostname };
  }

  makeRequest(path: string, options = {}): object {
    return Object.assign({}, this.requestParams, {
      path: this.requestParams.path + path,
    }, options);
  }
}

/**
 * The result after the launched wallet backend has finished.
 */
export interface ExitStatus {
  wallet: ServiceExitStatus;
  node: ServiceExitStatus;
}

export interface ServiceExitStatus {
  /** Program name. */
  exe: string;
  /** Process exit status code, if process exited itself. */
  code: number|null;
  /** Signal name, if process was killed. */
  signal: string|null;
  /** Error object, if process could not be started, or could not be killed. */
  err: Error|null;
}

/**
 * States for a launched process.  The processes are not guaranteed to
 * use all of these states. For example, a process may go directly
 * from `Started` to `Stopped`.
 */
export enum ServiceStatus {
  /** Initial state. */
  NotStarted,
  /** Subprocess has been started and has a PID. */
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
  start(): Pid;

  /**
   * Stops the process.
   * @return a promise that will be fulfilled when the process has stopped.
   */
  stop(timeoutSeconds?: number): Promise<ServiceExitStatus>;

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
  exit: (status: ExitStatus) => void,
}>;

/********************************************************************************
 * Internal
 */

/**
 * Stub function
 * @hidden
 */
export function startService(cfg: StartService): Service {
  const events = new EventEmitter<{
    statusChanged: (status: ServiceStatus) => void,
  }>();

  // What the current state is.
  let status = ServiceStatus.NotStarted;
  // NodeJS child process object, or null if not running.
  let proc: ChildProcess|null = null;
  // How the child process exited, or null if it hasn't yet exited.
  let exitStatus: ServiceExitStatus|null;
  // For cancelling the kill timeout.
  let killTimer: NodeJS.Timeout|null = null;

  const onStopped = (code: number|null = null, signal: string|null = null, err: Error|null = null) => {
    exitStatus = { exe: cfg.command, code, signal, err };
    status = ServiceStatus.Stopped;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    proc = null;
    events.emit("statusChanged", status);
  };

  return {
    start: () => {
      proc = spawn(cfg.command, cfg.args, {
        //cwd: stateDir
        stdio: ['pipe', 'inherit', 'inherit']
      });
      status = ServiceStatus.Started;
      events.emit("statusChanged", status);
      proc.on("exit", (code, signal) => {
        onStopped(code, signal);
      });
      proc.on("error", err => {
        onStopped(null, null, err);
      });

      return proc.pid;
    },
    stop: (timeoutSeconds: number = 60): Promise<ServiceExitStatus> => {
      const waitForStop = (): Promise<ServiceExitStatus> => new Promise(resolve => {
        events.on("statusChanged", status => {
          if (status === ServiceStatus.Stopped && exitStatus) {
            resolve(exitStatus);
          }
        });
      });
      const defaultExitStatus = { exe: cfg.command, code: null, signal: null, err: null };
      switch (status) {
        case ServiceStatus.NotStarted:
          return new Promise(resolve => {
            status = ServiceStatus.Stopped;
            exitStatus = defaultExitStatus;
            resolve(exitStatus);
          });
        case ServiceStatus.Started:
          status = ServiceStatus.Stopping;
          events.emit("statusChanged", status);
          if (proc && proc.stdin) {
            proc.stdin.end();
          }
          killTimer = setTimeout(() => {
            if (proc) {
              proc.kill();
            }
          }, timeoutSeconds * 1000);
          return waitForStop();
        case ServiceStatus.Stopping:
          return waitForStop();
        case ServiceStatus.Stopped:
          return new Promise(resolve => resolve(exitStatus || defaultExitStatus));
      }
    },
    getStatus: () => status,
    events,
  };
}

/**
 * Part of implementation.
 * @hidden
 */
interface StartService {
  command: string;
  args: string[];
}

function makeServiceCommands(config: LaunchConfig): { apiPort: number, wallet: StartService, node: StartService } {
  const apiPort = config.apiPort || 8090; // todo: find port
  const wallet = walletExe(config, apiPort);
  return { apiPort, wallet, node: nodeExe(config, wallet) };
}

function walletExe(config: LaunchConfig, port: number): StartService {
  switch (config.nodeConfig.kind) {
    case "jormungandr": return { command: "cardano-wallet-jormungandr", args: [`--port=${port}`] };
    case "byron": return { command: "cardano-wallet-byron", args: [`--port=${port}`] };
    case "shelley": return { command: "cardano-wallet-jormungandr", args: [`--port=${port}`] };
  }
}

function nodeExe(config: LaunchConfig, wallet: StartService): StartService {
  switch (config.nodeConfig.kind) {
    case "jormungandr": return startJormungandr(config.nodeConfig);
    case "byron": return startByronNode(config.nodeConfig);
    case "shelley": return startShelleyNode(config.nodeConfig);
  }
}

function startJormungandr(config: JormungandrConfig): StartService {
  return {
    command: "jormungandr",
    args: [
      "--rest-listen", `127.0.0.1:${config.restPort}`
    ].concat(config.extraArgs || [])
  };
}

function startByronNode(config: ByronNodeConfig): StartService {
  return {
    command: "cardano-node", args: ["--socket-dir", "/tmp"]
  };
}

function startShelleyNode(config: ShelleyNodeConfig): StartService {
  return {
    command: "cardano-node", args: ["--help"]
  };
}
