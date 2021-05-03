import { Severity, Logger, LogFunc } from '../src/logging';

export interface MockLog {
  severity: Severity;
  msg: string;
  param: unknown;
}

export interface MockLogger extends Logger {
  getLogs(): MockLog[];
}

export function mockLogger(echo = false): MockLogger {
  const logs: MockLog[] = [];

  const mockLog = (severity: Severity): LogFunc => {
    return (msg: string, param?: unknown): void => {
      if (echo) {
        if (param) {
          console[severity](msg, param);
        } else {
          console[severity](msg);
        }
      }
      logs.push({ severity, msg, param: param || undefined });
    };
  };

  return {
    debug: mockLog('debug'),
    info: mockLog('info'),
    warn: mockLog('warn'),
    error: mockLog('error'),
    log: mockLog('log'),
    getLogs: (): MockLog[] => logs,
  };
}
