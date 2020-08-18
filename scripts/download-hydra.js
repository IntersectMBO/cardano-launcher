// This script downloads Windows builds of cardano-wallet from Hydra.
// It gets a build for the exact revision specified in nix/sources.json.

const axios = require('axios');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

function makeHydraApi(hydraURL, options = {}) {
  const api = axios.create(_.merge({
    baseURL: hydraURL,
    headers: { "Content-Type": "application/json" },
  }, options));
  api.interceptors.request.use(request => {
    console.debug("Hydra " + request.url);
    return request;
  });
  return api;
}

function makeGitHubApi(options = {}) {
  const api = axios.create(_.merge({
    baseURL: "https://api.github.com/",
    headers: { "Content-Type": "application/json" },
  }, options));
  api.interceptors.request.use(request => {
    console.debug(`${request.method} ${request.baseURL}${request.url}`);
    return request;
  });
  return api;
}

async function findEvalByCommit(api, project, jobset, rev, page)  {
  const evalsPath = `jobset/${project}/${jobset}/evals${page || ""}`;
  const r = await api.get(jobPath);

  const eval = _.find(r.data.evals, e => e.jobsetevalinputs["cardano-wallet"].revision === rev);

  if (eval) {
    return eval;
  } else if (r.data.next) {
    return findEvalByCommit(api, project, jobset, rev, r.data.next);
  } else {
    return undefined;
  }
}

function findCardanoWalletEval(api, rev) {
  return findEvalByCommit(apiapi, "Cardano", "cardano-wallet", rev);
}

async function findEvalFromGitHub(hydra, github, owner, repo, ref, page) {
  const q = page ? ("?page=" + page) : "";
  const r = await github.get(`repos/${owner}/${repo}/commits/${ref}/statuses${q}`);

  const status = _.find(r.data, { context: "ci/hydra-eval" });

  if (status) {
    if (status.state === "success") {
      const eval = await hydra.get(status.target_url);
      return eval.data;
    } else if (status.state === "pending") {
       console.log("Eval is pending - trying again...");
       await sleep(1000);
       return await findEvalFromGitHub(hydra, github, owner, repo, ref);
    } else {
      console.error("Can't get eval - it was not successful.");
      return null;
    }
  } else {
    const next = (page || 1) + 1;
    console.log(`Eval not found - trying page ${next}`);
    return await findEvalFromGitHub(hydra, github, owner, repo, ref, next);
  }
}

async function findBuildsInEval(api, eval, jobs) {
  let builds = {};
  for (let i = 0; i < eval.builds.length; i++) {
    const r = await api.get(`build/${eval.builds[i]}`);
    if (_.includes(jobs, r.data.job)) {
      console.log(`Found ${r.data.job}`);
      builds[r.data.job] = r.data;
      if (_.size(builds) === _.size(jobs)) {
        break;
      }
    }
  }
  return builds;
}

async function downloadBuildProduct(outDir, hydraUrl, build, number) {
  const buildProduct = build.buildproducts[number];
  const filename = buildProduct.name;
  const writer = fs.createWriteStream(path.join(outDir, filename));
  const url = `${hydraUrl}build/${build.id}/download/${number}/${filename}`;

  console.log(`Downloading ${url}`);

  await axios({
    method: 'get',
    url,
    responseType: 'stream',
  }).then(response => {
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let error = null;
      writer.on('error', err => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on('close', () => {
        if (!error) {
          resolve(true);
        }
      });
    });
  });
}

async function download(outDir, downloadSpec, options = {}) {
  const hydraUrl = "https://hydra.iohk.io/";
  const hydraApi = makeHydraApi(hydraUrl, options);
  const github = makeGitHubApi(options);

  const eval = await findEvalFromGitHub(hydraApi, github, downloadSpec.owner, downloadSpec.repo, downloadSpec.rev);
  console.log(`Eval has ${eval.builds.length} builds`);
  const downloads = downloadSpec.jobs;

  const builds = await findBuildsInEval(hydraApi, eval, _.map(downloads, "job"));

  for (let i = 0; i < downloads.length; i++) {
    const build = builds[downloads[i].job];
    for (let j = 0; j < downloads[i].buildProducts.length; j++) {
      await downloadBuildProduct(outDir, hydraUrl, build, "" + downloads[i].buildProducts[j]);
    }
  }
}

function getTargetPlatform() {
  return process.env.CARDANO_LAUNCHER_PLATFORM || process.platform
}

function getTargetArch () {
  return process.env.CARDANO_LAUNCHER_ARCH || process.arch
}

function sleep(ms = 0) {
  return new Promise(r => setTimeout(r, ms));
};

function getNiv(sourceName) {
  const sources = JSON.parse(fs.readFileSync("nix/sources.json", "utf8"));
  return sources[sourceName];
};

function getDownloadSpec() {
  const arch = getTargetArch();
  const platform = getTargetPlatform();
  const source = getNiv("cardano-wallet");
  source.jobs = [];

  if (arch === 'x64') {
    if (platform === 'linux') {
      source.jobs =  [{
        job: "cardano-wallet-linux64",
        buildProducts: [1]
      }, {
        job: "cardano-wallet-jormungandr-linux64",
        buildProducts: [1],
      }];
    } else if (platform === 'win32') {
      source.jobs =  [{
        job: "cardano-wallet-win64",
        buildProducts: [1, 3]
      }, {
        job: "cardano-wallet-jormungandr-win64",
        buildProducts: [1],
      }];
    } else if (platform === 'darwin') {
      source.jobs =  [{
        job: "cardano-wallet-macos64",
        buildProducts: [1]
      }, {
        job: "cardano-wallet-jormungandr-macos64",
        buildProducts: [1],
      }];
    }
  }

  if (source.jobs.length === 0) {
    console.warning(`cardano-wallet binaries for ${platform} ${arch} are not available.\nYou will need to install them yourself.`);
  }

  return source;
}

module.exports = {
  getDownloadSpec: getDownloadSpec,
  getTargetPlatform: getTargetPlatform,
  getTargetArch: getTargetArch,
  download: download,
}

if (require.main === module) {
  download(".", getDownloadSpec());
}
