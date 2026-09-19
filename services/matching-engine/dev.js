"use strict";

/**
 * LOCAL DEVELOPMENT RUNNER -- not part of the TEE image (see .dockerignore).
 *
 * Runs index.js on a laptop, where there is no dstack guest agent and no TDX
 * hardware, by standing in for `DstackClient.getKey()` with a key taken from
 * DEV_ENGINE_SECRET (a Stellar secret, "S..."). Everything else -- matching,
 * order-signature checks, settle / settle_external against the real testnet
 * contracts -- is the real code path.
 *
 * What this is NOT: attested. The engine key here is an ordinary key you hold,
 * which is precisely what the TEE deployment exists to avoid. Use it to develop
 * and demo the flow against testnet contracts registered with a test-vector
 * quote, never to claim TEE guarantees.
 *
 *   DEV_ENGINE_SECRET=S... ADMIN_KEY=... PORT=8787 node dev.js
 */

const Module = require("module");
const { Keypair } = require("@stellar/stellar-sdk");

if (!process.env.DEV_ENGINE_SECRET) {
  console.error("dev.js: set DEV_ENGINE_SECRET to a Stellar secret key (S...)");
  process.exit(1);
}
const seed = Keypair.fromSecret(process.env.DEV_ENGINE_SECRET).rawSecretKey();

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@phala/dstack-sdk") {
    return {
      DstackClient: class {
        async getKey() {
          return { key: Uint8Array.from(seed) };
        }
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

require("./index.js");
