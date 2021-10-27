// Copyright © 2021 IOHK
// License: Apache-2.0

/* eslint-disable @typescript-eslint/no-unused-vars */

import { DefaultReporter, Reporter, Context } from '@jest/reporters';
import type { Config } from '@jest/types';
import type { AggregatedResult, TestResult } from '@jest/test-result';
import { StdioLogger } from '../../src/loggers';

interface DebugReporterOptions {
  env?: string;
}

/**
 * Print some of the jest config and status.
 *
 * The reporter implements only the `onRunStart` and `onRunComplete` lifecycle
 * functions.
 */
export class DebugReporter
  implements Pick<Reporter, 'onRunStart' | 'onRunComplete'>
{
  debug = false;
  logger = new StdioLogger({ fd: process.stderr.fd });

  constructor(
    readonly globalConfig: Config.GlobalConfig,
    readonly options?: DebugReporterOptions
  ) {}

  async onRunStart(_aggregatedResult: AggregatedResult) {
    const env = this.options?.env;
    this.debug = !env || !!process.env[env];
    if (this.debug) {
      this.logger.debug('onRunStart');
    }
  }

  async onRunComplete(ctx: Set<Context>, aggregatedResult: AggregatedResult) {
    if (this.debug) {
      this.logger.debug('onRunComplete');
      this.logger.debug('globalConfig', this.globalConfig);
      this.logger.debug('options', this.options);
      this.logger.debug('ctx', ctx);
      this.logger.debug('aggregatedResult', aggregatedResult);
    }
  }
}

/**
 * Attempt at making a reporter which hides console logging.
 * It doesn't seem to work.
 */
export class SilentReporter extends DefaultReporter {
  constructor(globalConfig: Config.GlobalConfig) {
    super(globalConfig);
  }

  printTestFileHeader(
    _testPath: string,
    config: Config.ProjectConfig,
    result: TestResult
  ): void {
    const console = result.console;

    if (result.numFailingTests === 0 && !result.testExecError) {
      result.console = undefined;
    }

    super.printTestFileHeader(_testPath, config, result);

    result.console = console;
  }
}
