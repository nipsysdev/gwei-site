import { assertEquals } from "jsr:@std/assert@1";
import { IPFS_GATEWAY_FALLBACKS } from "../constants.ts";

// The failover chain is tried in order after the configured dedicated gateway
// (contentGateways() in proxy.ts). Order is load-bearing: own node first, then
// the account/dedicated gateways of pinning operators. 4EVERLAND is
// deliberately absent — its gateway refuses HTML.
Deno.test("IPFS_GATEWAY_FALLBACKS: exact chain and order", () => {
  assertEquals(IPFS_GATEWAY_FALLBACKS, [
    "https://ipfs.xav.dev",
    "https://coffee-holy-snipe-120.mypinata.cloud",
    "https://charming-brown-primate.myfilebase.com",
  ]);
});
