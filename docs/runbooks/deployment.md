# Deployment Runbook

## Pre-Deploy Checklist

- [ ] All CI checks pass (typecheck, token validation, build, smoke)
- [ ] Security scan passes
- [ ] Database migrations (if any) reviewed and tested
- [ ] Config/secret changes documented
- [ ] Rollback plan confirmed
- [ ] Stakeholders notified

## First-time cluster setup

Run once per cluster. The Secret is generated, never committed — `k8s/` contains
only `secret.example.yaml`, a reference for which keys are needed.

```bash
# 1. Namespace and non-secret config
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# 2. Generate the Secret with fresh 48-byte random values and apply it.
#    Prefer your cluster's secret manager (External Secrets, SOPS) in a real
#    deployment; this is the plain-kubectl path.
node scripts/gen-k8s-secret.mjs --apply

# 3. Redis (now a PVC, not emptyDir) and the app
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

Apply named files, never `kubectl apply -f k8s/` — the directory contains
`secret.example.yaml`, and a blanket apply would install placeholder secrets.

Verify the session store came up on Redis rather than silently degrading:

```bash
curl -s https://portal.lgu.gov.ph/api/health/readiness | jq .checks.sessions
# expect status "pass" and "message": "redis store — Redis reachable at ..."
# "degraded" means Redis is configured but unreachable; sessions are being kept
# in-process and will not survive a restart.
```

## Deployment Procedure

### Staging (develop branch)
```bash
# Auto-deployed on push to develop, but only once the deploy job is enabled:
#   gh variable set DEPLOY_STAGING_ENABLED true
#   base64 -w0 ~/.kube/staging.config | gh secret set KUBE_CONFIG_B64
#   gh variable set DEPLOY_STAGING_CONTEXT <context-name>
# Until then the job is skipped with a visible reason rather than reporting a
# green deploy that did nothing.
#
# Verify at https://staging.portal.lgu.gov.ph
```

### Production (main branch)

#### Pre-Deploy
```bash
# 1. Verify current production health
curl -f https://portal.lgu.gov.ph/api/health/readiness

# 2. Check current version
kubectl get deployment lgu-portal -n lgu-portal -o jsonpath='{.spec.template.spec.containers[0].image}'

# 3. Verify rollback target
kubectl rollout history deployment/lgu-portal -n lgu-portal
```

#### Deploy
```bash
# Option 1: GitHub Actions (preferred)
# Push to main triggers auto-deploy via GitHub Actions

# Option 2: Manual (emergency only)
kubectl set image deployment/lgu-portal \
  lgu-portal=ghcr.io/org/lgu-portal:<sha> \
  -n lgu-portal

# 2. Watch rollout
kubectl rollout status deployment/lgu-portal -n lgu-portal --timeout=5m
```

#### Post-Deploy
```bash
# 1. Verify readiness
curl -f https://portal.lgu.gov.ph/api/health/readiness

# 2. Smoke test critical paths
curl -f https://portal.lgu.gov.ph/login
curl -f https://portal.lgu.gov.ph/portal
curl -f https://portal.lgu.gov.ph/api/oidc/jwks

# 3. Check logs for errors
kubectl logs -n lgu-portal -l app.kubernetes.io/name=lgu-portal --tail=50 | grep -i error

# 4. Verify metrics
curl -s https://portal.lgu.gov.ph/api/metrics | grep -E "http_requests_total|auth_"
```

#### Rollback (if needed)
```bash
# Quick rollback
kubectl rollout undo deployment/lgu-portal -n lgu-portal

# Or specific revision
kubectl rollout undo deployment/lgu-portal -n lgu-portal --to-revision=3

# Verify
kubectl rollout status deployment/lgu-portal -n lgu-portal
curl -f https://portal.lgu.gov.ph/api/health/readiness
```

## Canary Deployment (Optional)

For riskier changes:
```yaml
# Add canary deployment
# Split traffic 90/10 using nginx ingress annotations
nginx.ingress.kubernetes.io/canary: "true"
nginx.ingress.kubernetes.io/canary-weight: "10"
```

Monitor for 30 min, then promote or rollback.

## Post-Deploy

- [ ] Update deployment log
- [ ] Notify stakeholders
- [ ] Monitor error rates for 1 hour
- [ ] Update deployment log with outcome
