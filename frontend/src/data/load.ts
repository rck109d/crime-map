import { decodePoints, isGzip } from "./format";
import type { Manifest, MonthDetail, PointColumns } from "./types";

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

async function gunzip(bytes: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function get(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(DATA_URL + path, init);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return response;
}

export async function loadManifest(): Promise<Manifest> {
  // Always revalidate: the manifest names the build that the other files belong to.
  return (await get("manifest.json", { cache: "no-cache" })).json();
}

export async function loadYear(manifest: Manifest, year: number): Promise<PointColumns> {
  const response = await get(`points-${year}.bin?v=${manifest.build}`);
  let buffer = await response.arrayBuffer();
  if (isGzip(new Uint8Array(buffer))) buffer = await gunzip(new Uint8Array(buffer));
  return decodePoints(buffer);
}

const details = new Map<string, Promise<MonthDetail>>();

export function loadDetail(manifest: Manifest, month: string): Promise<MonthDetail> {
  let pending = details.get(month);
  if (!pending) {
    pending = get(`detail/${month}.json?v=${manifest.build}`).then((r) => r.json());
    pending.catch(() => details.delete(month));
    details.set(month, pending);
  }
  return pending;
}
