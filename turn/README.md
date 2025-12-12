# TURN (coturn) with Ephemeral Credentials (REST auth) – Azure Rollout Guide

This guide provides exact Azure Portal steps and CLI snippets to deploy coturn with ephemeral credentials and integrate with the signaling server and web client.

Key code references:
- Server endpoint and helper: [server.index.js](server/index.js:93)
- Client fetch and ICE integration: [web.src.services.webrtc.ts](web/src/services/webrtc.ts:183)
- Client prefetch timing: [web.src.services.webrtc.ts](web/src/services/webrtc.ts:222)

## 0) Prerequisites and Architecture

**Why separate TURN server from web app?**

Your web app (e.g., myapp.azurestaticapps.net or myapp.azurewebsites.net) serves your web client and signaling server. However, **TURN/coturn must run on a separate VM** because:

1. **UDP support**: TURN requires UDP ports 3478 and 10000-20000 for media relay. Azure PaaS services (App Service, Static Web Apps) only support HTTP/HTTPS over TCP ports 80/443, not raw UDP.
2. **Port control**: coturn needs direct access to specific ports and protocols that PaaS abstractions don't expose.
3. **Performance**: Media relay is bandwidth-intensive; dedicated VM gives full control over network stack and resources.

**Architecture:**
```
Browser → myapp.azurestaticapps.net (web app)
       ↓ fetch /api/turn (signaling server endpoint)
       ↓ receives ephemeral TURN credentials
       → connects to turns:turn.example.com:5349 (separate TURN VM for media relay)
```

Your web app domain stays as-is. Only the TURN VM needs a separate domain/DNS.

### 0a) Domain options for TURN server

**Option 1: Use Azure VM's free DNS label (EASIEST - no domain purchase needed)**

Azure provides free DNS for VMs via cloudapp.azure.com subdomains:

1. After creating VM: VM → Overview → click **Public IP address** resource name
2. Public IP resource → Configuration → **DNS name label (optional)**
3. Enter unique label: `myturn-vm` (must be globally unique per region)
4. Click **Save**
5. Result: Your VM is accessible at `myturn-vm.<region>.cloudapp.azure.com`
   - Example: `myturn-vm.eastus.cloudapp.azure.com`
6. Use this FQDN everywhere:
   - Certbot: `sudo certbot certonly --standalone -d myturn-vm.eastus.cloudapp.azure.com`
   - Server env: `TURN_REALM=myturn-vm.eastus.cloudapp.azure.com`
   - TURN_URLS: `turns:myturn-vm.eastus.cloudapp.azure.com:5349?transport=udp,...`

**Pros**: 
- Completely free
- No domain purchase or DNS management
- Works immediately
- Valid for Let's Encrypt certificates

**Cons**: 
- Generic Azure hostname
- Tied to Azure region naming
- Less professional for production

**Recommended for**: Testing, development, proof-of-concept

**Option 2: Use custom domain (production-grade)**

If you own a domain (example.com) from any registrar:

**Setup Azure DNS (recommended):**
1. Azure Portal → Create resource → Networking → **DNS zone**
2. Name: `example.com`, select subscription/resource group, click Create
3. After creation, note the 4 **Name servers** (e.g., ns1-01.azure-dns.com)
4. Go to your domain registrar's control panel → update nameservers to Azure's NS
5. Wait for DNS propagation (5-60 minutes)

**Add TURN A record:**
1. Azure DNS zone → + Record set
2. Name: `turn`, Type: A, IP: `<VM_public_IP>`, TTL: 300
3. Save
4. Result: `turn.example.com` points to your TURN VM

**Or use external DNS:**
- Log into Cloudflare/Namecheap/GoDaddy DNS control panel
- Add A record: Name: `turn`, Value: `<VM_public_IP>`

**Use in configuration:**
- Certbot: `sudo certbot certonly --standalone -d turn.example.com`
- Server env: `TURN_REALM=example.com`, `TURN_URLS=turns:turn.example.com:5349?transport=udp,...`

**Pros**:
- Professional appearance
- Full DNS control
- Custom branding

**Cons**:
- Domain purchase cost (~$10-15/year)
- DNS management overhead

**Recommended for**: Production deployments

