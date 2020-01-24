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

    launcher.walletService.events.on("statusChanged", (status: ServiceStatus) => {
      console.log("wallet service status changed " + status);
    });

    launcher.nodeService.events.on("statusChanged", (status: ServiceStatus) => {
      console.log("node service status changed " + status);
    });

    launcher.walletBackend.events.on("ready", (api: Api) => {
      console.log("ready event ", api);      
    });

    let api = await launcher.start();

    // http.get({
    //   hostname: 'localhost',
    //   port: 80,
    //   path: '/',
    //   agent: false
    // }, (res) => {
    //   // Do stuff with response
    // });

    console.log("started", api);

    await launcher.stop();

    console.log("stopped");

    expect(launcher).toBeTruthy();
  });
});

describe('Selects a free port for the API server', () => {
});

describe('Receives events when the node is started/stopped', () => {
});
