// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * Configuration for `cardano-node` (Shelley)
 *
 * @packageDocumentation
 */

import path from 'path';
import getPort from 'get-port';

import { StartService, ShutdownMethod, cleanShutdownFD } from './service';
import { FilePath, DirPath } from './common';

/** Predefined networks. */
export const networks: { [propName: string]: ShelleyNetwork } = {
  ff: {
    configFile: 'configuration.yaml',
    topologyFile: 'topology.json',
    genesisFile: 'genesis.json',
  },
};

/**
 * Definition of a `cardano-node` (Shelley) network.
 */
export interface ShelleyNetwork {
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

/**
 * Configuration parameters for starting the rewritten version of
 * cardano-node (Shelley).
 */
export interface ShelleyNodeConfig {
  kind: 'shelley';

  /** Directory containing configurations for all networks. */
  configurationDir: DirPath;

  /** Network parameters */
  network: ShelleyNetwork;

  /** Path to the KES signing key. */
  kesKey?: string;

  /** Path to the VRF signing key. */
  vrfKey?: string;

  /** Path to the delegation certificate */
  operationalCertificate?: string;

  /**
   * Filename for the socket to use for communicating with the
   * node. Optional -- will be set automatically if not provided.
   */
  socketFile?: FilePath;
}

/**
 * The command-line arguments which can be supplied to `cardano-node` (Shelley).
 */
export interface ShelleyNodeArgs {
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
 * Convert a [[ShelleyNodeConfig]] into command-line arguments
 * ([[ShelleyNodeArgs]]) for `cardano-node`.
 */
function makeArgs(
  stateDir: DirPath,
  config: ShelleyNodeConfig,
  networkName: string,
  listenPort: number
): ShelleyNodeArgs {
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
    listen: {
      port: listenPort,
    },
    configFile: path.join(config.configurationDir, config.network.configFile),
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
export async function startShelleyNode(
  stateDir: DirPath,
  config: ShelleyNodeConfig,
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
