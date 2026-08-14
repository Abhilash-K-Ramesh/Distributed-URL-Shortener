# Distributed URL Shortener

A URL shortener built with FastAPI, PostgreSQL, and Redis — originally containerized with Docker Compose, later migrated to Kubernetes with a full CI/CD pipeline and horizontal autoscaling.

## Architecture

### Docker Compose (original)
```
┌────────┐     ┌──────────────┐     ┌─────────────┐
│ Nginx  │────▶│ FastAPI app  │────▶│ PostgreSQL  │
│ (proxy)│     │ (1+ replicas)│     │ (single)    │
└────────┘     └──────┬───────┘     └─────────────┘
                       │
                       ▼
                ┌─────────────┐
                │    Redis    │
                │ (rate limit)│
                └─────────────┘
```
Services orchestrated via `docker-compose.yml`, brought up manually with `docker-compose up --build --scale app=3`.

### Kubernetes (current)
```
┌──────────┐     ┌────────────────────┐     ┌──────────────┐
│  Ingress │────▶│  Deployment: app    │────▶│  Deployment:  │
│ (nginx)  │     │  (2-6 replicas,     │     │  postgres     │
└──────────┘     │   HPA-managed)      │     │  + PVC        │
                  └──────────┬──────────┘     └──────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │  Deployment: redis   │
                  │  (rate limiting)     │
                  └─────────────────────┘
```

| | Docker Compose | Kubernetes |
|---|---|---|
| Reverse proxy | Nginx | Ingress (nginx controller) |
| Scaling | Manual (`--scale app=3`) | HorizontalPodAutoscaler (2-6 replicas, CPU-based) |
| Deployment | Manual `docker-compose up` | Automated CI/CD (GitHub Actions) |
| Config | `.env` files | ConfigMaps + Secrets |
| Postgres data | Named volume | PersistentVolumeClaim |
| Image builds | Manual `docker build` | Automated, tagged by commit SHA, pushed to GHCR |

## CI/CD Pipeline

```
push to main
     │
     ▼
┌─────────┐     ┌────────────────┐     ┌──────────────────┐
│  test   │────▶│ build-and-push │────▶│      deploy       │
│ (pytest)│     │ (build image,  │     │ (kubectl set image │
│         │     │  push to GHCR) │     │  on self-hosted    │
│         │     │                │     │  runner → Minikube)│
└─────────┘     └────────────────┘     └──────────────────┘
```

- **test**: installs dependencies, runs `pytest` on a clean GitHub-hosted runner. `build-and-push` only runs if this passes (`needs: test`), so a broken commit never produces a deployable image.
- **build-and-push**: builds a multi-stage, non-root Docker image, tags it with the commit SHA (not `latest`, for traceability), pushes to GitHub Container Registry.
- **deploy**: runs on a self-hosted runner (registered on the same environment as the Minikube cluster, since GitHub's cloud runners can't reach a local/private cluster). Runs `kubectl set image` to trigger a rolling update, then `kubectl rollout status` to confirm success before the workflow completes.

## Kubernetes Setup

- **App**: `Deployment` (2-6 replicas via HPA), `Service`, readiness/liveness probes against `/health`
- **Postgres**: `Deployment` + `PersistentVolumeClaim`, schema auto-created on first boot via an init script mounted through a `ConfigMap` (replaces a manual `docker-compose exec ... CREATE TABLE` step from the original setup)
- **Redis**: `Deployment` + `Service`, backs the app's distributed rate limiter
- **Config**: non-sensitive values in a `ConfigMap`, `DB_PASSWORD` in a `Secret`
- **Ingress**: routes external traffic to the app service, replacing the original Nginx reverse proxy config
- **HorizontalPodAutoscaler**: targets 50% average CPU utilization, scales the app Deployment between 2 and 6 replicas

## Autoscaling — Verified Under Load

Load-tested with [k6](https://k6.io) against the live redirect endpoint (`GET /{short_code}`) at up to 300 concurrent virtual users. Observed CPU utilization cross the 50% HPA threshold and the deployment scale up in real time:

```
NAME      REFERENCE        TARGETS       MINPODS   MAXPODS   REPLICAS   AGE
app-hpa   Deployment/app   cpu: 2%/50%   2         6         2          18h
app-hpa   Deployment/app   cpu: 36%/50%  2         6         2          18h
app-hpa   Deployment/app   cpu: 59%/50%  2         6         3          18h
```

Replicas scaled from 2 → 3 as CPU crossed the target threshold, then returned to baseline after load subsided (HPA's default 5-minute scale-down cooldown prevents flapping on brief spikes).

The same load test also confirmed the Redis-backed rate limiter (implemented with an atomic Lua script to avoid race conditions between replicas) enforces limits correctly across multiple pods — a global ceiling per client, not an independent per-pod counter that would double the effective limit under horizontal scaling.

## Local Development

```bash
docker-compose up --build --scale app=3
```

## Running on Kubernetes (Minikube)

```bash
minikube start --driver=docker
minikube addons enable ingress
minikube addons enable metrics-server

kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/postgres-init-configmap.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
```

## What I'd Do Differently in Production

- **Postgres**: currently a single-replica `Deployment` + PVC, which is simple but not how you'd run Postgres at scale or with real failover. A production setup would use a `StatefulSet` with proper replication, or more realistically a managed service (RDS, Cloud SQL) instead of self-hosting the database at all.
- **CD trigger**: deployment runs via a self-hosted GitHub Actions runner because this cluster is local and has no public network access for GitHub's cloud runners to reach. In production, I'd either run on a cloud-managed cluster (EKS/GKE) directly reachable from GitHub, or adopt a GitOps approach (ArgoCD/Flux) that pulls changes into the cluster rather than pushing `kubectl` commands from CI.
- **Health checks**: `/health` currently passes through the same Redis-dependent rate-limiting middleware as every other route. This means the endpoint isn't fully isolated from downstream infrastructure — if Redis is unreachable, health checks fail even though the API server itself is fine. The correct fix is excluding `/health` from rate-limiting entirely so orchestrators can distinguish "app is broken" from "a dependency is down."
- **Image registry**: GHCR package visibility is set to public for simplicity, since the image contains no real secrets. A production setup would keep it private and use `imagePullSecrets`.
- **HPA tuning**: the 50% CPU target was validated with synthetic k6 load, not real production traffic patterns. Actual thresholds and min/max replica counts should be tuned against observed traffic before relying on this in production.

## Known Limitations

- Single-node Minikube cluster — no multi-node failover story
- Rate-limiter correctness under horizontal scaling was verified, but k6's virtual users share one client IP, which limits how realistically per-client rate limiting could be exercised in this test