**Option 3: Purchase domain through Azure**

If you don't have a domain:
1. Azure Portal → Create resource → Web → **App Service Domain**
2. Search available domains, purchase (~$10-15/year)
3. Auto-creates Azure DNS zone
4. Follow Option 2 steps to add A record

**Summary recommendation:**
- **Testing/dev**: Use Option 1 (free Azure DNS label)
- **Production**: Use Option 2 or 3 (custom domain)
- Your web app domain (*.azurestaticapps.net) remains unchanged

## 1) Azure VM and Networking (Portal steps)

Create Ubuntu VM with static IP and secure NSG.

Azure Portal:
1. **Home → Create a resource → Virtual machines** (or search "Virtual machines")
2. **Basics tab**:
   - Subscription: select your subscription
   - Resource group: select existing or click "Create new"
   - Virtual machine name: `turn-vm-01`
   - Region: choose region close to your users (e.g., East US, West Europe)
   - Availability options: No infrastructure redundancy required (for basic setup)
   - Security type: Standard
   - Image: Ubuntu Server 22.04 LTS - Gen2 (or latest LTS)
   - VM architecture: x64
   - Size: Standard_B2s (2 vCPUs, 4 GB RAM) or similar - click "See all sizes" to compare
   - Authentication type: SSH public key (recommended) or Password
     - Username: `azureuser` (or custom)
     - SSH public key source: Generate new key pair (save the .pem file) or Use existing
   - Public inbound ports: **Select "Allow selected ports"**
   - Select inbound ports: **SSH (22)** - we'll add TURN ports via NSG later
3. **Disks tab**:
   - OS disk type: Standard SSD (locally-redundant storage)
   - Delete with VM: checked (optional)
4. **Networking tab**:
   - Virtual network: create new (default name OK) or select existing
   - Subnet: default (10.0.0.0/24)
   - Public IP: **(new) turn-vm-01-ip** - click "Create new"
     - In popup: Name: `turn-vm-01-ip`
     - SKU: Standard
     - Assignment: **Static** (critical!)
     - Click OK
   - NIC network security group: Basic
   - Public inbound ports: Allow selected ports
   - Select inbound ports: SSH (22)
   - Delete NIC when VM is deleted: checked (optional)
5. **Management tab**:
   - Enable auto-shutdown: optional (useful for cost control during testing)
   - Boot diagnostics: Enable with managed storage account (recommended)
6. **Monitoring, Advanced, Tags tabs**: leave defaults
7. **Review + create**: verify configuration, click **Create**
8. **Download private key**: if you generated new SSH key pair, save the .pem file securely

**Wait for deployment** (~2-5 minutes). Once complete, click "Go to resource".

**Configure DNS label (for Option 1 - free Azure DNS):**
1. VM → Overview → click **Public IP address** resource name
2. Configuration → **DNS name label**: enter `myturn-vm` (or any unique name)
3. Save
4. Note the resulting FQDN: `myturn-vm.<region>.cloudapp.azure.com`

Configure NSG rules:
- In VM overview page, note the **Public IP address** (e.g., 20.85.123.45)
- Navigate: VM resource → left menu **Networking** → **Network settings**
- Under "Network security group": click the NSG name (e.g., `turn-vm-01-nsg`)
- In NSG resource → left menu **Inbound security rules** → click **+ Add**

Add these inbound rules one by one (click "+ Add" for each):

**Rule 1 - TURN UDP:**
- Source: Any
- Source port ranges: *
- Destination: Any
- Service: Custom
- Destination port ranges: `3478`
- Protocol: UDP
- Action: Allow
- Priority: 1000
- Name: `Allow-TURN-UDP-3478`
- Click **Add**

**Rule 2 - TURN TCP:**
- Source: Any
- Destination: Any
- Destination port ranges: `3478`
- Protocol: TCP
- Priority: 1001
- Name: `Allow-TURN-TCP-3478`
- Click **Add**

**Rule 3 - TURNS TLS:**
- Destination port ranges: `5349`
- Protocol: TCP
- Priority: 1002
- Name: `Allow-TURNS-TCP-5349`
- Click **Add**

