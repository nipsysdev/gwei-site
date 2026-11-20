// Unit tests for proactive IPFS pinning (src/pinner.ts).
//
// pinCid is async — tests await it directly. The stubbed fetch tracks GET/POST
// call counts, which is all the assertion needs. No test-only exports.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { stub } from "jsr:@std/testing@1/mock";
import { ConfigBuilder, resetConfig, setConfig } from "../config.ts";
import { pinCid } from "../pinner.ts";

function listResponse(count: number, status = 200): Response {
  const results = count > 0
    ? [{
      requestid: "req-1",
      status: "pinned",
      created: "2026-01-01T00:00:00Z",
      pin: { cid: "x" },
      delegates: [],
    }]
    : [];
  return new Response(JSON.stringify({ count, results }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pinResponse(status = 202): Response {
  return new Response(JSON.stringify({ requestid: "req-new", status: "queued" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pinFetchStub(opts: {
  listCount?: number;
  listStatus?: number;
  listThrow?: boolean;
  pinStatus?: number;
} = {}): { gets: () => number; posts: () => number; [Symbol.dispose]: () => void } {
  let gets = 0;
  let posts = 0;
  const s = stub(globalThis, "fetch", (_input: URL | Request | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      gets++;
      if (opts.listThrow) return Promise.reject(new Error("network down"));
      return Promise.resolve(listResponse(opts.listCount ?? 0, opts.listStatus ?? 200));
    }
    posts++;
    return Promise.resolve(pinResponse(opts.pinStatus ?? 202));
  });
  return { gets: () => gets, posts: () => posts, [Symbol.dispose]: () => s.restore() };
}

Deno.test("pinCid: no-op when no pin token is configured", async () => {
  resetConfig();
  using _f = pinFetchStub();
  await pinCid("cid-noop");
  assertEquals(_f.gets(), 0);
  assertEquals(_f.posts(), 0);
});

Deno.test("pinCid: L1 dedup — fire-and-forget calls coalesce into one pin", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listCount: 0 });
  try {
    const p1 = pinCid("cid-dedup");
    pinCid("cid-dedup"); // L1 no-op (synchronous reserve)
    pinCid("cid-dedup"); // L1 no-op
    await p1;
    assertEquals(_f.gets(), 1);
    assertEquals(_f.posts(), 1);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: different CIDs each trigger a check and a pin", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listCount: 0 });
  try {
    await Promise.all([pinCid("cid-a"), pinCid("cid-b"), pinCid("cid-c")]);
    assertEquals(_f.gets(), 3);
    assertEquals(_f.posts(), 3);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: L2 skips POST when CID already pinned on 4EVERLAND", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listCount: 1 });
  try {
    await pinCid("cid-exists");
    assertEquals(_f.gets(), 1);
    assertEquals(_f.posts(), 0);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: L2 pins when the CID is absent", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listCount: 0 });
  try {
    await pinCid("cid-absent");
    assertEquals(_f.gets(), 1);
    assertEquals(_f.posts(), 1);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: indeterminate existence check removes CID from L1 (allows retry)", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listThrow: true });
  try {
    await pinCid("cid-netfail");
    assertEquals(_f.gets(), 1);
    assertEquals(_f.posts(), 0);
    // CID was removed from pinned → second call should also GET (not L1-skipped).
    await pinCid("cid-netfail");
    assertEquals(_f.gets(), 2);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: skips POST when the existence check returns non-2xx", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  using _f = pinFetchStub({ listStatus: 500 });
  try {
    await pinCid("cid-500");
    assertEquals(_f.gets(), 1);
    assertEquals(_f.posts(), 0);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: passes the CID (not the name) as the dedup filter", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").build());
  let getUrl = "";
  let postCount = 0;
  using _ = stub(globalThis, "fetch", (input: URL | Request | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (method === "GET") {
      getUrl = url;
      return Promise.resolve(listResponse(0));
    }
    postCount++;
    return Promise.resolve(pinResponse());
  });
  try {
    await pinCid("bafycid", "xav.gwei");
    assert(getUrl.includes("cid=bafycid"), `expected cid= filter in ${getUrl}`);
    assert(!getUrl.includes("name="), `unexpected name= filter in ${getUrl}`);
    assertEquals(postCount, 1);
  } finally {
    resetConfig();
  }
});

function pinataListResponse(count: number, status = 200): Response {
  const files = count > 0 ? [{ id: "file-1", name: "x", cid: "x" }] : [];
  return new Response(JSON.stringify({ data: { files } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pinataPinResponse(status = 200): Response {
  return new Response(JSON.stringify({ data: { id: "file-new", cid: "x", status: "queued" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("pinCid: no fetch when neither pin token is configured", async () => {
  resetConfig();
  using _f = pinFetchStub();
  await pinCid("cid-no-tokens");
  assertEquals(_f.gets(), 0);
  assertEquals(_f.posts(), 0);
});

Deno.test("pinCid: pins to Pinata when PINATA_JWT is set and the CID is absent", async () => {
  setConfig(new ConfigBuilder().pinataJwt("test-jwt").build());
  let getUrl = "";
  let postBody = "";
  let postCount = 0;
  using _ = stub(globalThis, "fetch", (input: URL | Request | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (method === "GET") {
      getUrl = url;
      return Promise.resolve(pinataListResponse(0));
    }
    postCount++;
    postBody = typeof init?.body === "string" ? init.body : "";
    return Promise.resolve(pinataPinResponse());
  });
  try {
    await pinCid("bafypinata", "xav.gwei");
    assert(getUrl.includes("cid=bafypinata"), `expected cid= filter in ${getUrl}`);
    assert(getUrl.includes("limit=1"), `expected limit=1 in ${getUrl}`);
    assert(postBody.includes("bafypinata"), `expected cid in POST body ${postBody}`);
    assertEquals(postCount, 1);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: skips the Pinata POST when the CID is already pinned there", async () => {
  setConfig(new ConfigBuilder().pinataJwt("test-jwt").build());
  let gets = 0;
  let posts = 0;
  using _ = stub(globalThis, "fetch", (_input: URL | Request | string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") gets++;
    else posts++;
    return Promise.resolve(pinataListResponse(1));
  });
  try {
    await pinCid("cid-pinata-exists");
    assertEquals(gets, 1);
    assertEquals(posts, 0);
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: pins to both operators when both tokens are configured", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").pinataJwt("test-jwt").build());
  const counts = { fourEverGets: 0, fourEverPosts: 0, pinataGets: 0, pinataPosts: 0 };
  using _ = stub(globalThis, "fetch", (input: URL | Request | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pinata = url.includes("pinata.cloud");
    if (pinata) {
      if (method === "GET") counts.pinataGets++;
      else counts.pinataPosts++;
      return Promise.resolve(pinataListResponse(0));
    }
    if (method === "GET") counts.fourEverGets++;
    else counts.fourEverPosts++;
    return Promise.resolve(listResponse(0));
  });
  try {
    await pinCid("cid-both", "xav.gwei");
    assertEquals(counts, { fourEverGets: 1, fourEverPosts: 1, pinataGets: 1, pinataPosts: 1 });
  } finally {
    resetConfig();
  }
});

Deno.test("pinCid: a failing 4EVERLAND existence check does not block the Pinata pin", async () => {
  setConfig(new ConfigBuilder().pinToken("test-token").pinataJwt("test-jwt").build());
  let pinataPosts = 0;
  using _ = stub(globalThis, "fetch", (input: URL | Request | string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("pinata.cloud")) {
      if (method === "GET") return Promise.resolve(pinataListResponse(0));
      pinataPosts++;
      return Promise.resolve(pinataPinResponse());
    }
    return Promise.reject(new Error("network down"));
  });
  try {
    await pinCid("cid-independent");
    assertEquals(pinataPosts, 1);
  } finally {
    resetConfig();
  }
});
