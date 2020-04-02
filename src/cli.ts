// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * `cardano-launcher` command-line interface.
 *
 * This tool can be used for testing.
 *
 * See also: the entrypoint script `bin/cardano-launcher`.
 *
 * @packageDocumentation
 */

import _ from 'lodash'
import process from 'process'

import {
  ExitStatus,
  Launcher
} from './cardanoLauncher'

import {
  ServiceExitStatus,
  serviceExitStatusMessage
} from './service'
import * as byron from './byron'
import * as jormungandr from './jormungandr'

/**
 * Main function of the CLI.
 *
 * Is just a very basic interface for testing things.
 */
export async function cli (argv: NodeJS.Process['argv']): Promise<void> {
  const waitForExit = setInterval(function () {
  }, 3600000)
  const args = argv

  args.shift() // /usr/bin/node
  args.shift() // cardano-launcher

  if (args.length < 4) {
    usage()
  }

  const backend = args.shift() as string
  const networkName = args.shift() as string
  const configurationDir = args.shift() as string
  const stateDir = args.shift() as string

  let nodeConfig: any

  if (backend === 'byron') {
    if (!(networkName in byron.networks)) {
      console.error(`unknown network: ${networkName}`)
      process.exit(2)
    }
    const network = byron.networks[networkName]
    nodeConfig = {
      kind: backend,
      configurationDir,
      network
    }
  } else if (backend === 'jormungandr') {
    if (!(networkName in jormungandr.networks)) {
      console.error(`unknown network: ${networkName}`)
      process.exit(2)
    }
    const network = jormungandr.networks[networkName]
    nodeConfig = {
      kind: backend,
      configurationDir,
      network
    }
  } else {
    usage()
  }

  const launcher = new Launcher({ stateDir, nodeConfig, networkName }, console)

  launcher.walletBackend.events.on('exit', (status: ExitStatus) => {
    console.log(serviceExitStatusMessage(status.wallet))
    console.log(serviceExitStatusMessage(status.node))
    clearInterval(waitForExit)
    process.exit(combineStatus([status.wallet, status.node]))
  })
  try {
    await launcher.start()
    const nodePid = await launcher.nodeService.start()
    const walletPid = await launcher.walletService.start()
    // inform tests of subprocess pids
    sendMaybe({ nodePid, walletPid })
  } catch (error) {
    console.error(error.message)
  }
}

function combineStatus (statuses: ServiceExitStatus[]): number {
  const code = _.reduce(
    statuses,
    (res: number | null, status) => (res === null ? status.code : res),
    null
  )
  const signal = _.reduce(
    statuses,
    (res: string | null, status) => (res === null ? status.signal : res),
    null
  )
  // let err = _.reduce(statuses, (res, status) => res === null ? status.err : res, null);

  return code === null ? (signal === null ? 0 : 127) : code
}

function usage (): void {
  console.log('usage: cardano-launcher BACKEND NETWORK CONFIG-DIR STATE-DIR')
  console.log('  BACKEND    - either jormungandr or byron')
  console.log(
    '  NETWORK    - depends on backend, e.g. mainnet, itn_rewards_v1'
  )
  console.log(
    '  CONFIG-DIR - directory which contains config files for a backend'
  )
  console.log('  STATE-DIR  - directory to put blockchains, databases, etc.')
  process.exit(1)
}

function sendMaybe (message: object): void {
  if (process.send !== undefined) {
    process.send(message)
  }
}

cli(process.argv)
  .catch(process.exit(1))