**Rule 4 - Relay ports UDP:**
- Destination port ranges: `10000-20000`
- Protocol: UDP
- Priority: 1004
- Name: `Allow-Relay-UDP-10000-20000`
- Click **Add**

**Rule 5 - Relay ports TCP (optional):**
- Destination port ranges: `10000-20000`
- Protocol: TCP
- Priority: 1005
- Name: `Allow-Relay-TCP-10000-20000`
- Click **Add**

Optional - if proxying TURNS via port 443:
**Rule 6 - HTTPS/TURNS-443:**
- Destination port ranges: `443`
- Protocol: TCP
- Priority: 1003
- Name: `Allow-HTTPS-443`

- Return to VM → Networking → verify all rules show in "Inbound port rules" list

**If using custom domain (Option 2/3):** Add DNS A record now (see section 0a above).

## 2) VM Setup – coturn installation

SSH to VM using the private key:
```bash
# If you downloaded .pem file (replace path and IP):
chmod 400 ~/Downloads/turn-vm-01_key.pem
ssh -i ~/Downloads/turn-vm-01_key.pem azureuser@<vm_public_ip>

# Or if using Azure DNS label:
ssh -i ~/Downloads/turn-vm-01_key.pem azureuser@myturn-vm.eastus.cloudapp.azure.com

# Or if custom DNS configured:
ssh -i ~/Downloads/turn-vm-01_key.pem azureuser@turn.example.com

# If using password auth:
ssh azureuser@<vm_public_ip>
```

Update and install:
```bash
sudo apt update
sudo apt install coturn -y
```

Enable coturn service:
```bash
# Enable coturn in the default config (REQUIRED on Ubuntu)
sudo nano /etc/default/coturn
```

Uncomment this line:
```bash
TURNSERVER_ENABLED=1
```

Save and exit (Ctrl+X, Y, Enter).

Enable and start service:
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

## 3) Coturn configuration

Edit /etc/turnserver.conf (backup original first):
```bash
sudo cp /etc/turnserver.conf /etc/turnserver.conf.bak
sudo nano /etc/turnserver.conf
```

Recommended config (replace placeholders with actual values):
```conf
# TURN server ports
listening-port=3478
tls-listening-port=5349

# External IP for NAT traversal - CRITICAL: use your VM's public IP
external-ip=<YOUR_VM_PUBLIC_IP>

# Realm for authentication - use your FQDN
# For Azure DNS label: myturn-vm.eastus.cloudapp.azure.com
# For custom domain: example.com
realm=<your-fqdn-or-domain>

# Security options
fingerprint
lt-cred-mech
no-sslv3
no-tlsv1
no-tlsv1_1

# Performance and quotas
total-quota=100
stale-nonce=600

# Relay policy (uncomment if needed)
# no-tcp-relay
# If allowing TCP relay:
# tcp-relay-connections=100

# REST API authentication with shared secret
use-auth-secret
static-auth-secret=<STRONG_RANDOM_SECRET_HERE>

# Disable local user database (we're using REST auth)
no-auth-pkey
no-multicast-peers
no-cli
no-loopback-peers

# TLS certificates - SKIP INITIALLY; add after certbot step
# cert=/etc/letsencrypt/live/<your-fqdn>/fullchain.pem
# pkey=/etc/letsencrypt/live/<your-fqdn>/privkey.pem

# Logging
log-file=/var/log/turn.log
verbose

# Optimize for WebRTC
mobility
```

**IMPORTANT placeholders to replace:**
- `<YOUR_VM_PUBLIC_IP>`: Azure VM public IP (e.g., 20.85.123.45)
- `<your-fqdn-or-domain>`: 
  - Azure DNS label: `myturn-vm.eastus.cloudapp.azure.com`
  - Custom domain: `example.com` (just domain, not subdomain)
- `<STRONG_RANDOM_SECRET_HERE>`: Generate with: `openssl rand -base64 32`

Save and exit (Ctrl+X, Y, Enter).

Test configuration:
```bash
sudo turnserver -c /etc/turnserver.conf --check-config
```

Apply and restart (do this AFTER certbot if enabling TLS immediately):
```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

## 4) TLS certificates (Certbot)

Ensure DNS resolves (verify first):
```bash
# For Azure DNS label:
nslookup myturn-vm.eastus.cloudapp.azure.com

