import { launchWalletBackend, ServiceStatus, Api } from '../src';

import * as http from "http";
import * as os from "os";
import * as path from "path";

describe('Starting cardano-wallet (and its node)', () => {
  it('jormungandr works', async () => {
    let stateDir = path.join(os.tmpdir(), "launcher-integration-test");
    let launcher = launchWalletBackend({
      stateDir,
      nodeConfig: {
        genesis: { hash: "yolo" }
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
      http.request(makeRequest(api, "network/information"), res => {
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



/**
 * Sets up the parameters for `http.request` for this Api.
 *
 * @param path - the api route (without leading slash)
 * @param options - extra options to be added to the request.
 * @return an options object suitable for `http.request`
 */
function makeRequest(api: Api, path: string, options?: object): object {
  return Object.assign({}, api.requestParams, {
    path: api.requestParams.path + path,
  }, options);
}
