import { Launcher, ServiceStatus, Api } from '../src';

import * as http from "http";
import * as tmp from "tmp-promise";

import * as jormungandr from '../src/jormungandr';
import { makeRequest } from './utils';

// increase time available for tests to run
const longTestTimeoutMs = 15000;

describe('Starting cardano-wallet (and its node)', () => {
  it('cardano-wallet-jormungandr responds to requests', async () => {
    // let stateDir = path.join(os.tmpdir(), "launcher-integration-test");
    let stateDir = (await tmp.dir({ unsafeCleanup: true, prefix: "launcher-integration-test" })).path;
    let launcher = new Launcher({
      stateDir,
      networkName: "self",
      nodeConfig: {
        kind: "jormungandr",
        configurationDir: "test/data/jormungandr",
        network: jormungandr.networks.self,
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

    const info: any = await new Promise(resolve => {
      console.log("running req");
      const req = http.request(makeRequest(api, "network/information"), res => {
        res.setEncoding('utf8');
        res.on('data', d => resolve(JSON.parse(d)));
      });
      req.on('error', (e: any) => {
        console.error(`problem with request: ${e.message}`);
      });
      req.end();
    });

    console.log("info is ", info);

    expect(info.node_tip).toBeTruthy();

    await launcher.stop();

    console.log("stopped");
  }, longTestTimeoutMs);
});
