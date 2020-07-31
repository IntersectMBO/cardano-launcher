// This script downloads Windows builds of cardano-wallet from Hydra.
// It gets a build for the exact revision specified in nix/sources.json.

const axios = require('axios');
const _ = require('lodash');
const fs = require('fs');

function makeHydraApi(hydraURL) {
  const api = axios.create({
    baseURL: hydraURL,
    headers: { "Content-Type": "application/json" },
  });
  api.interceptors.request.use(request => {
    console.debug("Hydra " + request.url);
    return request;
  });
  return api;
}

function makeGitHubApi() {
  const api = axios.create({
    baseURL: "http://api.github.com/",
    headers: { "Content-Type": "application/json" },
  });
  api.interceptors.request.use(request => {
    console.debug(`${request.method} ${request.baseURL}${request.url}`);
    return request;
  });
  return api;
}

async function loadEval(api, project, jobset, job, rev) {
  const eval = await findEvalByCommit(api, project, jobset, rev);

  console.log(eval);

  return eval;
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

function findCardanoWalletEval(api, job, rev) {
  return loadEval(api, "Cardano", "cardano-wallet", job, rev);
}

async function findEvalFromGitHub(hydra, github, owner, repo, ref)  {
  const r = await github.get(`repos/${owner}/${repo}/commits/${ref}/statuses`);

  const status = _.find(r.data, { context: "ci/hydra-eval" });

  const eval = await hydra.get(status.target_url, { headers: { "Content-Type": "application/json" } });
  return eval.data;
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

async function downloadBuildProduct(hydraUrl, build, number) {
  const buildProduct = build.buildproducts[number];
  const filename = buildProduct.name;
  const writer = fs.createWriteStream(filename);
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

function getNiv(sourceName) {
  const sources = JSON.parse(fs.readFileSync("nix/sources.json", "utf8"));
  return sources[sourceName]
}

async function download(sourceName, downloads) {
  const hydraUrl = "https://hydra.iohk.io/";
  const hydraApi = makeHydraApi(hydraUrl);
  const github = makeGitHubApi();

  const source = getNiv(sourceName);

  const eval = await findEvalFromGitHub(hydraApi, github, source.owner, source.repo, source.rev);

  console.log(eval);

  const builds = await findBuildsInEval(hydraApi, eval, _.map(downloads, "job"));

  for (let i = 0; i < downloads.length; i++) {
    const build = builds[downloads[i].job];
    for (let j = 0; j < downloads[i].buildProducts.length; j++) {
      await downloadBuildProduct(hydraUrl, build, "" + downloads[i].buildProducts[j]);
    }
  }
}

download("cardano-wallet", [{
  job: "cardano-wallet-shelley-win64",
  buildProducts: [1, 3]
}, {
  job: "cardano-wallet-jormungandr-win64",
  buildProducts: [1],
}]);
