/**
 * Configuration for Jörmungandr.
 *
 * @packageDocumentation
 */

import { StartService } from './service';

/**
 * Configuration parameters for starting the node.
 */
export interface JormungandrConfig {
  kind: "jormungandr";

  /**
   * Network parameters. To be determined.
   */
  genesis: GenesisHash|GenesisBlockFile;

  restPort?: number;

  /**
   * Contents of the `jormungandr` config file.
   */
  extraConfig?: { [propName: string]: any; };

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extraArgs?: string[];
}

export interface GenesisHash {
  kind: "hash";
  hash: string;
}

export interface GenesisBlockFile {
  kind: "block";
  filename: string;
}


export function startJormungandr(config: JormungandrConfig): StartService {
  return {
    command: "jormungandr",
    args: [
      "--rest-listen", `127.0.0.1:${config.restPort}`
    ].concat(config.extraArgs || [])
  };
}