# For custom domain:
nslookup turn.example.com
```

Install Certbot:
```bash
sudo apt install certbot -y
```

Issue certificate (standalone mode - coturn must be stopped):
```bash
# Stop coturn temporarily
sudo systemctl stop coturn

# Request certificate - use YOUR actual FQDN
# For Azure DNS label:
sudo certbot certonly --standalone -d myturn-vm.eastus.cloudapp.azure.com --agree-tos --email your-email@example.com

# For custom domain:
sudo certbot certonly --standalone -d turn.example.com --agree-tos --email your-email@example.com

# Example output shows cert location:
# /etc/letsencrypt/live/<your-fqdn>/fullchain.pem
# /etc/letsencrypt/live/<your-fqdn>/privkey.pem
```

**IMPORTANT: Copy certs to location coturn can read**

By default, the `turnserver` user cannot read Let's Encrypt private keys. We'll copy certs to a dedicated directory:

```bash
# Create coturn-owned TLS directory
sudo mkdir -p /etc/turnserver/tls
sudo chown -R turnserver:turnserver /etc/turnserver/tls
sudo chmod 750 /etc/turnserver/tls

# Copy certificates (replace with YOUR FQDN)
# For Azure DNS label:
sudo cp /etc/letsencrypt/live/myturn-vm.eastus.cloudapp.azure.com/fullchain.pem /etc/turnserver/tls/fullchain.pem
sudo cp /etc/letsencrypt/live/myturn-vm.eastus.cloudapp.azure.com/privkey.pem /etc/turnserver/tls/privkey.pem

# For custom domain:
sudo cp /etc/letsencrypt/live/turn.example.com/fullchain.pem /etc/turnserver/tls/fullchain.pem
sudo cp /etc/letsencrypt/live/turn.example.com/privkey.pem /etc/turnserver/tls/privkey.pem

# Set ownership and permissions
sudo chown turnserver:turnserver /etc/turnserver/tls/fullchain.pem /etc/turnserver/tls/privkey.pem
sudo chmod 640 /etc/turnserver/tls/fullchain.pem /etc/turnserver/tls/privkey.pem
```

**Now update /etc/turnserver.conf** to use the copied certs:
```bash
sudo nano /etc/turnserver.conf
```

Set cert/pkey to the copied location:
```conf
cert=/etc/turnserver/tls/fullchain.pem
pkey=/etc/turnserver/tls/privkey.pem
tls-listening-port=5349
```

**Create renewal hook for automatic cert updates:**

When certbot renews certificates (every 90 days), they must be recopied to /etc/turnserver/tls:

```bash
# Create deploy hook script (replace FQDN with yours)
# For Azure DNS label:
sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn-copy.sh >/dev/null <<'EOF'
#!/bin/sh
set -e
SRC="/etc/letsencrypt/live/myturn-vm.eastus.cloudapp.azure.com"
DST="/etc/turnserver/tls"
cp "$SRC/fullchain.pem" "$DST/fullchain.pem"
cp "$SRC/privkey.pem" "$DST/privkey.pem"
chown turnserver:turnserver "$DST/fullchain.pem" "$DST/privkey.pem"
chmod 640 "$DST/fullchain.pem" "$DST/privkey.pem"
systemctl restart coturn
EOF

# For custom domain, replace the SRC path:
# SRC="/etc/letsencrypt/live/turn.example.com"

# Make hook executable
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn-copy.sh
```

Restart coturn with TLS enabled:
```bash
sudo systemctl start coturn
sudo systemctl status coturn

# Verify 5349 is now listening
sudo ss -lntp | grep ':5349'

# Check for errors:
sudo journalctl -u coturn -n 50 --no-pager
```

Validate TLS connection:
```bash
# Test TURNS TLS handshake (should show certificate chain and "Verify return code: 0 (ok)")
# Replace with YOUR FQDN:
openssl s_client -connect myturn-vm.eastus.cloudapp.azure.com:5349 -servername myturn-vm.eastus.cloudapp.azure.com

# Quick test with timeout:
timeout 5 openssl s_client -connect myturn-vm.eastus.cloudapp.azure.com:5349 -servername myturn-vm.eastus.cloudapp.azure.com < /dev/null

