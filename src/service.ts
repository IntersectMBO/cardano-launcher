/**
 * Functions for starting and stopping an individual backend service.
 *
 * @packageDocumentation
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'tsee';

import { Logger } from './logging';


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
  start(): Promise<Pid>;

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
 * The type of events for [[Service]].
 */
type ServiceEvents = EventEmitter<{
  statusChanged: (status: ServiceStatus) => void,
}>;

/**
 * Spawn a service and control its lifetime.
 *
 * @param cfg - command to run.
 * @param logger - logging object.
 * @return A handle on the service.
 */
export function startService(cfgP: Promise<StartService>, logger: Logger = console): Service {
  const events = new EventEmitter<{
    statusChanged: (status: ServiceStatus) => void,
  }>();

  // What the current state is.
  let status = ServiceStatus.NotStarted;
  // Fulfilled promise of service command-line.
  // This will be defined if status > NotStarted.
  let cfg: StartService;
  // NodeJS child process object, or null if not running.
  let proc: ChildProcess|null = null;
  // How the child process exited, or null if it hasn't yet exited.
  let exitStatus: ServiceExitStatus|null;
  // For cancelling the kill timeout.
  let killTimer: NodeJS.Timeout|null = null;

  const doStart = async () => {
    logger.info(`Service.start: trying to start ${cfg.command} ${cfg.args.join(" ")}`, cfg);

    try {
      proc = spawn(cfg.command, cfg.args, {
        //cwd: stateDir
        stdio: [cfg.supportsCleanShutdown ? 'pipe' : 'ignore', 'inherit', 'inherit']
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
    if (proc) {
      if (cfg.supportsCleanShutdown && proc.stdin) {
        proc.stdin.end();
      } else {
        proc.kill("SIGTERM");
      }
    }
    killTimer = setTimeout(() => {
      if (proc) {
        logger.info(`Service.stop: timed out after ${timeoutSeconds} seconds. Killing process ${proc.pid}.`);
        proc.kill("SIGKILL");
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
    start: async () => {
      switch (status) {
        case ServiceStatus.NotStarted:
          cfg = await cfgP;
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
    stop: async (timeoutSeconds: number = 60): Promise<ServiceExitStatus> => {
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
 * Command to run for the service.
 */
export interface StartService {
  /** Program name. Will be searched for in `PATH`. */
  command: string;
  /** Command-line arguments. */
  args: string[];
  /**
   * Whether this service supports the clean shutdown method documented in
   * `docs/windows-clean-shutdown.md`.
   */
  supportsCleanShutdown: boolean;
}
