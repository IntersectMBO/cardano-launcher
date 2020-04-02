// Copyright © 2020 IOHK
// License: Apache-2.0

import { setupService, ServiceStatus, ServiceExitStatus } from '../src/service'
import {
  testService,
  collectEvents,
  expectProcessToBeGone,
  mockLogger
} from './utils'

// increase time available for some tests to run
const longTestTimeoutMs = 15000

// Note: These tests use simple coreutils commands as mock services.
// For example, `cat` will read its standard input and exit on EOF.
// On Windows, they are installed as part of Git For Windows.

describe('setupService', () => {
  it('starting simple command', async () => {
    const service = setupService(testService('echo', ['test echo']))
    const events: ServiceStatus[] = []
    service.events.on('statusChanged', status => events.push(status))
    await service.start()
    expect(service.getProcess()).toHaveProperty('pid')
    return await new Promise(done => {
      service.events.on('statusChanged', status => {
        if (status === ServiceStatus.Stopped) {
          expect(events).toEqual([
            ServiceStatus.Starting,
            ServiceStatus.Started,
            ServiceStatus.Stopped
          ])
        }
        done()
      })
    })
  })

  it('stopping a command', async () => {
    const service = setupService(testService('cat', []))
    const events: ServiceStatus[] = []
    service.events.on('statusChanged', status => events.push(status))
    const pid = await service.start()
    const result = await service.stop(2)
    // process should not exist
    expect(() => process.kill(pid, 0)).toThrow()
    // end of file for cat
    expect(result).toEqual({ exe: 'cat', code: 0, signal: null, err: null })
  })

  it('stopping a command (timeout)', async () => {
    const service = setupService(testService('sleep', ['4']))
    const pid = await service.start()
    const result = await service.stop(2)
    // process should not exist
    expect(() => process.kill(pid, 0)).toThrow()
    // exited with signal
    expect(result).toEqual({
      exe: 'sleep',
      code: null,
      signal: 'SIGKILL',
      err: null
    })
  })

  it(
    'command was killed',
    () => {
      const service = setupService(testService('sleep', ['10'], false))
      const events: ServiceStatus[] = []
      service.events.on('statusChanged', status => events.push(status))
      const pidP = service.start()
      return await new Promise(done => {
        setTimeout(
          () =>
            pidP.then(pid => {
              console.log('Killing the process ' + pid)
              process.kill(pid)
            }),
          1000
        )
        service.events.on('statusChanged', status => {
          if (status === ServiceStatus.Stopped) {
            expect(events).toEqual([
              ServiceStatus.Starting,
              ServiceStatus.Started,
              ServiceStatus.Stopped
            ])
            service.stop().then((status: ServiceExitStatus) => {
              if (process.platform === 'win32') {
                expect(status.code).toBe(1)
              } else {
                expect(status.code).toBeNull()
                expect(status.signal).toBe('SIGTERM')
              }
              expect(status.exe).toBe('sleep')
              done()
            })
          }
        })
      })
    },
    longTestTimeoutMs
  )

  it('start is idempotent', async () => {
    const service = setupService(testService('cat', []))
    const events = collectEvents(service)
    const pid1 = await service.start()
    const pid2 = await service.start()
    await service.stop(2)
    // should have only started once
    expect(pid1).toBe(pid2)
    // process should not exist
    expectProcessToBeGone(pid1)
    // events fire only once
    expect(events).toEqual([
      ServiceStatus.Starting,
      ServiceStatus.Started,
      ServiceStatus.Stopping,
      ServiceStatus.Stopped
    ])
  })

  it('stop is idempotent', async () => {
    const service = setupService(testService('cat', []))
    const events = collectEvents(service)
    const pid = await service.start()
    const result1 = await service.stop(2)
    const result2 = await service.stop(2)
    // same result
    expect(result1).toEqual(result2)
    // process should not exist
    expectProcessToBeGone(pid)
    // cat command exits normally
    expect(result1).toEqual({ exe: 'cat', code: 0, signal: null, err: null })
    // events fire only once
    expect(events).toEqual([
      ServiceStatus.Starting,
      ServiceStatus.Started,
      ServiceStatus.Stopping,
      ServiceStatus.Stopped
    ])
  })

  it('stopping an already stopped command', done => {
    const service = setupService(testService('echo', ['hello from tests']))
    const events = collectEvents(service)
    const pidP = service.start()
    setTimeout(() => {
      // should have exited after 1 second
      pidP.then(pid => {
        expectProcessToBeGone(pid)
        // stop what's already stopped
        service.stop(2).then(result => {
          // check collected status
          expect(result).toEqual({
            exe: 'echo',
            code: 0,
            signal: null,
            err: null
          })
          // sequence of events doesn't include Stopping
          expect(events).toEqual([
            ServiceStatus.Starting,
            ServiceStatus.Started,
            ServiceStatus.Stopped
          ])
          done()
        })
      })
    }, 1000)
  })

  it('starting a bogus command', async () => {
    const logger = mockLogger(true)
    const service = setupService(testService('xyzzy', []), logger)
    const events = collectEvents(service)
    await service.start()
    const result = await service.waitForExit()
    expect(result.err ? result.err.toString() : null).toBe(
      'Error: spawn xyzzy ENOENT'
    )
    expect(result.code).toBeNull()
    expect(result.signal).toBeNull()
    expect(events).toEqual([
      ServiceStatus.Starting,
      ServiceStatus.Started,
      ServiceStatus.Stopped
    ])
    expect(logger.getLogs().filter(l => l.severity === 'error').length).toBe(1)
  })
})
