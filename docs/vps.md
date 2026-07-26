# Running easyagent on a VPS

Tested target: **Hostinger KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) with
**Ubuntu 24.04 LTS**. Any KVM plan from KVM 1 up works; the steps are the same
on any Debian/Ubuntu box.

Read [Before you start](#before-you-start) first — a VPS changes the threat
model, and one of the points there is not obvious.

---

## Before you start

**The agent runs shell commands on this machine.** On your laptop that is your
machine; on a VPS it is a server reachable from the internet. Two consequences:

1. **Install bubblewrap** (step 3). Without it the OS sandbox silently does
   nothing — the app is configured with `failIfUnavailable: false`, so a
   missing sandbox degrades quietly instead of refusing to run. The command
   deny-list still applies, but you lose the second line of defence.
2. **Keep the Locked profile** on a server. `Open` disables every confirmation
   and lets the agent run any command; that is a bad trade on a box you are not
   watching.

**Anyone who reaches the address can try to log in.** The defences are the app
password (scrypt-hashed) and the login rate limit (5 attempts, then a doubling
cool-down). There is no 2FA yet. Use a long password, and prefer a hostname
you do not publish.

**The app is never exposed directly.** Caddy holds port 443 with a real
Let's Encrypt certificate and forwards to easyagent on `127.0.0.1:3000`. Keep it
that way: do not enable "Access from your phone" on a VPS — that setting is for
a home LAN and would make the app listen on every interface.

**Cost.** Turns run on your Claude subscription, not on the VPS's CPU — the
server mostly waits on the network. 2 vCPU is enough for a handful of parallel
turns; see `EASYAGENT_MAX_TURNS` in step 6.

---

## 1. Create the server

In Hostinger's panel: **VPS → Operating System → Ubuntu 24.04 (no panel)**.
Set an SSH key rather than a password if the panel offers it.

Then, from your laptop:

```bash
ssh root@YOUR_SERVER_IP
```

## 2. A non-root user

Never run the app as root — the agent executes commands, and root removes every
guardrail the OS could offer.

```bash
adduser --disabled-password --gecos "" easyagent
usermod -aG sudo easyagent
rsync --archive --chown=easyagent:easyagent ~/.ssh /home/easyagent
```

## 3. System packages

```bash
apt update && apt upgrade -y
apt install -y curl git bubblewrap ripgrep

# Node.js 22 LTS (Next 16 needs >= 20.9; Ubuntu's own package is too old)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # must print v22.x
```

`bubblewrap` is what makes the OS sandbox real on Linux — see
[Before you start](#before-you-start).

## 4. Firewall

Only SSH and the web ports. easyagent's own port stays closed to the world:
Caddy reaches it over loopback.

```bash
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw --force enable
ufw status
```

## 5. Install easyagent

```bash
su - easyagent
git clone https://github.com/daviderosso-data/easyagent.git
cd easyagent
npm ci
npm run build
```

## 6. Configuration

Create `/home/easyagent/easyagent/.env.local`:

```bash
# The address people type. Makes the app accept this hostname from the reverse
# proxy and mark session cookies Secure. Without it, any request whose Host is
# not loopback is refused with 403.
EASYAGENT_PUBLIC_ORIGIN=https://agent.example.com

# Parallel agent turns. Each one spawns an engine subprocess; on 2 vCPU keep it
# small. Omit for the default of 10.
EASYAGENT_MAX_TURNS=3
```

Setting `EASYAGENT_PUBLIC_ORIGIN` also makes the app **refuse to run without a
password**: the first-run "continue without a password" option disappears, and
every route stays closed until you set one. That is deliberate — a public
deployment must not be one click away from being open.

Do **not** set `HOST`; the app binds `127.0.0.1` on its own, which is what you
want behind Caddy.

## 7. Sign in to Claude Code

The app drives the `claude` CLI with your subscription, so the CLI must be
logged in **as the `easyagent` user**. This is the one step that needs a
browser, and the server has none — the CLI prints a URL, you open it on your
laptop, and paste the code back:

```bash
npx claude
# follow the printed URL on your laptop, authorise, paste the code back
```

Verify it stuck:

```bash
npx claude -p "say ok"
```

Credentials land in `/home/easyagent/.claude/`. Keep that directory private
(the app already denies the agent read access to it).

## 8. Run it as a service

As root, create `/etc/systemd/system/easyagent.service`:

```ini
[Unit]
Description=easyagent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=easyagent
WorkingDirectory=/home/easyagent/easyagent
EnvironmentFile=/home/easyagent/easyagent/.env.local
Environment=NODE_ENV=production
Environment=PORT=3000
# Force the subscription: an API key would take precedence over it.
Environment=ANTHROPIC_API_KEY=
Environment=ANTHROPIC_AUTH_TOKEN=
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now easyagent
systemctl status easyagent
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/auth/status   # 200
```

## 9. TLS with Caddy

Point your domain's **A record** at the server IP first, then:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Replace `/etc/caddy/Caddyfile` with:

```caddyfile
agent.example.com {
	encode zstd gzip

	# Agent turns stream over SSE and can run for many minutes.
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
		transport http {
			read_timeout 30m
			write_timeout 30m
		}
	}
}
```

```bash
systemctl reload caddy
```

Caddy obtains and renews the certificate automatically. `flush_interval -1`
matters: without it Caddy buffers the response and the live token-by-token
streaming arrives in one lump at the end.

## 10. First access

Open `https://agent.example.com`. You will get **"Protect easyagent"** with no
skip option. Set a long password — it is the only thing between the internet
and an agent with a shell.

Then check **Settings → Access**: it should say the app password is on, and
"Access from your phone" must stay **off** (Caddy already publishes the app;
that toggle would additionally bind every interface).

---

## Day-to-day

```bash
systemctl restart easyagent      # after a rebuild
journalctl -u easyagent -f       # logs
```

**Updating:**

```bash
su - easyagent
cd easyagent && git pull && npm ci && npm run build
exit
systemctl restart easyagent
```

Build *before* restarting, never while the service is serving: `next build`
empties and recreates `.next`, and a server that boots inside that window dies
with `Cannot find module '.next/server/middleware-manifest.json'`.

**What to back up** (everything lives outside the repo):

| Path | Contents |
|---|---|
| `~/easyagent/` | your projects |
| `~/.easyagent/` | settings, project metadata, password hash, sessions, usage |
| `~/.claude/` | Claude Code credentials |

```bash
tar czf easyagent-backup.tgz ~/easyagent ~/.easyagent ~/.claude
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403 Accesso non consentito` | `EASYAGENT_PUBLIC_ORIGIN` missing or not matching the hostname you typed (scheme included). |
| Stuck on the login screen, no skip option | Intended: a public deployment requires a password. Set one. |
| Streaming arrives all at once at the end | `flush_interval -1` missing from the Caddyfile. |
| `Cannot find module '.next/server/middleware-manifest.json'` | Started during a build. Let `npm run build` finish, then restart. |
| Agent commands behave oddly / no sandbox | `bubblewrap` not installed (step 3). |
| Caddy cannot get a certificate | DNS A record not pointing at the server yet, or port 80 blocked. |

## Not covered yet

**2FA.** The current gate is a single password plus a rate limit. If this box
holds anything valuable, put it behind an authenticating proxy (Cloudflare
Access, Tailscale, an OIDC forward-auth) until 2FA ships.
