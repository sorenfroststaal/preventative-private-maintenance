/** Talks to PPM on the computer (same origin, local network). The device token is kept on the phone. */
const KEY = "ppm.token";

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the pairing lasts for this session only.
  }
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: Blob } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined || init.raw ? "POST" : "GET"),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Kan ikke nå computeren. Er den tændt, kører PPM, og er telefonen på samme wifi?");
  }
  const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Fejl ${res.status}`);
  return data as T;
}

/** An image from the archive as a blob URL (img tags cannot send the token). */
const blobCache = new Map<string, Promise<string>>();
export function imageUrl(docId: string): Promise<string> {
  if (!blobCache.has(docId)) {
    blobCache.set(
      docId,
      fetch(`/api/documents/${docId}/file`, { headers: { authorization: `Bearer ${getToken() ?? ""}` } }).then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return URL.createObjectURL(await r.blob());
      }),
    );
  }
  return blobCache.get(docId)!;
}
