import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 10 },   // ramp up to 10 users
    { duration: '20s', target: 50 },   // ramp up to 50 users
    { duration: '10s', target: 0 },    // ramp down
  ],
};

export default function () {
  // Mostly reads (redirects) — realistic traffic pattern
  const res = http.get('http://localhost:8000/9', { redirects: 0 });
  check(res, { 'status is 307 or 429': (r) => r.status === 307 || r.status === 429 });
  sleep(1);
}