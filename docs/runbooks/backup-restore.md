# Backup and Restore Runbook

## Overview

The LGU Portal uses two persistent data stores:

- **Redis** — session state, authorization codes, refresh tokens, lockout counters
- **PostgreSQL** (optional) — user accounts, audit log, client registry

Both must be backed up regularly. This runbook covers Kubernetes-native
procedures; adapt the commands for your cloud provider's managed services
(ElastiCache, Cloud SQL, etc.).

## Prerequisites

```bash
# Verify cluster access
kubectl config current-context

# Verify namespace
kubectl get ns lgu-portal
```

---

## Redis Backup

### Full Dump (RDB)

Redis persists to disk as RDB snapshots. Capture the PVC contents:

```bash
# 1. Find the Redis pod
REDIS_POD=$(kubectl get pods -n lgu-portal -l app.kubernetes.io/name=redis -o jsonpath='{.items[0].metadata.name}')

# 2. Trigger a BGSAVE (if not already running)
kubectl exec -n lgu-portal "$REDIS_POD" -- redis-cli BGSAVE

# 3. Copy the RDB file from the pod
kubectl cp -n lgu-portal "$REDIS_POD:/data/dump.rdb" ./redis-backup-$(date +%Y%m%d).rdb

# 4. Compress
gzip ./redis-backup-$(date +%Y%m%d).rdb
```

### AOF (Append-Only File)

If AOF is enabled in `k8s/redis.yaml`:

```bash
kubectl cp -n lgu-portal "$REDIS_POD:/data/appendonly.aof" ./redis-aof-$(date +%Y%m%d).aof
gzip ./redis-aof-$(date +%Y%m%d).aof
```

### Restore Redis

```bash
# 1. Scale Redis down
kubectl scale deployment redis -n lgu-portal --replicas=0

# 2. Copy the RDB into the PVC (use a debug pod if the deployment is down)
kubectl cp ./redis-backup-20240101.rdb.gz -n lgu-portal "$REDIS_POD:/data/dump.rdb.gz" 2>/dev/null || {
  kubectl run redis-restore -n lgu-portal --image=redis:7-alpine --restart=Never --command -- sleep 3600
  kubectl cp ./redis-backup-20240101.rdb.gz -n lgu-portal redis-restore:/data/dump.rdb.gz
  kubectl exec -n lgu-portal redis-restore -- sh -c "gunzip /data/dump.rdb.gz"
  kubectl delete pod redis-restore -n lgu-portal
}

# 3. Scale Redis back up
kubectl scale deployment redis -n lgu-portal --replicas=1

# 4. Verify
kubectl get pods -n lgu-portal -l app.kubernetes.io/name=redis
```

---

## PostgreSQL Backup

The portal uses Drizzle ORM with optional Postgres. When `DATABASE_URL` is set,
migrations run automatically on startup via `scripts/docker-entrypoint.sh`.

### pg_dump

```bash
# 1. Find the Postgres service
#    If using the bundled Postgres StatefulSet/Deployment:
PG_POD=$(kubectl get pods -n lgu-portal -l app.kubernetes.io/name=postgres -o jsonpath='{.items[0].metadata.name}')

# 2. Run pg_dump
kubectl exec -n lgu-portal "$PG_POD" -- pg_dump -U lgu_portal lgu_portal > ./pg-backup-$(date +%Y%m%d).sql

# 3. Compress
gzip ./pg-backup-$(date +%Y%m%d).sql
```

### Restore PostgreSQL

```bash
# 1. Drop and recreate the database (destructive)
kubectl exec -n lgu-portal "$PG_POD" -- psql -U lgu_portal -c "DROP DATABASE IF EXISTS lgu_portal;"
kubectl exec -n lgu-portal "$PG_POD" -- psql -U lgu_portal -c "CREATE DATABASE lgu_portal;"

# 2. Restore
gunzip -k ./pg-backup-20240101.sql.gz
kubectl exec -i -n lgu-portal "$PG_POD" -- psql -U lgu_portal lgu_portal < ./pg-backup-20240101.sql

# 3. Run migrations (should be a no-op, but verify)
kubectl exec -n lgu-portal "$PG_POD" -- psql -U lgu_portal lgu_portal -c "SELECT * FROM drizzle_migrations;"
```

---

## Automated Backup (CronJob)

For production, schedule daily backups with a Kubernetes CronJob:

```yaml
# k8s/backup-cronjob.yaml (example skeleton)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: lgu-portal-backup
  namespace: lgu-portal
spec:
  schedule: "0 2 * * *"   # 02:00 server time
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: redis-backup
              image: redis:7-alpine
              command: ["sh", "-c"]
              args:
                - |
                  redis-cli -h redis BGSAVE
                  sleep 5
                  kubectl cp lgu-portal/redis-0:/data/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
          restartPolicy: OnFailure
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: backup-pvc
```

Store backups in an object store (S3, GCS, MinIO) with lifecycle rules for
retention and Glacier/Archive tiering.

---

## Verification

After any restore:

```bash
# 1. Verify Redis connectivity from the app
kubectl exec -n lgu-portal -it deploy/lgu-portal -- redis-cli -h redis PING

# 2. Verify Postgres connectivity
kubectl exec -n lgu-portal -it deploy/lgu-portal -- node -e "
  const { db } = require('@/lib/db');
  db.select().from(users).limit(1).then(r => console.log('users ok', r.length));
"

# 3. Verify app health
kubectl exec -n lgu-portal -it deploy/lgu-portal -- curl -f http://localhost:3000/api/health/readiness
```
