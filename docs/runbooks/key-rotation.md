# Key Rotation Runbook

## When to Rotate

| Trigger | Timeline |
|---------|----------|
| Scheduled rotation | Every 90 days |
| Key compromise suspected | Immediately |
| Employee with key access leaves | Within 24 hours |
| Compliance requirement | Per policy (e.g., annually) |

## Pre-Rotation Checklist

- [ ] Notify on-call team
- [ ] Schedule during low-traffic window (e.g., 02:00-04:00 local)
- [ ] Verify current key status in admin UI
- [ ] Confirm backup of current keys
- [ ] Alert downstream clients if using custom integration

## Rotation Procedure

### Automated (via Admin UI)
1. Navigate to Admin → Signing Keys
2. Click "Rotate Keys Now"
2. Verify new key is active in JWKS: `curl https://portal.lgu.gov.ph/api/oidc/jwks`
3. Verify old key is marked "Retired" but still present
4. Monitor token validation for 1 hour

### Manual (Emergency)
```bash
# 1. Generate new key pair
kubectl exec -n lgu-portal deploy/lgu-portal -- node -e "
const { rotateSigningKeys } = require('@/lib/admin/keys');
rotateSigningKeys().then(k => console.log('New key:', k.kid));
"

# 2. Verify JWKS
curl -s https://portal.lgu.gov.ph/api/oidc/jwks | jq '.keys[].kid'

# 2. Force session re-auth if needed
kubectl exec -n lgu-portal deploy/redis -- redis-cli FLUSHDB
```

## Post-Rotation Verification

- [ ] JWKS shows new key as active
- [ ] Old key marked retired but present
- [ ] New tokens validate: `curl -H "Authorization: Bearer <token>" https://portal.lgu.gov.ph/api/session`
- [ ] Admin UI shows new key as active
- [ ] Downstream systems can validate tokens
- [ ] No auth failures in logs for 30 min

## Rollback Procedure

If rotation causes issues:
```bash
# Revoke new key, reactivate old
kubectl exec -n lgu-portal deploy/lgu-portal -- node -e "
const { revokeKey } = require('@/lib/admin/keys');
revokeKey('new_key_kid'); // Revoke new
// Old key automatically reactivated if only one active
"
```

## Communication

- Post to `#infra-ops` before starting
- Update status page if user-facing impact expected
- Post-rotation summary to `#infra-ops`

## Compliance Notes

- Log rotation in audit trail
- Store old private keys for 1 year (for token verification)
- Document in compliance evidence package