# Expected output includes:
# - "Verify return code: 0 (ok)"
# - Certificate chain with your FQDN
# - No SSL/TLS errors
```

Test TURN allocation (from another machine):
```bash
# Install turnutils if not present
sudo apt install coturn-utils -y

# Test UDP TURN allocation (replace with your actual secret and FQDN):
turnutils_uclient -v -u test:1234567890 -w $(echo -n "test:1234567890" | openssl dgst -sha1 -hmac "YOUR_SECRET" -binary | base64) myturn-vm.eastus.cloudapp.azure.com

# Test TURNS (TLS):
turnutils_uclient -v -u test:1234567890 -w $(echo -n "test:1234567890" | openssl dgst -sha1 -hmac "YOUR_SECRET" -binary | base64) -S myturn-vm.eastus.cloudapp.azure.com
```

## 5) Signaling server – environment variables

Configure environment variables for your signaling server deployment:

**Required variables:**
```bash
# Must match coturn's static-auth-secret exactly
TURN_HMAC_SECRET=<same_secret_from_turnserver.conf>

# Your FQDN/domain (matches coturn realm)
# For Azure DNS label:
TURN_REALM=myturn-vm.eastus.cloudapp.azure.com
# For custom domain:
TURN_REALM=example.com

# Comma-separated TURN URLs (optional - fallback provided in code)
# For Azure DNS label:
TURN_URLS=turns:myturn-vm.eastus.cloudapp.azure.com:5349?transport=udp,turns:myturn-vm.eastus.cloudapp.azure.com:5349?transport=tcp,turn:myturn-vm.eastus.cloudapp.azure.com:3478?transport=udp,turn:myturn-vm.eastus.cloudapp.azure.com:3478?transport=tcp
# For custom domain:
TURN_URLS=turns:turn.example.com:5349?transport=udp,turns:turn.example.com:5349?transport=tcp,turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp

# Credential TTL in seconds
TURN_TTL_SECONDS=300
```

**How to set based on your deployment:**

**Azure App Service:**
1. Portal → App Service → Configuration → Application settings
2. Click **+ New application setting** for each variable
3. Add: Name: `TURN_HMAC_SECRET`, Value: `<your_secret>`
4. Repeat for TURN_REALM, TURN_URLS, TURN_TTL_SECONDS
5. Click **Save** at top, then **Continue** to restart app

**Azure Static Web Apps (if API is in SWA):**
1. Portal → Static Web App → Configuration
2. Add environment variables in the API settings section
3. Save and redeploy

**Azure Container Instances / Container Apps:**
- Portal → Container instance → Configuration → Environment variables
- Add each variable

**Local/VM deployment (.env file):**
```bash
# In server directory
cat > .env << EOF
TURN_HMAC_SECRET=your_secret_here
TURN_REALM=myturn-vm.eastus.cloudapp.azure.com
TURN_URLS=turns:myturn-vm.eastus.cloudapp.azure.com:5349?transport=udp,turns:myturn-vm.eastus.cloudapp.azure.com:5349?transport=tcp,turn:myturn-vm.eastus.cloudapp.azure.com:3478?transport=udp,turn:myturn-vm.eastus.cloudapp.azure.com:3478?transport=tcp
TURN_TTL_SECONDS=300
EOF
```

**Redeploy/restart** the signaling server to pick up new env vars.

**Test endpoint** (after server restart):
```bash
# From your local machine (replace with actual server URL):
curl "https://<signaling-host>/api/turn?userId=test&roomId=test-room"

