// Copyright © 2020 IOHK
// License: Apache-2.0

/**
 * Common types.
 *
 * @packageDocumentation
 */

/** Type alias to indicate the path of a file. */
export type FilePath = string;
/** Type alias to indicate the path of a directory. */
export type DirPath = string;

/**
 * Use this with `.catch()` on promises where the error is already
 * handled elsewhere, but where you would like to debug log the
 * condition.
 */
export function catchFloatingPromise(err: Error) {
  console.debug("Caught an unhandled promise " + (new Error()).stack);
  console.debug(err);
}

/**
 * Use this with `.catch()` on promises where the error is already
 * handled elsewhere. This handler does nothing except prevent an
 * eslint warning from appearing.
 */
export function ignorePromiseRejection(_: Error) {
}
