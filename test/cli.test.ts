// Copyright © 2020 IOHK
// License: Apache-2.0

import * as tmp from 'tmp-promise'
import path from 'path'

import { delay, expectProcessToBeGone, setupExecPath, withByronConfigDir } from './utils'
import { fork } from 'child_process'

describe('CLI tests', () => {
  const killTest = (args: string[]) => async () => {
    setupExecPath()
    const stateDir = (
      await tmp.dir({ unsafeCleanup: true, prefix: 'launcher-cli-test' })
    ).path
    const proc = fork(path.resolve(__dirname, '..', 'dist', 'cli.js'), args.concat([stateDir]), {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    })
    proc.on('message', (message: { nodePid: number, walletPid: number }) => {
      console.log('received message', message)
      if (message.nodePid !== undefined && message.walletPid !== undefined) {
        console.log(message)
        expect(message.nodePid).not.toBeNull()
        expect(message.walletPid).not.toBeNull()
        proc.kill()
        delay(1000).then(() => {
          expectProcessToBeGone(message.nodePid, 9)
          expectProcessToBeGone(message.walletPid, 9)
        }).catch(error => console.error(error.message))
      }
    })
  }

  it(
    'when the parent process is killed, child jormungandr gets stopped',
    killTest(['jormungandr', 'self', path.resolve(__dirname, 'data', 'jormungandr')])
  )

  it('when the parent process is killed, cardano-node gets stopped', async () =>
    await withByronConfigDir(async (configs) => await killTest(['byron', 'mainnet', configs])()))
})
