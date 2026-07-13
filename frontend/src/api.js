const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export class RateLimitError extends Error {}
export class NotFoundError extends Error {}

export async function shortenUrl(longUrl) {
  const res = await fetch(`${API_BASE}/shorten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ long_url: longUrl }),
  });

  if (res.status === 429) {
    throw new RateLimitError("Rate limit exceeded. Try again shortly.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json(); // { short_code }
}

export async function resolveShortCode(shortCode) {
  const start = performance.now();
  const res = await fetch(`${API_BASE}/${shortCode}`, {
    method: "GET",
    redirect: "manual", // don't actually follow — we just want to time + inspect the response
  });
  const elapsedMs = performance.now() - start;

  if (res.status === 429) {
    throw new RateLimitError("Rate limit exceeded. Try again shortly.");
  }
  if (res.status === 404) {
    throw new NotFoundError("Short code not found.");
  }
  return { status: res.status, elapsedMs };
}

export function shortUrlFor(shortCode) {
  return `${API_BASE}/${shortCode}`;
}
