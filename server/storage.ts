// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import fs from "node:fs";
import path from "node:path";
import { ENV } from "./_core/env";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (forgeUrl && forgeKey) {
    // 1. Get presigned PUT URL from Forge
    const presignUrl = new URL(
      "v1/storage/presign/put",
      forgeUrl.replace(/\/+$/, "") + "/"
    );
    presignUrl.searchParams.set("path", key);

    const presignResp = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!presignResp.ok) {
      const msg = await presignResp.text().catch(() => presignResp.statusText);
      throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
    }

    const { url: s3Url } = (await presignResp.json()) as { url: string };
    if (!s3Url) throw new Error("Forge returned empty presign URL");

    // 2. PUT file directly to S3
    const blob =
      typeof data === "string"
        ? new Blob([data], { type: contentType })
        : new Blob([data as any], { type: contentType });

    const uploadResp = await fetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });

    if (!uploadResp.ok) {
      throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
    }

    return { key, url: `/manus-storage/${key}` };
  } else {
    // Local filesystem storage fallback
    // Keep local uploads outside dist so a production build cannot delete media
    // that an open guest/cloud session still references.
    const uploadsDir = path.resolve(process.cwd(), ".reelio", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const cleanFileName = path.basename(key);
    const filePath = path.join(uploadsDir, cleanFileName);
    const buffer = Buffer.isBuffer(data)
      ? data
      : typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data);
    await fs.promises.writeFile(filePath, buffer);
    return { key, url: `/uploads/${cleanFileName}` };
  }
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  const key = normalizeKey(relKey);

  if (!forgeUrl || !forgeKey) {
    return `/uploads/${path.basename(key)}`;
  }

  const getUrl = new URL(
    "v1/storage/presign/get",
    forgeUrl.replace(/\/+$/, "") + "/"
  );
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}

/** Materialize one owned storage object for a bounded server-side operation. */
export async function storageReadToFile(
  relKey: string,
  destination: string,
  options: { maxBytes: number; signal?: AbortSignal }
): Promise<number> {
  const key = normalizeKey(relKey);
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    const source = path.join(
      path.resolve(process.cwd(), ".reelio", "uploads"),
      path.basename(key)
    );
    const stats = await fs.promises.stat(source);
    if (!stats.isFile() || stats.size > options.maxBytes) {
      throw new Error("Source media exceeds the render size limit.");
    }
    if (options.signal?.aborted) throw new Error("Render cancelled.");
    await fs.promises.copyFile(source, destination);
    return stats.size;
  }

  const signedUrl = await storageGetSignedUrl(key);
  const response = await fetch(signedUrl, { signal: options.signal });
  if (!response.ok)
    throw new Error(`Storage read failed with HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > options.maxBytes) {
    throw new Error("Source media exceeds the render size limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > options.maxBytes) {
    throw new Error("Source media exceeds the render size limit.");
  }
  await fs.promises.writeFile(destination, bytes);
  return bytes.length;
}

/**
 * Delete a locally stored object. The configured Forge API currently exposes
 * only presigned reads/writes, so cloud deletion must be handled by that
 * provider's retention policy and is reported as not completed here.
 */
export async function storageDelete(relKey: string): Promise<boolean> {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) return false;

  const filePath = path.join(
    path.resolve(process.cwd(), ".reelio", "uploads"),
    path.basename(normalizeKey(relKey))
  );
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}
