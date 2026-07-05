import time

class TokenBucket:
    def __init__(self, max_tokens: int, refill_rate: float):
        self.max_tokens = max_tokens
        self.tokens = max_tokens
        self.refill_rate = refill_rate  # tokens per second
        self.last_refill = time.time()

    def allow_request(self) -> bool:
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.max_tokens, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
bucket = TokenBucket(max_tokens=5, refill_rate=0.5)  # 5 tokens, refills 1 every 2 sec
for i in range(8):
    print(f"Request {i+1}: {'allowed' if bucket.allow_request() else 'rejected'}")