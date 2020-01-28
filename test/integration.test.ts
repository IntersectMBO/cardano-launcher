import { launchWalletBackend, ServiceStatus, Api } from '../src';

import * as http from "http";

describe('Starting cardano-wallet (and its node)', () => {
  it('works', async () => {
    let launcher = launchWalletBackend({
      stateDir: "/tmp/test-state-dir",
      nodeConfig: {
        genesis: { kind: "hash", hash: "yolo" }
      }
    });

    expect(launcher).toBeTruthy();

    launcher.walletService.events.on("statusChanged", (status: ServiceStatus) => {
      console.log("wallet service status changed " + status);
    });

    launcher.nodeService.events.on("statusChanged", (status: ServiceStatus) => {
      console.log("node service status changed " + status);
    });

    launcher.walletBackend.events.on("ready", (api: Api) => {
      console.log("ready event ", api);
    });

    const api = await launcher.start();

    console.log("started", api);

    const info = await new Promise(resolve => {
      http.request(api.makeRequest("network/information"), res => {
        res.on('data', d => resolve(d));
      });
    });

    console.log("info is ", info);

    expect(info).toBeTruthy();

    await launcher.stop();

    console.log("stopped");
  });
});

describe('Selects a free port for the API server', () => {
});

describe('Receives events when the node is started/stopped', () => {
});
