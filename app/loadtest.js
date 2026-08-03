import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '20s', target: 50 },
    { duration: '10s', target: 0 },
  ],
};

export function setup() {
  const res = http.post(
    'http://192.168.49.2/shorten',
    JSON.stringify({ long_url: 'https://example.com' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const shortCode = res.json('short_code');
  return { shortCode };
}

export default function (data) {
  const res = http.get(`http://192.168.49.2/${data.shortCode}`, { redirects: 0 });
  check(res, { 'status is 307 or 429': (r) => r.status === 307 || r.status === 429 });
  sleep(1);
}