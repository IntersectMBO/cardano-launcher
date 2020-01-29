/**
 * Configuration for `cardano-node` (Byron)
 *
 * @packageDocumentation
 */

import { StartService } from './service';

/** Type alias to indicate the path of a file. */
export type FilePath = string;
/** Type alias to indicate the path of a directory. */
export type DirPath = string;

/** Predefined networks. */
export const byronNetworks: { [propName: string]: ByronNetwork; }  = {
  mainnet: {
    configFile: "configuration-mainnet.yaml",
    genesisFile: "mainnet-genesis.json",
    genesisHash: "5f20df933584822601f9e3f8c024eb5eb252fe8cefb24d1317dc3d432e940ebb",
    topologyFile: "mainnet-topology.json",
  },
};

/**
 * Definition of a `cardano-node` (Byron) network.
 */
export interface ByronNetwork {
  configFile: FilePath;
  genesisFile: FilePath;
  genesisHash: string;
  topologyFile: FilePath;
};

/**
 * Configuration parameters for starting the rewritten version of
 * cardano-node (Byron).
 */
export interface ByronNodeConfig {
  kind: "byron";

  /** Directory containing configurations for all networks. */
  configurationsDir: DirPath;

  networkName: string;
  network: ByronNetwork;

  /**
   * Contents of the `cardano-node` config file.
   */
  extraConfig?: { [propName: string]: any; };
}

/**
 * The command-line arguments which can be supplied to `cardano-node` (Byron).
 */
export interface ByronNodeArgs {
  /**
   * Directory which will contain a socket file to use for
   * communicating with the node.
   */
  socketDir: DirPath;

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

  /** The genesis block for this network's chain. */
  genesis: {
    /** The filename of the genesis block. */
    file: FilePath;
    /** The hash of the genesis block. */
    hash: string;
  };

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


function makeArgs(stateDir: DirPath, config: ByronNodeConfig): ByronNodeArgs {
  return {
    socketDir: `${stateDir}/sockets`,
    topologyFile: `${config.configurationsDir}/${config.network.topologyFile}`,
    databaseDir: `${stateDir}/chain`,
    genesis: {
      file: `${config.configurationsDir}/${config.network.genesisFile}`,
      hash: `${config.configurationsDir}/${config.network.genesisHash}`,
    },
    listen: {
      port: 9000, // fixme: hardcoded
    },
    configFile: `${config.configurationsDir}/${config.network.configFile}`,
  };
}

/**
 * Chooses the command-line arguments for the node.
 *
 * @param stateDir - directory for node storage, specific to the node type and network.
 * @param config - parameters for starting the node.
 * @return the command-line for starting this node.
 */
export function startByronNode(stateDir: DirPath, config: ByronNodeConfig): StartService {
  const args = makeArgs(stateDir, config);
  return {
    command: "cardano-node",
    args: [
      "--socket-dir", args.socketDir,
      "--topology", args.topologyFile,
      "--database-path", args.databaseDir,
      "--genesis-file", args.genesis.file,
      "--genesis-hash", args.genesis.hash,
      "--port", "" + args.listen.port,
      "--config", args.configFile
    ]
      .concat(args.listen.address ? ["--host-addr", args.listen.address] : [])
      .concat(args.validateDb || false ? ["--validate-db"] : [])
      .concat(args.signingKey ? ["--signing-key", args.signingKey] : [])
      .concat(args.delegationCertificate ? ["--delegation-certificate", args.delegationCertificate] : [])
      .concat(args.extra || []),
  };
}
