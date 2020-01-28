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
export interface LogFunc {
  (msg: string, param?: object): void;
}

/**
 * Logging adapter.
 */
export interface Logger {
  debug: LogFunc,
  info: LogFunc,
  error: LogFunc
}


function appendName(logger: Logger, name: string): Logger {
  const prefix = (severity: "debug"|"info"|"error", msg: string, param?: object) => {
    const prefixed = `${name}: ${msg}`;
    if (param) {
      logger[severity](prefixed, param);
    } else {
      logger[severity](prefixed);
    }
  };
  return {
    debug: (msg: string, param?: object) => prefix("debug", msg, param),
    info: (msg: string,  param?: object) => prefix("info", msg, param),
    error: (msg: string,  param?: object) => prefix("error", msg, param),
  };
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
    logger.debug("Launcher init");
    this.logger = logger;
    let start = makeServiceCommands(config)
    this.walletService = startService(start.wallet, appendName(logger, "wallet"));
    this.nodeService = startService(start.node, appendName(logger, "node"));

    this.walletBackend = {
      getApi: () => new V2Api(start.apiPort),
      events: new EventEmitter<{
        ready: (api: Api) => void,
        exit: (status: ExitStatus) => void,
      }>(),
    };

    const self = this;

    this.walletService.events.on("statusChanged", status => {
      if (status === ServiceStatus.Stopped) {
        self.logger.debug("wallet exited, so stopping node");
        self.stop();
      }
    });

    this.nodeService.events.on("statusChanged", status => {
      if (status === ServiceStatus.Stopped) {
        self.logger.debug("node exited, so stopping wallet");
        self.stop();
      }
    });
  }

  /**
   * @return a promise that will be fulfilled when the wallet API
   * server is ready to accept requests.
   */
  start(): Promise<Api> {
    this.walletService.start();
    this.nodeService.start();

    // todo: poll for ready

    return new Promise((resolve, reject) => {
      this.walletBackend.events.on("ready", resolve);
      this.walletBackend.events.on("exit", reject);
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
   * Waits for the process to finish somehow -- whether it exits by
   * itself, or exits due to `stop()` being called.
   *
   * @return a promise that will be fulfilled when the process has exited.
   */
  waitForExit(): Promise<ServiceExitStatus>;

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
export function startService(cfg: StartService, logger: Logger = console): Service {
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

  const doStart = () => {
    logger.info(`Service.start: trying to start ${cfg.command}`, cfg);

    try {
      proc = spawn(cfg.command, cfg.args, {
        //cwd: stateDir
        stdio: ['pipe', 'inherit', 'inherit']
      });
    } catch (err) {
      logger.error(`Service.start: child_process.spawn() failed: ${err}`);
      throw err;
    }
    setStatus(ServiceStatus.Started);
    proc.on("exit", (code, signal) => {
      onStopped(code, signal);
    });
    proc.on("error", err => {
      logger.error(`Service.start: child_process failed: ${err}`);
      onStopped(null, null, err);
    });
    return proc.pid;
  };

  const doStop = (timeoutSeconds: number) => {
    logger.info(`Service.stop: trying to stop ${cfg.command}`, cfg);
    setStatus(ServiceStatus.Stopping);
    if (proc && proc.stdin) {
      proc.stdin.end();
    }
    killTimer = setTimeout(() => {
      if (proc) {
        logger.info(`Service.stop: timed out after ${timeoutSeconds} seconds. Killing process ${proc.pid}.`);
        proc.kill();
      }
    }, timeoutSeconds * 1000);
  };

  const onStopped = (code: number|null = null, signal: string|null = null, err: Error|null = null) => {
    exitStatus = { exe: cfg.command, code, signal, err };
    logger.debug(`Service onStopped`, exitStatus);
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    proc = null;
    setStatus(ServiceStatus.Stopped);
  };

  const waitForStop = (): Promise<ServiceExitStatus> => new Promise(resolve => {
    logger.debug(`Service.stop: waiting for ServiceStatus.Stopped`);
    events.on("statusChanged", status => {
      if (status === ServiceStatus.Stopped && exitStatus) {
        resolve(exitStatus);
      }
    });
  });

  const waitForExit = (): Promise<ServiceExitStatus> => {
    const defaultExitStatus = { exe: cfg.command, code: null, signal: null, err: null };
    switch (status) {
      case ServiceStatus.NotStarted:
        return new Promise(resolve => {
          status = ServiceStatus.Stopped;
          exitStatus = defaultExitStatus;
          resolve(exitStatus);
        });
      case ServiceStatus.Started:
        return waitForStop();
      case ServiceStatus.Stopping:
        return waitForStop();
      case ServiceStatus.Stopped:
        return new Promise(resolve => resolve(exitStatus || defaultExitStatus));
    }
  };

  const setStatus = (newStatus: ServiceStatus): void => {
    logger.debug(`setStatus ${ServiceStatus[status]} -> ${ServiceStatus[newStatus]}`);
    status = newStatus;
    events.emit("statusChanged", status);
  };

  return {
    start: () => {
      switch (status) {
        case ServiceStatus.NotStarted:
          return doStart();
        case ServiceStatus.Started:
          logger.info(`Service.start: already started`);
          return proc ? proc.pid : -1;
        case ServiceStatus.Stopping:
          logger.info(`Service.start: cannot start - already stopping`);
          return -1;
        case ServiceStatus.Stopped:
          logger.info(`Service.start: cannot start - already stopped`);
          return -1;
      }
    },
    stop: (timeoutSeconds: number = 60): Promise<ServiceExitStatus> => {
      switch (status) {
        case ServiceStatus.NotStarted:
          logger.info(`Service.stop: cannot stop - never started`);
          break;
        case ServiceStatus.Started:
          doStop(timeoutSeconds);
          break;
        case ServiceStatus.Stopping:
          logger.info(`Service.stop: already stopping`);
          break;
        case ServiceStatus.Stopped:
          logger.info(`Service.stop: already stopped`);
          break;
      }
      return waitForExit();
    },
    waitForExit,
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