# Expected response:
# {"username":"test:1734022800","credential":"xyz...","ttl":300,"urls":["turns:..."],"realm":"myturn-vm.eastus.cloudapp.azure.com",...}
```

Code references:
- Issuance and endpoint: [server.index.js](server/index.js:93)
- Server listen banner: [server.index.js](server/index.js:305)

## 6) Web client integration

The client fetches ephemeral TURN before creating RTCPeerConnection and merges with STUN defaults:

- Fetch/cache: [web.src.services.webrtc.ts](web/src/services/webrtc.ts:206)
- Use in ICE servers: [web.src.services.webrtc.ts](web/src/services/webrtc.ts:183)
- Prefetch timing in join(): [web.src.services.webrtc.ts](web/src/services/webrtc.ts:222)

Ensure SIGNALING_URL is set (via web/public/config.js or env) so the client fetches /api/turn from the correct host.

## 7) Validation and testing

Browser:
- DevTools → Network: verify GET /api/turn returns username, credential, urls.
- chrome://webrtc-internals (or browser equivalent): check ICE candidates include typ=relay when TURN is used.

Cross-NAT test:
- One peer on Wi‑Fi behind typical home NAT.
- Other peer on mobile LTE (CGNAT). Confirm audio/video via relayed candidates.

Coturn logs:
```bash
sudo tail -f /var/log/turn.log
```
You should see allocations and traffic statistics.

## 8) Operations hardening

Rate limit /api/turn:
- Per IP/userId/roomId using express-rate-limit or similar.
- Log issuance with userId/roomId for audit.

Secret rotation:
- Plan dual-secret window:
  - Issue with new TURN_HMAC_SECRET while coturn accepts static-auth-secret updated.
  - Temporarily keep old secret until all clients/servers are updated.
  - Remove old secret after grace period.

Monitoring:
- Azure: VM → Metrics (CPU, network throughput).
- Scale VM size or provision additional coturn nodes.
- Use DNS round-robin (multiple A records) or load balancer.

Backups and renewals:
- Back up /etc/turnserver.conf and /etc/turnserver/tls/
- Certbot auto-renews via systemd timer (every 90 days)
  - Check timer: `systemctl list-timers | grep certbot`
  - Dry run: `sudo certbot renew --dry-run`
  - Renewal hook automatically copies new certs to /etc/turnserver/tls/ and restarts coturn

## 9) Quick command snippets

Firewall (ufw if enabled on VM):
```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 443/tcp   # optional if proxying TURNS via 443
sudo ufw allow 10000:20000/tcp
sudo ufw allow 10000:20000/udp
```

Service control:
```bash
sudo systemctl restart coturn
sudo systemctl status coturn
journalctl -u coturn -n 200 --no-pager
```

## 10) Rollout checklist (Azure-focused)

- [ ] Azure VM deployed with static Public IP
- [ ] NSG inbound rules applied (UDP/TCP 3478; TCP 5349; UDP/TCP 10000–20000; temporary TCP 80 for certbot)
- [ ] DNS configured (Azure DNS label OR custom domain A record)
- [ ] `/etc/default/coturn`: `TURNSERVER_ENABLED=1` uncommented
- [ ] Coturn installed and configured (/etc/turnserver.conf: realm, external-ip, static-auth-secret, listening-ip, relay-ip)
- [ ] TLS certificate issued via certbot (port 80 opened temporarily)
- [ ] Certificates copied to /etc/turnserver/tls/ with correct ownership (turnserver:turnserver)
- [ ] turnserver.conf updated: cert=/etc/turnserver/tls/fullchain.pem, pkey=/etc/turnserver/tls/privkey.pem
- [ ] Certbot renewal hook created (/etc/letsencrypt/renewal-hooks/deploy/coturn-copy.sh)
- [ ] Port 5349 listening verified: `sudo ss -lntp | grep ':5349'`
- [ ] TLS validated: `openssl s_client -connect <fqdn>:5349` shows "Verify return code: 0"
- [ ] Signaling server env vars set (TURN_HMAC_SECRET, TURN_REALM, TURN_URLS, TURN_TTL_SECONDS)
- [ ] Signaling server redeployed with new env vars
- [ ] /api/turn endpoint tested and returns valid credentials
- [ ] Client tested in browser: typ=relay candidates visible in webrtc-internals
- [ ] Cross-NAT test successful (Wi-Fi ↔ mobile)
- [ ] Coturn logs show successful allocations
- [ ] Rate limiting and logging implemented
- [ ] Secret rotation plan documented
- [ ] Monitoring configured (Azure VM metrics)

**Outcome:**
Ephemeral credentials reduce abuse and improve reliability. Clients fetch valid, time-boxed TURN details prior to establishing peer connections, while Azure VM provides secure, scalable relay infrastructure. Your web app domain stays unchanged; only TURN runs on separate VM with its own FQDN.
