export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; body?: Record<string, unknown> };

/** JSON in, JSON out, and a plain-English error on any failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiFetch<T = any>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "No connection. Check the internet and try again.", status: 0 };
  }
  const json = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!res.ok) {
    const error = typeof json?.error === "string" ? json.error : "Something went wrong.";
    return { ok: false, error, status: res.status, body: json };
  }
  return { ok: true, data: json as T };
}
