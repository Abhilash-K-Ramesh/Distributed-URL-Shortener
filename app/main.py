from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, HttpUrl
import psycopg2
import string
import redis
from dotenv import load_dotenv
import os
from fastapi import Request
import time
from fastapi.responses import JSONResponse


app = FastAPI()
load_dotenv()
redis_client = redis.Redis(host="localhost", port=6379, decode_responses=True)
RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
if current > tonumber(ARGV[2]) then
    return 0
end
return 1
"""

rate_limit_script = redis_client.register_script(RATE_LIMIT_LUA)
RATE_LIMIT_MAX = 5        # max requests
RATE_LIMIT_WINDOW = 10    # per 10 seconds

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host
    key = f"rate_limit:{client_ip}"

    allowed = rate_limit_script(keys=[key], args=[RATE_LIMIT_WINDOW, RATE_LIMIT_MAX])

    if allowed == 0:
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded. Try again later."})

    response = await call_next(request)
    return response

def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )

class ShortenRequest(BaseModel):
    long_url: HttpUrl

# Base62 alphabet for encoding IDs into short codes
ALPHABET = string.digits + string.ascii_lowercase + string.ascii_uppercase

def encode_base62(num: int) -> str:
    if num == 0:
        return ALPHABET[0]
    result = []
    base = len(ALPHABET)
    while num > 0:
        num, rem = divmod(num, base)
        result.append(ALPHABET[rem])
    return "".join(reversed(result))

@app.post("/shorten")
def shorten_url(req: ShortenRequest):
    conn = get_db()
    cur = conn.cursor()

    # Check if this long URL was already shortened
    cur.execute("SELECT short_code FROM urls WHERE long_url = %s", (str(req.long_url),))
    existing = cur.fetchone()
    if existing:
        cur.close()
        conn.close()
        return {"short_code": existing[0]}

    # Insert new row, get its auto-increment id, encode it
    cur.execute("INSERT INTO urls (long_url) VALUES (%s) RETURNING id", (str(req.long_url),))
    new_id = cur.fetchone()[0]
    short_code = encode_base62(new_id)

    cur.execute("UPDATE urls SET short_code = %s WHERE id = %s", (short_code, new_id))
    conn.commit()
    cur.close()
    conn.close()

    return {"short_code": short_code}

@app.get("/{short_code}")
def redirect_url(short_code: str):

    cached_url = redis_client.get(short_code)
    if cached_url:
        return RedirectResponse(url=cached_url)

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT long_url FROM urls WHERE short_code = %s", (short_code,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Short URL not found")
    
    long_url = row[0]

    # 3. Populate cache for next time (1 hour TTL)
    redis_client.set(short_code, long_url, ex=3600)
    
    return RedirectResponse(url=row[0])