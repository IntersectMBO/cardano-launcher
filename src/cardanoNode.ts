// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * Configuration for `cardano-node`
 *
 * @packageDocumentation
 */

import path from 'path';
import getPort from 'get-port';

import { StartService, ShutdownMethod, cleanShutdownFD } from './service';
import { FilePath, DirPath } from './common';

/**
 * Definition of a `cardano-node` network.
 */
export interface CardanoNetwork {
  /**
   * The YAML configuration file for cardano-node.
   */
  configFile: FilePath;
  /**
   * Network topology data to pass to cardano-node.
   */
  topologyFile: FilePath;
  /**
   * Path to the genesis file in JSON format.
   * This is required for testnet but not mainnet.
   * It is used to configure the parameters of cardano-wallet.
   * It should match the genesis file configured in the cardano-node YAML file.
   */
  genesisFile?: FilePath;
}

/** Predefined networks. */
export const networks: { [propName: string]: CardanoNetwork } = {
  ff: {
    configFile: 'configuration.json',
    topologyFile: 'topology.json',
    genesisFile: 'genesis.json',
  },
  mainnet: {
    configFile: 'configuration.yaml',
    topologyFile: 'topology.json',
  },
  testnet: {
    configFile: 'configuration.json',
    topologyFile: 'topology.json',
    genesisFile: 'genesis.json',
  },
};

/**
 * The command-line arguments which can be supplied to `cardano-node`.
 */
export interface CardanoNodeArgs {
  /**
   * Filename for the socket file to use for communicating with the
   * node.
   */
  socketFile: FilePath;

  /**
   * The path to a file describing the topology.
   * Topology is ...
   */
  topologyFile: FilePath;

  /** Directory where the state is stored. */
  databaseDir: DirPath;

  /** Path to the delegation certificate. */
  delegationCertificate?: string;

  /** Path to the signing key. */
  signingKey?: string;

  /** Path to the KES signing key. */
  kesKey?: string;

  /** Path to the VRF signing key. */
  vrfKey?: string;

  /** Path to the delegation certificate */
  operationalCertificate?: string;

  /** Configures the address to bind for P2P communication. */
  listen: {
    /** The TCP port for node P2P. */
    port: number;
    /** Optionally limit node P2P to one ipv6 or ipv4 address. */
    address?: string;
  };

  /** Configuration file for cardano-node. */
  configFile: FilePath;

  /** Validate all on-disk database files. */
  validateDb?: boolean;

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extra?: string[];
}

/**
 * Configuration parameters for starting cardano-node.
 */
export interface CardanoNodeConfig {
  kind: 'byron' | 'shelley';

  /** Directory containing configurations for all networks. */
  configurationDir: DirPath;

  /** Path to the delegation certificate. The delegation certificate allows the delegator
   * (the issuer of said certificate) to give his/her own block signing rights to somebody
   * else (the delegatee). The delegatee can then sign blocks on behalf of the delegator.
   * */
  delegationCertificate?: string;

  /** Network parameters */
  network: CardanoNetwork;

  /** Path to the KES signing key. */
  kesKey?: string;

  /** Path to the VRF signing key. */
  vrfKey?: string;

  /** Path to the delegation certificate */
  operationalCertificate?: string;

  /** Path to the signing key. */
  signingKey?: string;

  /**
   * Filename for the socket to use for communicating with the
   * node. Optional -- will be set automatically if not provided.
   */
  socketFile?: FilePath;
}

let pipeCounter = 0;

/**
 * Allocate a name for the pipe used to communicate with the node on
 * Windows. The network name and PID are used to ensure different
 * applications do not cross their streams.
 *
 * The name also includes a per-process counter, mostly so that
 * integration tests do not conflict with each other.
 *
 * @networkName: which network to put in the pipe name.
 * @return a [Pipe Name](https://docs.microsoft.com/en-us/windows/win32/ipc/pipe-names)
 */
function windowsPipeName(networkName: string): string {
  return `\\\\.\\pipe\\cardano-node-${networkName}.${
    process.pid
  }.${pipeCounter++}`;
}

/**
 * Convert a [[CardanoNodeConfig]] into command-line arguments
 * ([[CardanoNodeArgs]]) for `cardano-node`.
 */
function makeArgs(
  stateDir: DirPath,
  config: CardanoNodeConfig,
  networkName: string,
  listenPort: number
): CardanoNodeArgs {
  let socketFile = config.socketFile;
  if (!socketFile) {
    if (process.platform === 'win32') {
      config.socketFile = socketFile = windowsPipeName(networkName);
    } else {
      socketFile = 'cardano-node.socket'; // relative to working directory
      config.socketFile = path.join(stateDir, socketFile);
    }
  }
  return {
    socketFile,
    topologyFile: path.join(
      config.configurationDir,
      config.network.topologyFile
    ),
    databaseDir: 'chain', // relative to working directory
    delegationCertificate: config.delegationCertificate,
    listen: {
      port: listenPort,
    },
    configFile: path.join(config.configurationDir, config.network.configFile),
    signingKey: config.signingKey,
    kesKey: config.kesKey,
    vrfKey: config.vrfKey,
  };
}

/**
 * Chooses the command-line arguments for the node.
 *
 * @param stateDir - directory for node storage, specific to the node type and network.
 * @param config - parameters for starting the node.
 * @return the command-line for starting this node.
 */
export async function startCardanoNode(
  stateDir: DirPath,
  config: CardanoNodeConfig,
  networkName: string
): Promise<StartService> {
  const listenPort = await getPort();
  const args = makeArgs(stateDir, config, networkName, listenPort);
  return {
    command: 'cardano-node',
    args: [
      'run',
      '--socket-path',
      args.socketFile,
      '--shutdown-ipc',
      '' + cleanShutdownFD,
      '--topology',
      args.topologyFile,
      '--database-path',
      args.databaseDir,
      '--port',
      '' + args.listen.port,
      '--config',
      args.configFile,
    ]
      .concat(args.listen.address ? ['--host-addr', args.listen.address] : [])
      .concat(args.validateDb || false ? ['--validate-db'] : [])
      .concat(args.signingKey ? ['--signing-key', args.signingKey] : [])
      .concat(
        args.delegationCertificate
          ? ['--delegation-certificate', args.delegationCertificate]
          : []
      )
      .concat(args.kesKey ? ['--shelley-kes-key', args.kesKey] : [])
      .concat(args.vrfKey ? ['--shelley-vrf-key', args.vrfKey] : [])
      .concat(
        args.operationalCertificate
          ? ['--shelley-operational-certificate', args.operationalCertificate]
          : []
      )
      .concat(args.extra || []),
    shutdownMethod: ShutdownMethod.CloseFD,
    // set working directory to stateDir -- config file may have relative paths for logs.
    cwd: stateDir,
  };
}
