/**
 * Configuration for `cardano-node` (Shelley).
 *
 * @packageDocumentation
 */

import { StartService } from './service';

/**
 * Configuration parameters for starting cardano-node (Shelley).
 *
 * Unimplemented!
 */
export interface ShelleyNodeConfig {
  kind: "shelley";

  /**
   * Directory which will contain a socket file to use for communicating with the node.
   * Defaults to a subdirectory of the state directory.
   */
  socketDir?: string;

  /**
   * Extra arguments to add to the `cardano-node` command line.
   */
  extraArgs?: string[];
}

export function startShelleyNode(config: ShelleyNodeConfig): StartService {
  throw new Error("shelley backend not implemented");
  // return {
  //   command: "cardano-node", args: ["--help"]
  // };
}
