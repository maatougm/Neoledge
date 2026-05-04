#!/usr/bin/env bash
# ============================================================================
# NeoLeadge — production deploy script
# Run as root on the host server (187.77.70.67).
#
#   bash /root/neoleadge/deploy/neoleadge/deploy.sh [--seed-rbac] [--reset-creds]
#
# Flags:
#   --seed-rbac     Run prisma/seed-rbac.js after the stack is up. Required on
#                   first deploy after the Postgres migration.
#   --reset-creds   Reset known test credentials (admin@... / Admin@123, etc.)
#                   so the quick-login buttons work. NEVER run on prod with
#                   real users — only on staging or first cutover.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

SEED_RBAC=0
RESET_CREDS=0
for arg in "$@"; do
  case "$arg" in
    --seed-rbac) SEED_RBAC=1 ;;
    --reset-creds) RESET_CREDS=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f .env.prod ]; then
  echo "Missing .env.prod — copy from .env.prod.example and fill DB_PASSWORD / JWT_SECRET" >&2
  exit 1
fi

echo "[1/5] Pulling latest source via git fetch + reset…"
( cd /root/neoleadge && git fetch origin nest-back && git reset --hard origin/nest-back )

echo "[2/5] Building Docker images (no cache for app images)…"
docker compose -f docker-compose.prod.yml --env-file .env.prod build server web

echo "[3/5] Bringing the stack up (postgres first, then web/server)…"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
# Wait for Postgres
until docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres pg_isready -U "${DB_USER:-neoleadge}" >/dev/null 2>&1; do
  sleep 2
done
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d server web

echo "[4/5] Applying Prisma migrations inside the server container…"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T server \
  npx prisma migrate deploy

if [ "$SEED_RBAC" -eq 1 ]; then
  echo "[5a/5] Seeding RBAC tables (idempotent)…"
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T server \
    node prisma/seed-rbac.js
fi

if [ "$RESET_CREDS" -eq 1 ]; then
  echo "[5b/5] Resetting quick-login credentials…"
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T server \
    node -e "
      const {PrismaPg}=require('@prisma/adapter-pg');
      const {PrismaClient}=require('@prisma/client');
      const b=require('bcryptjs');
      require('dotenv/config');
      (async()=>{
        const adapter=new PrismaPg({connectionString:process.env.DATABASE_URL});
        const p=new PrismaClient({adapter});
        const accs=[
          ['admin@neoleadge.com','Admin@123'],
          ['pm@neoleadge.com','Pm@12345'],
          ['spec@neoleadge.com','Valid@123'],
          ['realiz@neoleadge.com','Valid@123'],
          ['deploy@neoleadge.com','Valid@123'],
        ];
        for(const [email,pwd] of accs){
          const hash=b.hashSync(pwd,10);
          await p.appUser.update({where:{email},data:{passwordHash:hash,isActive:true,failedLoginAttempts:0,lockedUntil:null,mustChangePassword:false,totpEnabled:false}}).catch(()=>{});
        }
        console.log('Quick-login creds reset for ',accs.length,' accounts');
        await p.\$disconnect();
      })();"
fi

echo "[5/5] Done. Smoke-test:"
echo "  curl -s https://neoleadge.pythagore-init.com/auth/login -X POST -H 'Content-Type: application/json' -d '{\"email\":\"admin@neoleadge.com\",\"password\":\"Admin@123\"}'"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
