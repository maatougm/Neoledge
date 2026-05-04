# NeoLeadge — production deploy on `school-hub-server`

Public URL: **https://neoleadge.pythagore-init.com**

Runs alongside School Hub with zero overlap:
- separate Docker network (`neoleadge-net`)
- separate Postgres container / volume
- web container bound to `127.0.0.1:8002` (never reaches the public internet directly)
- host-level Caddy terminates TLS and routes by Host header

## First-time deploy

### 1. DNS
A record already in place: `neoleadge.pythagore-init.com → 187.77.70.67`.

### 2. Push source to the server
```bash
# From your laptop:
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude 'web/Transcription/**' \
  /c/Users/BigPoppa/Desktop/neoleadge/ root@187.77.70.67:/root/neoleadge/
```

### 3. Stop the port clash on School Hub (one-time)
Change `school_web` to bind locally only. In `/root/school-hub/docker-compose.yml`, swap:
```yaml
    ports:
      - "80:80"
      - "443:443"
```
to:
```yaml
    ports:
      - "127.0.0.1:8001:80"
```
Then `cd /root/school-hub && docker compose up -d`.
(TLS is now handled by Caddy, not school_web's internal nginx — traffic stays HTTP between Caddy and school_web over the loopback.)

### 4. Install Caddy (host-level)
```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sSf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sSf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > \
  /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp /root/neoleadge/deploy/neoleadge/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

### 5. Configure env
```bash
cd /root/neoleadge/deploy/neoleadge
cp .env.prod.example .env.prod
# Edit .env.prod: set DB_PASSWORD, JWT_SECRET (use `openssl rand -hex 32` twice).
```

### 6. Bring up NeoLeadge
```bash
cd /root/neoleadge/deploy/neoleadge
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

First boot takes ~2-3 min (builds backend + frontend, runs `prisma db push` to create all 44 tables).

### 7. Seed an admin user
```bash
docker exec -it neoleadge_server node -e '
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  await db.appUser.upsert({
    where: { email: "admin@neoleadge.com" },
    update: {},
    create: {
      id: "admin-prod-001",
      email: "admin@neoleadge.com",
      firstName: "Admin", lastName: "User",
      role: "Admin",
      passwordHash: await bcrypt.hash("CHANGEME@123", 10),
      isActive: true, mustChangePassword: true,
    },
  });
  await db.$disconnect();
  console.log("admin seeded");
})();
'
```

### 8. Smoke-test
```bash
curl -sI https://neoleadge.pythagore-init.com/ | head -3
curl -s  https://neoleadge.pythagore-init.com/health
curl -s  https://pythagore-init.com/       | head -3   # school hub still works
```

## Updating NeoLeadge

```bash
# from laptop:
rsync -az ... root@187.77.70.67:/root/neoleadge/
# on server:
cd /root/neoleadge/deploy/neoleadge && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

## Resource footprint (expected)

| Container | RAM limit | Typical RSS |
|---|---|---|
| neoleadge_postgres | 384 MB | ~60 MB |
| neoleadge_server | 768 MB | ~250 MB |
| neoleadge_web | 128 MB | ~20 MB |
| **total new** | — | **~330 MB** on top of School Hub (~2.2 GB). |

Plenty of headroom on the 7.8 GB box.

## Rollback

```bash
cd /root/neoleadge/deploy/neoleadge
docker compose --env-file .env.prod -f docker-compose.prod.yml down
# restore school_web's public port if needed:
sed -i 's|"127.0.0.1:8001:80"|"80:80"\n      - "443:443"|' /root/school-hub/docker-compose.yml
cd /root/school-hub && docker compose up -d
# optional: remove Caddy
systemctl stop caddy && apt purge -y caddy
```
