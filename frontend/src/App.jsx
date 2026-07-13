import { useState, useRef } from "react";
import "./App.css";
import { shortenUrl, resolveShortCode, shortUrlFor, RateLimitError, NotFoundError } from "./api";

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

export default function App() {
  const [inputValue, setInputValue] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | compressing | error
  const [errorMsg, setErrorMsg] = useState("");
  const [entries, setEntries] = useState([]); // { id, longUrl, shortCode, createdAt, visits: [] }
  const compressingUrlRef = useRef("");

  async function handleSubmit(e) {
    e.preventDefault();
    const longUrl = inputValue.trim();

    if (!longUrl) return;
    if (!isValidUrl(longUrl)) {
      setPhase("error");
      setErrorMsg("Enter a full URL, including http:// or https://");
      return;
    }

    setErrorMsg("");
    compressingUrlRef.current = longUrl;
    setPhase("compressing");

    try {
      const { short_code } = await shortenUrl(longUrl);
      // hold the compression animation just long enough to read, then commit
      setTimeout(() => {
        setEntries((prev) => [
          {
            id: `${short_code}-${Date.now()}`,
            longUrl,
            shortCode: short_code,
            createdAt: Date.now(),
            checks: [],
          },
          ...prev,
        ]);
        setInputValue("");
        setPhase("idle");
      }, 520);
    } catch (err) {
      setPhase("error");
      setErrorMsg(
        err instanceof RateLimitError
          ? "Rate limit hit on /shorten (5 per 10s). Wait a moment and try again."
          : err.message || "Something went wrong."
      );
    }
  }

  async function handleTest(entryId, shortCode) {
    try {
      const { status, elapsedMs } = await resolveShortCode(shortCode);
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                checks: [{ status, elapsedMs, at: Date.now() }, ...entry.checks].slice(0, 5),
              }
            : entry
        )
      );
    } catch (err) {
      const status = err instanceof RateLimitError ? 429 : err instanceof NotFoundError ? 404 : 0;
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId
            ? { ...entry, checks: [{ status, elapsedMs: null, at: Date.now() }, ...entry.checks].slice(0, 5) }
            : entry
        )
      );
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">⤳</span>
          <span className="brand-name">shrtn</span>
        </div>
        <div className="topbar-meta">
          <span className="dot" aria-hidden="true" />
          <span>3 instances · nginx · redis · postgres</span>
        </div>
      </header>

      <main className="hero">
        <p className="eyebrow">distributed url shortener</p>
        <h1>
          Paste a long link.<br />Watch it compress.
        </h1>

        <form className="shorten-form" onSubmit={handleSubmit}>
          <div className={`compress-field phase-${phase}`}>
            {phase === "compressing" ? (
              <div className="compress-anim" role="status" aria-live="polite">
                <span className="compress-text">{compressingUrlRef.current}</span>
              </div>
            ) : (
              <input
                type="text"
                inputMode="url"
                placeholder="https://example.com/a/very/long/path?that=needs&shortening=true"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                aria-label="Long URL to shorten"
                autoFocus
              />
            )}
            <button type="submit" disabled={phase === "compressing"}>
              {phase === "compressing" ? "compressing…" : "compress →"}
            </button>
          </div>
          {phase === "error" && <p className="field-error">{errorMsg}</p>}
        </form>
      </main>

      <section className="log-section" aria-label="Shortened link history">
        <div className="log-header">
          <span>log</span>
          <span className="log-count">{entries.length} link{entries.length === 1 ? "" : "s"} this session</span>
        </div>

        {entries.length === 0 ? (
          <div className="log-empty">
            Nothing shortened yet — compress a link above and it'll show up here.
          </div>
        ) : (
          <ul className="log-list">
            {entries.map((entry) => (
              <li key={entry.id} className="log-row">
                <div className="log-main">
                  <a
                    className="log-short"
                    href={shortUrlFor(entry.shortCode)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    /{entry.shortCode}
                  </a>
                  <span className="log-arrow" aria-hidden="true">←</span>
                  <span className="log-long" title={entry.longUrl}>
                    {entry.longUrl}
                  </span>
                </div>
                <div className="log-actions">
                  <span className="log-time">{timeAgo(entry.createdAt)}</span>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => copyToClipboard(shortUrlFor(entry.shortCode))}
                  >
                    copy
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => handleTest(entry.id, entry.shortCode)}
                  >
                    test
                  </button>
                  {entry.checks[0] && (
                    <span className={`status-badge status-${entry.checks[0].status}`}>
                      {entry.checks[0].status === 307 && "307"}
                      {entry.checks[0].status === 429 && "429 limited"}
                      {entry.checks[0].status === 404 && "404"}
                      {entry.checks[0].status === 0 && "error"}
                      {entry.checks[0].elapsedMs != null && ` · ${entry.checks[0].elapsedMs.toFixed(1)}ms`}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="page-footer">
        <span>FastAPI · Redis (cache + rate limits) · PostgreSQL · Nginx</span>
        <a href="https://github.com" target="_blank" rel="noreferrer">source →</a>
      </footer>
    </div>
  );
}
