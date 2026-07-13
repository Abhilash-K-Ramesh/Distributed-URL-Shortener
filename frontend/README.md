# shrtn — frontend

A React UI for the [Distributed URL Shortener](../README.md) backend — paste a long URL, watch it compress into a short code, and test/copy links from a live log.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Point it at your backend**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if your API isn't on `http://localhost:8000` (e.g. if Nginx is exposed on a different port).

3. **Run the dev server**
   ```bash
   npm run dev
   ```
   Opens on `http://localhost:5173` by default. In Codespaces, use the forwarded URL from the Ports tab, same as the backend.

## Important: enable CORS on the backend

Since the frontend (port 5173 in dev, or its own container in prod) runs on a different origin than the API (port 8000), FastAPI will block requests unless CORS is enabled. Add this to `app/main.py`, near the top after `app = FastAPI()`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # fine for local dev; restrict to your actual frontend origin in production
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Without this, `/shorten` and `/{short_code}` requests from the browser will fail with a CORS error in the console, even though `curl` works fine (curl doesn't enforce CORS — only browsers do).

## Build for production

```bash
npm run build
```
Outputs static files to `dist/`.

## Running via Docker Compose (optional)

A `Dockerfile` and `nginx.frontend.conf` are included so this can run as its own container alongside the rest of the stack. Add to your root `docker-compose.yml`:

```yaml
  frontend:
    build: ./frontend
    ports:
      - "3000:80"
```

Then visit `http://localhost:3000`. Make sure `VITE_API_BASE_URL` (baked in at build time) points to wherever your backend is actually reachable from the browser — typically the Nginx port (`8000`), not an internal Docker service name (browsers can't resolve those).

## What it does

- **Compress:** submits a URL to `POST /shorten`, with a short animated transition while the request is in flight.
- **Log:** every link shortened this session is listed with its short code, original URL, and how long ago it was created. (Session-only — refreshing the page clears it; the backend is still the source of truth.)
- **Copy:** copies the full short URL to your clipboard.
- **Test:** fires a real request at `GET /{short_code}` and shows the status code and response time — useful for demonstrating caching (fast repeated hits) and rate limiting (429s after repeated testing) live.
