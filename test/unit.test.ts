import { launchWalletBackend } from '../src';

describe('Starting cardano-wallet (and its node)', () => {
  it('works', () => {
    let res = launchWalletBackend({
      stateDir: "/tmp/test-state-dir",
      nodeConfig: {
        genesis: { kind: "hash", hash: "yolo" }
      }
    });
    expect(res).toBeTruthy();
  });
});

describe('Selects a free port for the API server', () => {
});

describe('Receives events when the node is started/stopped', () => {
});
