import { startService, Service, ServiceStatus, ServiceExitStatus, Logger, LogFunc } from '../src/cardanoLauncher';

// increase time available for some tests to run
const longTestTimeoutMs = 15000;

describe('startService', () => {
  it('starting simple command', async () => {
    let service = startService({ command: "echo", args: ["test echo"] });
    let events: ServiceStatus[] = [];
    service.events.on("statusChanged", status => events.push(status));
    service.start();

    return new Promise(done => {
      service.events.on("statusChanged", status => {
        if (status === ServiceStatus.Stopped) {
          expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopped]);
        }
        done();
      });
    });
  });

  it('stopping a command', async () => {
    let service = startService({ command: "cat", args: [] });
    let events: ServiceStatus[] = [];
    service.events.on("statusChanged", status => events.push(status));
    let pid = service.start();
    let result = await service.stop(2);
    // process should not exist
    expect(() => process.kill(pid, 0)).toThrow();
    // end of file for cat
    expect(result).toEqual({ exe: "cat", code: 0, signal: null, err: null });
  });

  it('stopping a command (timeout)', async () => {
    let service = startService({ command: "sleep", args: ["4"] });
    let pid = service.start();
    let result = await service.stop(2);
    // process should not exist
    expect(() => process.kill(pid, 0)).toThrow();
    // exited with signal
    expect(result).toEqual({ exe: "sleep", code: null, signal: "SIGTERM", err: null });
  });

  xit('stopping a command (parent process exits)', () => {
    // todo run cardano-launcher cli and kill that
  });

  it('command was killed', () => {
    let service = startService({ command: "sleep", args: ["10"] });
    let events: ServiceStatus[] = [];
    service.events.on("statusChanged", status => events.push(status));
    let pid = service.start();
    return new Promise(done => {
      setTimeout(() => {
        process.kill(pid);
      }, 1000);
      service.events.on("statusChanged", status => {
        if (status === ServiceStatus.Stopped) {
          expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopped]);
        }
        service.stop().then((status: ServiceExitStatus) => {
          expect(status.code).toBeNull();
          expect(status.signal).toBe("SIGTERM");
          expect(status.exe).toBe("sleep");
          done();
        });
      });
    });
  }, longTestTimeoutMs);

  it('start is idempotent', async () => {
    let service = startService({ command: "cat", args: [] });
    let events = collectEvents(service);
    let pid1 = service.start();
    let pid2 = service.start();
    await service.stop(2);
    // should have only started once
    expect(pid1).toBe(pid2);
    // process should not exist
    expectProcessToBeGone(pid1);
    // events fire only once
    expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopping, ServiceStatus.Stopped]);
  });

  it('stop is idempotent', async () => {
    let service = startService({ command: "cat", args: [] });
    let events = collectEvents(service);
    let pid = service.start();
    let result1 = await service.stop(2);
    let result2 = await service.stop(2);
    // same result
    expect(result1).toEqual(result2);
    // process should not exist
    expectProcessToBeGone(pid);
    // cat command exits normally
    expect(result1).toEqual({ exe: "cat", code: 0, signal: null, err: null });
    // events fire only once
    expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopping, ServiceStatus.Stopped]);
  });

  it('stopping an already stopped command', done => {
    let service = startService({ command: "echo", args: ["hello from tests"] });
    let events = collectEvents(service);
    let pid = service.start();
    setTimeout(() => {
      // should have exited after 1 second
      expectProcessToBeGone(pid);
      // stop what's already stopped
      service.stop(2).then(result => {
        // check collected status
        expect(result).toEqual({ exe: "echo", code: 0, signal: null, err: null });
        // sequence of events doesn't include Stopping
        expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopped]);
        done();
      });
    }, 1000);
  });

  it('starting a bogus command', async () => {
    let logger = mockLogger(true);
    let service = startService({ command: "xyzzy", args: [] }, logger);
    let events = collectEvents(service);
    service.start();
    let result = await service.waitForExit();
    expect(result.err ? result.err.toString() : null).toBe("Error: spawn xyzzy ENOENT");
    expect(result.code).toBeNull();
    expect(result.signal).toBeNull();
    expect(events).toEqual([ServiceStatus.Started, ServiceStatus.Stopped]);
    expect(logger.getLogs().filter(l => l.severity === "error").length).toBe(1);
  });
});

/*******************************************************************************
 * Utils
 ******************************************************************************/

/**
 * Expect the given process ID to not exist.
 */
const expectProcessToBeGone = (pid: number): void => {
  expect(() => process.kill(pid, 0)).toThrow();
};

/**
 * @return mutable array which will contain events as they occur.
 */
const collectEvents = (service: Service): ServiceStatus[] => {
  let events: ServiceStatus[] = [];
  service.events.on("statusChanged", status => events.push(status));
  return events;
};

interface MockLog {
  severity: "debug"|"info"|"error";
  msg: string;
  param: object|undefined;
}

interface MockLogger extends Logger {
  getLogs(): MockLog[];
}

function mockLogger(echo: boolean = false): MockLogger {
  let logs: MockLog[] = [];

  const mockLog = (severity: "debug"|"info"|"error"): LogFunc => {
    return (msg: string, param?: object) => {
      if (echo) {
        if (param) {
          console[severity](msg, param);
        } else {
          console[severity](msg);
        }
      }
      logs.push({ severity, msg, param: param || undefined })
    };
  };

  return {
    debug: mockLog("debug"),
    info: mockLog("info"),
    error: mockLog("error"),
    getLogs: () => logs,
  };
}
