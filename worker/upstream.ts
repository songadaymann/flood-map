export class UpstreamError extends Error {}

export async function fetchUpstream(
  url: string,
  timeoutMs = 14000,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json,image/png",
          "User-Agent":
            "FloodMap/1.0 (+https://github.com/songadaymann/flood-map)",
        },
      });
      if (response.ok) return response;
      console.warn({
        event: "upstream_http_error",
        host: new URL(url).hostname,
        status: response.status,
      });
      await response.body?.cancel();
      if (response.status < 500)
        throw new UpstreamError("The data service rejected the request.");
    } catch (error) {
      if (error instanceof UpstreamError || attempt === 1)
        throw new UpstreamError("The data service is temporarily unavailable.");
    }
  }
  throw new UpstreamError("The data service is temporarily unavailable.");
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!response.headers.get("content-type")?.includes("json")) {
    await response.body?.cancel();
    throw new UpstreamError(
      "The data service returned an unexpected response.",
    );
  }
  // Bound public-service responses before parsing, including NOAA forecasts.
  const reader = response.body?.getReader();
  if (!reader) throw new UpstreamError("The data service returned no data.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1_000_000) {
      await reader.cancel();
      throw new UpstreamError("The data response was too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new UpstreamError("The data service returned invalid data.");
  }
}
