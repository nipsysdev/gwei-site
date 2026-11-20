import { getConfig } from "./config.ts";
import { PIN_API, PINATA_FILES_API, PINATA_PIN_API, TIMEOUTS } from "./constants.ts";

const pinnedOn4Everland = new Set<string>();
const pinnedOnPinata = new Set<string>();

export async function pinCid(cid: string, name?: string): Promise<void> {
  await pinOn4Everland(cid, name);
  await pinOnPinata(cid, name);
}

async function pinOn4Everland(cid: string, name?: string): Promise<void> {
  const token = getConfig().pinToken;
  if (!token) return;
  await pinWithOperator(
    "4EVERLAND",
    PIN_API,
    cid,
    name,
    token,
    pinnedOn4Everland,
    existsOn4Everland,
  );
}

async function pinOnPinata(cid: string, name?: string): Promise<void> {
  const token = getConfig().pinataJwt;
  if (!token) return;
  await pinWithOperator("Pinata", PINATA_PIN_API, cid, name, token, pinnedOnPinata, existsOnPinata);
}

async function pinWithOperator(
  operatorName: string,
  pinUrl: string,
  cid: string,
  name: string | undefined,
  token: string,
  pinned: Set<string>,
  existsOnOperator: (cid: string, token: string) => Promise<boolean | null>,
): Promise<void> {
  try {
    if (pinned.has(cid)) return;
    pinned.add(cid);
    const label = name ? `${name} (${cid})` : cid;

    const exists = await existsOnOperator(cid, token);
    if (exists) {
      console.info(`[pin] ${label} already pinned on ${operatorName}, skipping`);
      return;
    }
    if (exists === null) {
      pinned.delete(cid);
      console.warn(
        `[pin] ${label} existence check failed on ${operatorName}; not pinning to avoid a duplicate`,
      );
      return;
    }

    console.info(`[pin] pinning ${label} on ${operatorName}`);
    const res = await fetch(pinUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ cid, ...(name && { name }) }),
      signal: AbortSignal.timeout(TIMEOUTS.PIN_API),
    });
    if (res.ok) {
      console.info(`[pin] ${label} → pinned on ${operatorName} (${res.status})`);
    } else {
      console.error(
        `[pin] ${label} → pin on ${operatorName} failed (${res.status} ${res.statusText})`,
      );
    }
  } catch (e) {
    console.error(
      `[pin] ${cid} pin on ${operatorName} failed:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

async function existsOn4Everland(cid: string, token: string): Promise<boolean | null> {
  try {
    const url = `${PIN_API}?cid=${encodeURIComponent(cid)}&status=queued,pinning,pinned&limit=1`;
    const r = await fetch(url, {
      headers: { "authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUTS.PIN_API),
    });
    if (!r.ok) return null;
    const jsonResp = await r.json() as { count: number; results: [] };
    return jsonResp.count > 0;
  } catch (e) {
    console.error(
      `[pin] ${cid}: 4EVERLAND existence check failed:`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

async function existsOnPinata(cid: string, token: string): Promise<boolean | null> {
  try {
    const url = `${PINATA_FILES_API}?cid=${encodeURIComponent(cid)}&limit=1`;
    const r = await fetch(url, {
      headers: { "authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUTS.PIN_API),
    });
    if (!r.ok) return null;
    const jsonResp = await r.json() as { data?: { files?: { cid: string }[] } };
    return (jsonResp.data?.files ?? []).length > 0;
  } catch (e) {
    console.error(
      `[pin] ${cid}: Pinata existence check failed:`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}
