import { assertEquals } from "jsr:@std/assert@1";
import { IPFS_GATEWAY_FALLBACKS } from "../constants.ts";

// The failover chain is tried in order after the configured dedicated gateway
// (contentGateways() in proxy.ts). Order is load-bearing: own node first, then
// the dedicated gateway of the pinning operator. 4EVERLAND is
// deliberately absent — its gateway refuses HTML.
Deno.test("IPFS_GATEWAY_FALLBACKS: exact chain and order", () => {
  assertEquals(IPFS_GATEWAY_FALLBACKS, [
    "https://ipfs.xav.dev",
    "https://charming-brown-primate.myfilebase.com",
  ]);
});
