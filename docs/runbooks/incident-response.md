# Incident Response Runbook

## Severity Levels

| Level | Definition | Response Time | Examples |
|-------|------------|---------------|----------|
| SEV-1 | Complete outage, data loss, security breach | 15 min | Portal down, auth broken, data leak |
| SEV-2 | Major feature broken, degraded performance | 1 hour | Login failing for some users, slow portal |
| SEV-3 | Minor issue, workaround exists | 4 hours | UI bug, non-critical feature broken |
| SEV-4 | Cosmetic, documentation, low priority | Next sprint | Typos, minor UI polish |

## Escalation Path

```
On-Call Engineer (15 min)
    ↓
Team Lead (30 min)
    ↓
Engineering Manager (1 hour)
    ↓
CTO / VP Engineering (2 hours)
```

## Common Incidents

### Portal Down (SEV-1)
1. Check liveness/readiness: `curl -f https://portal.lgu.gov.ph/api/health/liveness`
2. Check deployment: `kubectl get pods -n lgu-portal`
3. Check logs: `kubectl logs -n lgu-portal -l app.kubernetes.io/name=lgu-portal --tail=100`
4. Check Redis: `kubectl exec -n lgu-portal deploy/redis -- redis-cli ping`
5. Rollback: `kubectl rollout undo deployment/lgu-portal -n lgu-portal`

### Authentication Failing (SEV-1)
1. Check session store: `kubectl exec -n lgu-portal deploy/redis -- redis-cli keys "session:*" | wc -l`
2. Check rate limits: `kubectl logs -n lgu-portal deploy/lgu-portal | grep rate_limit`
3. Verify SESSION_SECRET matches across pods
4. Check OIDC issuer matches request origin

### Signing Key Compromise (SEV-1)
1. Immediately rotate keys: `kubectl exec -n lgu-portal deploy/lgu-portal -- node -e "require('@/lib/admin/keys').rotateSigningKeys()"`
2. Revoke old keys in admin UI
5. Monitor for token validation failures
6. Force re-auth for all users (clear sessions)

### Rate Limiting Too Aggressive (SEV-2)
1. Check rate limit stats in admin UI
2. Clear specific buckets: `kubectl exec -n lgu-portal deploy/redis -- redis-cli DEL "identity:..."`
3. Adjust limits in admin settings

## Communication

- Create incident channel: `#incident-<date>-<description>`
- Post status every 15 min during SEV-1
- Update status page: https://status.lgu.gov.ph
- Post-incident review within 48 hours

## Post-Incident Review Template

1. **What happened?** (Timeline)
2. **Root cause** (5 Whys)
3. **Impact** (Users affected, duration)
4. **Detection** (How found, time to detect)
5. **Response** (What worked, what didn't)
6. **Prevention** (Action items with owners)
