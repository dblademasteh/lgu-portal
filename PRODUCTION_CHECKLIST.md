# Production Readiness Checklist

## Infrastructure

### Kubernetes
- [ ] Cluster v1.28+ with managed control plane
- [ ] Node pools: general (app), memory-optimized (redis)
- [ ] Network policies configured (deny-all default, explicit allow)
- [ ] Pod Security Standards: restricted profile
- [ ] Resource quotas and limit ranges per namespace
- [ ] PodDisruptionBudgets for app and redis
- [ ] PriorityClasses for critical workloads
- [ ] Cluster autoscaler configured

### Networking
- [ ] Ingress controller (nginx) with TLS termination
- [ ] TLS 1.2+ only, strong ciphers
- [ ] cert-manager with Let's Encrypt (or internal CA)
- [ ] Network policies: app→redis, ingress→app, deny all else
- [ ] External DNS for automatic DNS records
- [ ] WAF rules for OWASP Top 10

### Storage
- [ ] Redis: PVC with backup schedule (daily snapshot)
- [ ] Backup retention: 30 days daily, 12 months monthly
- [ ] Tested restore procedure

### Secrets Management
- [ ] External Secrets Operator or SealedSecrets
- [ ] SESSION_SECRET: 48+ char base64url, rotated annually
- [ ] OIDC_SIGNING_SECRET: separate from session secret
- [ ] Database passwords (if applicable)
- [ ] TLS certificates in cert-manager
- [ ] No secrets in ConfigMaps or Docker images

## Application

### Security
- [ ] CSP header strict (no unsafe-inline in production)
- [ ] HSTS with preload
- [ ] Secure cookies (Secure, HttpOnly, SameSite=Lax)
- [ ] Rate limiting: login 5/min, API 30/min, global 100/s
- [ ] Rate limits backed by Redis (not in-memory)
- [ ] Audit logging to SIEM (structured JSON)
- [ ] No hardcoded secrets in code
- [ ] Dependency scanning in CI (trivy, npm audit)
- [ ] SBOM generated in build

### Observability
- [ ] Structured logging (pino, JSON, correlation IDs)
- [ ] Prometheus metrics: `/api/metrics`
- [ ] Health endpoints: `/api/health/liveness`, `/api/health/readiness`
- [ ] Distributed tracing (OpenTelemetry, Jaeger/Tempo)
- [ ] Alerting rules:
  - Pod crashlooping
  - Readiness failing
  - Error rate > 1%
  - Latency p99 > 2s
  - Redis memory > 80%
  - Rate limit blocked > 100/min

### Reliability
- [ ] Rolling updates with maxSurge=1, maxUnavailable=0
- [ ] PodDisruptionBudget: minAvailable 1
- [ ] Graceful shutdown: SIGTERM handling, 30s timeout
- [ ] Connection draining on shutdown
- [ ] Circuit breakers for downstream calls
- [ ] Retry with exponential backoff for external calls

### Performance
- [ ] Static assets cached 1 year (immutable)
- [ ] API responses cached where appropriate
- [ ] Database connection pooling (if DB added)
- [ ] Redis connection pooling
- [ ] Bundle size < 200KB gzipped
- [ ] Lighthouse score > 90

## Operations

### Access Control
- [ ] RBAC: least privilege for team
- [ ] Break-glass admin access (time-limited, audited)
- [ ] No direct SSH to nodes
- [ ] GitOps: ArgoCD or Flux for deployments

### Backup & DR
- [ ] Redis: daily snapshots, 30-day retention
- [ ] Config/Secrets backed up to git
- [ ] RTO: 1 hour, RPO: 1 hour
- [ ] Tested restore quarterly

### Incident Response
- [ ] Runbooks documented and accessible
- [ ] On-call rotation with escalation
- [ ] Status page (status.lgu.gov.ph)
- [ ] Post-incident review process
- [ ] War room channel template

### Compliance
- [ ] Data residency: Philippines only
- [ ] Encryption at rest (Redis, disk)
- [ ] Encryption in transit (TLS 1.2+)
- [ ] Audit log retention: 7 years
- [ ] PII handling documented
- [ ] Penetration test annually

## Pre-Launch Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Engineering Lead | | | |
| Security Lead | | | |
| Operations Lead | | | |
| Compliance Officer | | | |
| Product Owner | | | |

## Post-Launch (Week 1)

- [ ] Daily health review
- [ ] Error rate < 0.1%
- [ ] Latency p99 < 500ms
- [ ] No security alerts
- [ ] Backup verified
- [ ] Runbooks tested
