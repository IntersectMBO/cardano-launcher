// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * Configuration for `cardano-node` (Byron)
 *
 * @packageDocumentation
 */

import path from 'path';
import getPort from 'get-port';

import { StartService } from './service';
import { FilePath, DirPath } from './common';

/** Predefined networks. */
export const networks: { [propName: string]: ByronNetwork } = {
  mainnet: {
    configFile: 'configuration-mainnet.yaml',
    genesisFile: 'mainnet-genesis.json',
    topologyFile: 'mainnet-topology.json',
  },
};

/**
 * Definition of a `cardano-node` (Byron) network.
 */
export interface ByronNetwork {
  configFile: FilePath;
  genesisFile: FilePath;
  topologyFile: FilePath;
}

/**
 * Configuration parameters for starting the rewritten version of
 * cardano-node (Byron).
 */
export interface ByronNodeConfig {
  kind: 'byron';

  /** Directory containing configurations for all networks. */
  configurationDir: DirPath;

  /** Path to the delegation certificate. The delegation certificate allows the delegator
   * (the issuer of said certificate) to give his/her own block signing rights to somebody
   * else (the delegatee). The delegatee can then sign blocks on behalf of the delegator.
   * */
  delegationCertificate?: string;

  /** Network parameters */
  network: ByronNetwork;

  /** Path to the signing key. */
  signingKey?: string;

  /**
   * Filename for the socket to use for communicating with the
   * node. Optional -- will be set automatically if not provided.
   */
  socketFile?: FilePath;
}

/**
 * The command-line arguments which can be supplied to `cardano-node` (Byron).
 */
export interface ByronNodeArgs {
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

  /** Configures the address to bind for P2P communication. */
  listen: {
    /** The TCP port for node P2P. */
    port: number;
    /** Optionally limit node P2P to one ipv6 or ipv4 address. */
    address?: string;
  };

  /** Configuration file for the cardano-node. */
  configFile: FilePath;

  /** Validate all on-disk database files. */
  validateDb?: boolean;

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extra?: string[];
}

/**
 * Convert a [[ByronNodeConfig]] into command-line arguments
 * ([[ByronNodeArgs]]) for `cardano-node`.
 */
function makeArgs(
  stateDir: DirPath,
  config: ByronNodeConfig,
  networkName: string,
  listenPort: number
): ByronNodeArgs {
  let socketFile = config.socketFile;
  if (!socketFile) {
    if (process.platform === 'win32') {
      config.socketFile = socketFile = `\\\\.\\pipe\\cardano-node-${networkName}`;
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
  };
}

/**
 * Chooses the command-line arguments for the node.
 *
 * @param stateDir - directory for node storage, specific to the node type and network.
 * @param config - parameters for starting the node.
 * @return the command-line for starting this node.
 */
export async function startByronNode(
  stateDir: DirPath,
  config: ByronNodeConfig,
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
      .concat(args.extra || []),
    supportsCleanShutdown: false,
    // set working directory to stateDir -- config file may have relative paths for logs.
    cwd: stateDir,
  };
}
