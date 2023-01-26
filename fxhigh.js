// fxsnapshot.js

// Based on fxhash website-capture service:
// https://github.com/fxhash/gcloud-functions/tree/master/website-capture

const request = require("graphql-request").request;
const gql = require("graphql-request").gql;
const puppeteer = require("puppeteer");
const fs = require("fs").promises;

// CONSTANTS
const DELAY_MIN = 0;
const DELAY_MAX = 300000;

const sleep = (time) =>
  new Promise((resolve) => {
    setTimeout(resolve, time);
  });

const argv = require("yargs")
  .scriptName("fxhigh")
  .usage(
    "$0 [options] <gentk>",
    "Captures high res versions for a specific gentk.",
    (yargs) => {
      yargs.positional("count", {
        describe: "Number of images to capture",
        type: "number",
      });
    }
  )
  .default({
    width: 9999,
    height: 9999,
    timeout: 120,
  })
  .help()
  .version(false)
  .example([
    ["$0 40", "Capture gentk number 40"],
    // ['$0 --url="file://.../" 256', "Use custom url"],
  ]).argv;

const viewportSettings = {
  deviceScaleFactor: 1,
  width: argv.width,
  height: argv.height,
};

const saveFrame = async (page, filename) => {
  const base64 = await page.$eval("canvas", (el) => {
    return el.toDataURL();
  });
  const pureBase64 = base64.replace(/^data:image\/png;base64,/, "");
  const b = Buffer.from(pureBase64, "base64");
  await fs.writeFile(filename, b, (err) => {
    console.log(err ? err : filename);
  });
};

const waitPreview = (triggerMode, page, delay) =>
  new Promise(async (resolve) => {
    let resolved = false;
    if (triggerMode === "DELAY") {
      await sleep(delay);
      resolve();
    } else if (triggerMode === "FN_TRIGGER") {
      Promise.race([
        // add event listener and wait for event to fire before returning
        page.evaluate(function () {
          console.log("Race");
          return new Promise(function (resolve, reject) {
            window.addEventListener("fxhash-preview", function () {
              console.log("Event");
              resolve(); // resolves when the event fires
            });
          });
        }),
        sleep(DELAY_MAX),
      ]).then(resolve);
    }
  });

const getCollectionUrls = async (gentk) => {
  const query = gql`
    query ExampleQuery($generativeTokenId: Float) {
      generativeToken(id: $generativeTokenId) {
        generativeUri
        entireCollection {
          slug
          generationHash
        }
      }
    }
  `;
  const variables = {
    generativeTokenId: gentk,
  };

  const data = await request(
    "https://api.fxhash.xyz/graphql/",
    query,
    variables
  );
  const res = data.generativeToken;
  const genURL = res.generativeUri.replace(
    "ipfs://",
    "https://gateway.fxhash2.xyz/ipfs/"
  );
  let collection = [];
  const it = res.entireCollection;
  it.forEach((i) => {
    collection.push({
      f: i.slug + ".png",
      url: genURL + "/?fxhash=" + i.generationHash + "&preview=1",
    });
  });
  return collection;
};

const url =
  "https://gateway.fxhash2.xyz/ipfs/QmZGkGZEiyx6heYEYWfqZ747tTQN4jhnbgsNpFNcAXHGTg/?fxhash=ooWg8kV72RnDZ9avQuFLJpk19tKeQ5yGqGCTTMkvKEW4HuKnUhH&preview=1";

(async () => {
  let browser = await puppeteer.launch({
    ignoreHTTPSErrors: true,
    headless: false,
    args: ["--use-gl=swiftshader"],
  });

  if (!browser) {
    process.exit(1);
  }

  let page = await browser.newPage();
  await page.setViewport(viewportSettings);
  page.setDefaultNavigationTimeout(argv.timeout * 1000);

  if (!page) {
    process.exit(1);
  }

  page.on("error", (err) => {
    console.log("PAGER ERROR:", err);
  });

  //get list of urls
  const collection = await getCollectionUrls(argv.gentk);

  for (let i = 0; i < collection.length; i++) {
    const g = collection[i];
    console.log("📸 Capturing " + g.f);

    const url = g.url;
    // try to reach the page
    let response;
    try {
      response = await page.goto(url, {
        timeout: 300000,
      });
    } catch (err) {
      if (err && err.name && err.name === "TimeoutError") {
        throw "TIMEOUT";
      } else {
        throw null;
      }
    }

    if (response.status() !== 200) {
      throw "HTTP_ERROR";
    }

    await waitPreview("FN_TRIGGER", page, 300);
    // await waitPreview("DELAY", page, 300);
    await saveFrame(page, "./output/" + g.f);
  }
})();
