import { startService, ServiceStatus, ServiceExitStatus } from '../src';

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
    service.start();

    let pid = service.start();
    let code = await service.stop();
    expect(code.signal).toBe("SIGPIPE");
    // process should not exist
    expect(process.kill(pid, 0)).toThrow();
  });

  it('stopping a command (timeout)', async () => {
    let service = startService({ command: "sleep", args: ["10"] });
    let pid = service.start();
    let code = await service.stop(5);
    expect(code.signal).toBe("SIGTERM");
    // process should not exist
    expect(process.kill(pid, 0)).toThrow();
  });

  xit('stopping a command (parent process exits)', () => {
    // todo run cardano-launcher cli and kill that
  });

  it('command was killed', () => {
    let service = startService({ command: "sleep", args: ["10"] });
    let events: ServiceStatus[] = [];
    let pid = service.start();
    return new Promise(done => {
      setTimeout(() => {
        process.kill(pid);
      }, 1000);
      service.events.on("statusChanged", status => {
        events.push(status);
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
  });
});
