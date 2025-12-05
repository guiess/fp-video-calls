# Complete Azure Deployment Guide - Voice Video App

This guide provides step-by-step instructions to deploy a WebRTC voice/video application to Azure with proper security and environment management.

## Architecture Overview

- **Backend**: Node.js signaling server → Azure App Service (Linux)
- **Frontend**: React/Vite SPA → Azure Static Web Apps
- **Secrets**: TURN server credentials → Azure Key Vault (optional for testing)
- **NAT Traversal**: Free STUN servers + optional TURN servers for production
- **Environment**: Variables managed through Azure configurations

**📖 Important:** Read [WebRTC TURN Server Explanation](./webrtc-turn-explanation.md) to understand why TURN servers are needed for production deployments.

## Prerequisites

- Azure subscription with sufficient permissions
- Azure CLI installed (`az --version`)
- Node.js 18+ installed locally
- Git repository (GitHub recommended for CI/CD)

## Part 1: Initial Azure Setup

### Step 1.1: Login and Setup
```bash
# Login to Azure
az login

# Set your subscription (if you have multiple)
az account set --subscription "Your-Subscription-Name"

# Create resource group
az group create --name "rg-voice-video" --location "East US"
```

### Step 1.2: Create Azure Key Vault (for secrets)
```bash
# Create Key Vault
az keyvault create \
  --name "kv-voice-video" \
  --resource-group "rg-voice-video" \
  --location "East US" \
  --enable-rbac-authorization false

# Store the Key Vault name for later use
export KEY_VAULT_NAME=$(az keyvault list --resource-group "rg-voice-video" --query "[0].name" -o tsv)
echo "Key Vault created: $KEY_VAULT_NAME"
```

### Step 1.3: Add TURN Server Secrets to Key Vault (Optional for Testing)

**Important:** TURN servers are optional for initial testing but **required for production**. See [docs/webrtc-turn-explanation.md](./webrtc-turn-explanation.md) for detailed explanation.

**Option A: Skip TURN (Testing Only - 70-85% connection success)**
```bash
# Skip this step for initial testing
# Free STUN servers will be used for basic NAT traversal
echo "Skipping TURN configuration for testing deployment"
```

**Option B: Configure TURN (Production Ready - 99%+ connection success)**
```bash
# Add your TURN server credentials (replace with actual values)
# Get these from providers like Twilio, Xirsys, or self-hosted coturn
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "turn-urls" \
  --value "turns:turn1.example.com:443,turns:turn2.example.com:443"

az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "turn-username" \
  --value "your-turn-username"

az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "turn-password" \
  --value "your-turn-password"
```

**TURN Server Providers:**
- **Twilio**: Global edge locations, pay-per-GB
- **Xirsys**: WebRTC specialist, reliable service
- **Self-hosted**: coturn on Azure VM (requires setup)

## Part 2: Deploy Backend (Signaling Server)

### Step 2.1: Create App Service Plan and Web App
```bash
# Create App Service Plan (Linux, B1 tier)
az appservice plan create \
  --name "asp-voice-video" \
  --resource-group "rg-voice-video" \
  --sku B1 \
  --is-linux

# Create Web App
az webapp create \
  --name "app-voice-video-server" \
  --resource-group "rg-voice-video" \
  --plan "asp-voice-video" \
  --runtime "NODE:18-lts"

# Store the app name for later use
export SERVER_APP_NAME=$(az webapp list --resource-group "rg-voice-video" --query "[0].name" -o tsv)
echo "Server app created: $SERVER_APP_NAME"
echo "Server URL: https://$SERVER_APP_NAME.azurewebsites.net"
```

### Step 2.2: Configure App Service Settings
```bash
# Enable WebSockets (required for Socket.IO)
az webapp config set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --web-sockets-enabled true

# Enable Always On (keeps app warm)
az webapp config set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --always-on true

# Set Node.js version
az webapp config set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --linux-fx-version "NODE|18-lts"
```

### Step 2.3: Grant App Service Access to Key Vault
```bash
# Enable system-assigned managed identity
az webapp identity assign \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video"

# Get the principal ID
export PRINCIPAL_ID=$(az webapp identity show --name "$SERVER_APP_NAME" --resource-group "rg-voice-video" --query "principalId" -o tsv)

# Grant Key Vault secrets access
az keyvault set-policy \
  --name "$KEY_VAULT_NAME" \
  --object-id "$PRINCIPAL_ID" \
  --secret-permissions get list
```

### Step 2.4: Configure Environment Variables
```bash
# Set CORS origin (will be updated after frontend deployment)
az webapp config appsettings set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --settings \
    CORS_ORIGINS="https://localhost:5173" \
    CORS_CREDENTIALS="true" \
    NODE_ENV="production"
```

### Step 2.5: Deploy Server Code
```bash
# Navigate to server directory
cd server

# Install dependencies and create deployment package
npm ci --production
zip -r ../server-deploy.zip . -x "node_modules/.*" "*.log"

# Deploy to Azure
az webapp deployment source config-zip \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --src "../server-deploy.zip"

cd ..
```

### Step 2.6: Verify Server Deployment
```bash
# Check health endpoint
curl "https://$SERVER_APP_NAME.azurewebsites.net/health"

# Check logs
az webapp log tail --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"
```

## Part 3: Deploy Frontend (Static Web App)

### Step 3.1: Create Static Web App
```bash
# Create Static Web App (requires GitHub integration)
# Replace with your GitHub repo URL
export GITHUB_REPO_URL="https://github.com/yourusername/voice-video"

az staticwebapp create \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --source "$GITHUB_REPO_URL" \
  --location "East US2" \
  --branch "main" \
  --app-location "web" \
  --output-location "dist" \
  --login-with-github

# Get the Static Web App URL
export SWA_URL=$(az staticwebapp show --name "swa-voice-video" --resource-group "rg-voice-video" --query "defaultHostname" -o tsv)
echo "Static Web App URL: https://$SWA_URL"
```

### Step 3.2: Configure Static Web App Environment Variables
```bash
# Get TURN credentials from Key Vault
export TURN_URLS=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-urls" --query "value" -o tsv)
export TURN_USERNAME=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-username" --query "value" -o tsv)
export TURN_PASSWORD=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-password" --query "value" -o tsv)

# Set build-time environment variables for Static Web App
az staticwebapp appsettings set \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names \
    VITE_SIGNALING_URL="https://$SERVER_APP_NAME.azurewebsites.net" \
    VITE_TURN_URLS="$TURN_URLS" \
    VITE_TURN_USERNAME="$TURN_USERNAME" \
    VITE_TURN_PASSWORD="$TURN_PASSWORD"
```

### Step 3.3: Update Server CORS Settings
```bash
# Update server CORS to allow the static web app domain
az webapp config appsettings set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --settings \
    CORS_ORIGINS="https://$SWA_URL" \
    CORS_CREDENTIALS="true"

# Restart the app to apply settings
az webapp restart --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"
```

## Part 4: Alternative Frontend Deployment (Storage Account)

If you prefer not to use Static Web Apps, you can use Azure Storage:

### Step 4.1: Create Storage Account
```bash
# Create storage account
az storage account create \
  --name "savvoicevideo$(date +%s | cut -c6-10)" \
  --resource-group "rg-voice-video" \
  --location "East US" \
  --sku "Standard_LRS"

export STORAGE_ACCOUNT=$(az storage account list --resource-group "rg-voice-video" --query "[0].name" -o tsv)

# Enable static website hosting
az storage blob service-properties update \
  --account-name "$STORAGE_ACCOUNT" \
  --static-website \
  --404-document "index.html" \
  --index-document "index.html"

# Get the static website URL
export STORAGE_URL=$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "rg-voice-video" --query "primaryEndpoints.web" -o tsv | sed 's/https:\/\///' | sed 's/\///')
echo "Storage URL: https://$STORAGE_URL"
```

### Step 4.2: Build and Upload Frontend (Storage Method)
```bash
# Navigate to web directory
cd web

# Set environment variables for build
export VITE_SIGNALING_URL="https://$SERVER_APP_NAME.azurewebsites.net"
export VITE_TURN_URLS="$TURN_URLS"
export VITE_TURN_USERNAME="$TURN_USERNAME"
export VITE_TURN_PASSWORD="$TURN_PASSWORD"

# Install dependencies and build
npm ci
npm run build

# Upload to storage
az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --source "dist" \
  --destination '$web' \
  --overwrite

cd ..

# Update server CORS for storage URL
az webapp config appsettings set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --settings \
    CORS_ORIGINS="https://$STORAGE_URL" \
    CORS_CREDENTIALS="true"
```

## Part 5: Custom Domain and CDN (Optional)

### Step 5.1: Setup CDN for Storage Account
```bash
# Create CDN profile
az cdn profile create \
  --name "cdn-voice-video" \
  --resource-group "rg-voice-video" \
  --sku "Standard_Microsoft"

# Create CDN endpoint
az cdn endpoint create \
  --name "cdn-voice-video-endpoint" \
  --profile-name "cdn-voice-video" \
  --resource-group "rg-voice-video" \
  --origin "$STORAGE_URL" \
  --origin-host-header "$STORAGE_URL"
```

## Part 6: Security and Monitoring

### Step 6.1: Configure Application Insights
```bash
# Create Application Insights
az monitor app-insights component create \
  --app "ai-voice-video" \
  --location "East US" \
  --resource-group "rg-voice-video"

# Get instrumentation key
export AI_KEY=$(az monitor app-insights component show --app "ai-voice-video" --resource-group "rg-voice-video" --query "instrumentationKey" -o tsv)

# Add to App Service
az webapp config appsettings set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --settings \
    APPINSIGHTS_INSTRUMENTATIONKEY="$AI_KEY"
```

### Step 6.2: Configure Firewall (if needed)
```bash
# Restrict App Service access to specific IPs (optional)
# az webapp config access-restriction add \
#   --name "$SERVER_APP_NAME" \
#   --resource-group "rg-voice-video" \
#   --rule-name "AllowOfficeIP" \
#   --action Allow \
#   --ip-address "YOUR.OFFICE.IP.ADDRESS/32" \
#   --priority 100
```

## Part 7: CI/CD Pipeline (GitHub Actions)

Create `.github/workflows/deploy.yml` in your repository:

```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]

env:
  AZURE_WEBAPP_NAME: ${{ secrets.AZURE_WEBAPP_NAME }}
  NODE_VERSION: '18'

jobs:
  deploy-server:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: ${{ env.NODE_VERSION }}
        cache: 'npm'
        cache-dependency-path: server/package-lock.json
    
    - name: Install dependencies
      run: |
        cd server
        npm ci --production
    
    - name: Deploy to Azure Web App
      uses: azure/webapps-deploy@v2
      with:
        app-name: ${{ env.AZURE_WEBAPP_NAME }}
        publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
        package: ./server

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: ${{ env.NODE_VERSION }}
        cache: 'npm'
        cache-dependency-path: web/package-lock.json
    
    - name: Build frontend
      run: |
        cd web
        npm ci
        npm run build
      env:
        VITE_SIGNALING_URL: ${{ secrets.VITE_SIGNALING_URL }}
        VITE_TURN_URLS: ${{ secrets.VITE_TURN_URLS }}
        VITE_TURN_USERNAME: ${{ secrets.VITE_TURN_USERNAME }}
        VITE_TURN_PASSWORD: ${{ secrets.VITE_TURN_PASSWORD }}
    
    - name: Deploy to Static Web App
      uses: Azure/static-web-apps-deploy@v1
      with:
        azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
        repo_token: ${{ secrets.GITHUB_TOKEN }}
        action: "upload"
        app_location: "web"
        output_location: "dist"
```

## Part 8: Testing and Verification

### Step 8.1: Health Checks
```bash
# Test server health
curl "https://$SERVER_APP_NAME.azurewebsites.net/health"

# Test CORS
curl -H "Origin: https://$SWA_URL" "https://$SERVER_APP_NAME.azurewebsites.net/cors-check"

# Test WebSocket connection (optional)
# Use a WebSocket client tool
```

### Step 8.2: Frontend Testing
1. Open `https://$SWA_URL` in browser
2. Grant camera/microphone permissions
3. Create a room and test video/audio
4. Open in incognito/another device to test peer connection

## Part 9: Troubleshooting

### Azure CLI Command Issues

**Static Web App Creation Error:**
```
unrecognized arguments: --build-location web
```
**Solution:** The `--build-location` parameter is not valid for `az staticwebapp create`. Use only:
```bash
az staticwebapp create \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --source "$GITHUB_REPO_URL" \
  --location "East US2" \
  --branch "main" \
  --app-location "web" \
  --output-location "dist"
```

### WebSocket Connection Issues

**Client connecting to wrong URL:**
```
WebSocket connection to 'wss://thankful-moss-0611ddf0f.3.azurestaticapps.net/socket.io/?EIO=4&transport=websocket' failed:
```

**Root Cause:** Either the `VITE_SIGNALING_URL` environment variable is not set, or it's set but the Static Web App hasn't been rebuilt since the variable was added.

**Key Point:** Azure Static Web Apps inject environment variables at **build time**, not runtime. If you add/change environment variables, you must trigger a rebuild.

**Solutions:**

**Step 1: Verify Environment Variable Is Set**
```bash
# Check current environment variables in Azure Portal
az staticwebapp appsettings list \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video"

# If not set, add it:
az staticwebapp appsettings set \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names \
    VITE_SIGNALING_URL="https://app-voice-video-server.azurewebsites.net"
```

**Step 2: Force Rebuild (Critical Step)**
Even if the environment variable shows in Azure Portal, you MUST rebuild:

```bash
# Method A: Trigger rebuild via Git (Recommended)
git commit --allow-empty -m "Rebuild for environment variables"
git push origin main

# Method B: In Azure Portal
# Go to: Static Web App > Overview > "Browse to GitHub Action" > Re-run latest workflow
```

**Step 3: Monitor Build and Verify**

**Option A: GitHub Actions (Recommended)**
```bash
# Open GitHub repository Actions tab
echo "Monitor at: https://github.com/YOUR-USERNAME/YOUR-REPO/actions"

# Look for "Azure Static Web Apps CI/CD" workflow
# Status should change from 🟡 In Progress → ✅ Success
```

**Option B: Azure CLI Monitoring**
```bash
# Check deployment timestamp (should be recent after build completes)
az staticwebapp show --name "swa-voice-video" --resource-group "rg-voice-video" --query "lastUpdatedOn" -o tsv

# Compare with current time
date

# Check overall status (should be "Ready")
az staticwebapp show --name "swa-voice-video" --resource-group "rg-voice-video" --query "{status:status,lastUpdated:lastUpdatedOn}"
```

**Option C: Azure Portal Check**
1. Go to Azure Portal > Your Static Web App
2. Check **Status**: Should show "Ready"
3. Check **Last deployment**: Should show recent timestamp
4. Click **"Browse to GitHub Action"** to see workflow status

**Step 4: Test After Deployment Completes**
```bash
# Deployment typically takes 3-5 minutes total
# Then test WebSocket connection:

echo "1. Force refresh browser (Ctrl+Shift+R / Cmd+Shift+R)"
echo "2. Open DevTools > Network tab"
echo "3. Try connecting to a room"
echo "4. Verify WebSocket URL goes to your App Service, not Static Web App"
```

**Expected Results:**
- ✅ WebSocket connects to: `wss://app-voice-video-server.azurewebsites.net/socket.io/`
- ❌ Should NOT connect to: `wss://your-static-app.azurestaticapps.net/socket.io/`

**Option 3: Debug Environment Variables**

**In Browser DevTools Network Tab:**
1. Open DevTools (F12) > Network tab
2. Try to connect to a room
3. Look for WebSocket connection attempts
4. Verify they go to your App Service URL, not Static Web App URL

**Add Debug Code to Your React App:**
```typescript
// Add temporarily to your App.tsx
useEffect(() => {
  const signalingUrl = import.meta.env.VITE_SIGNALING_URL;
  console.log('🔧 VITE_SIGNALING_URL:', signalingUrl);
  
  if (!signalingUrl) {
    console.error('❌ Environment variable not set!');
  }
}, []);
```

**Check Built Code:**
- Open DevTools > Sources > Search for "VITE_SIGNALING_URL" in built files
- Should find your server URL, not `undefined`

**Important Notes:**
- Static Web Apps build environment variables at build time, not runtime
- You must trigger a new build after changing environment variables
- Variables must be prefixed with `VITE_` to be available in the client
- Check Azure Portal > Static Web App > Configuration > Application settings

### Azure CLI Warnings (Safe to Ignore)

You may see these harmless warnings when running Azure CLI commands:
```
SyntaxWarning: invalid escape sequence '\S'
expects one of the time zones listed under HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows
```

**Solution:** These are internal Azure CLI warnings and don't affect deployment. The commands still work correctly.

**Alternative:** Update Azure CLI to latest version:
```bash
# macOS
brew upgrade azure-cli

# Windows
az upgrade

# Linux
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

### Common Deployment Issues:

**1. WebSocket Connection Failed:**
- Verify WebSockets are enabled in App Service
- Check CORS settings match frontend domain
- Review server logs: `az webapp log tail --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"`

**2. CORS Errors:**
```bash
# Update CORS settings to include multiple domains
az webapp config appsettings set \
  --name "$SERVER_APP_NAME" \
  --resource-group "rg-voice-video" \
  --settings CORS_ORIGINS="https://$SWA_URL,https://localhost:5173"

# Restart app to apply changes
az webapp restart --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"
```

**3. Environment Variables Not Loading:**
- For Static Web Apps: Variables must be prefixed with `VITE_`
- For App Service: Use `az webapp config appsettings list` to verify
- Check case sensitivity in variable names

**4. App Service Deployment Fails:**
```bash
# Check deployment status
az webapp deployment list-publishing-profiles --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"

# View deployment logs
az webapp log deployment show --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"

# Common fix: Restart the app
az webapp restart --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"
```

**5. Static Web App Build Fails:**
```bash
# Check build logs in GitHub Actions (if using GitHub integration)
# Or manually build locally to test:
cd web
npm ci
npm run build
```

**6. Key Vault Access Issues:**
```bash
# Verify managed identity is enabled
az webapp identity show --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"

# Check Key Vault permissions
az keyvault show --name "$KEY_VAULT_NAME" --resource-group "rg-voice-video"

# Test secret access
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-urls" 2>/dev/null || echo "Access denied or secret not found"
```

**7. TURN Server Issues:**
- Test TURN connectivity with online STUN/TURN tester
- Verify credentials in Key Vault: `az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-username"`
- Check if firewall blocks TURN ports (usually 3478, 5349, 10000-20000)

**8. Resource Name Conflicts:**
```bash
# If resources already exist, use different names
export SERVER_APP_NAME="app-voice-video-$(date +%s)"
export KEY_VAULT_NAME="kv-voice-video-$(date +%s | tail -c 6)"
```

### Monitoring Commands:
```bash
# View App Service logs
az webapp log tail --name "$SERVER_APP_NAME" --resource-group "rg-voice-video"

# View App Service metrics
az monitor metrics list \
  --resource "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/rg-voice-video/providers/Microsoft.Web/sites/$SERVER_APP_NAME" \
  --metric "CpuPercentage,MemoryPercentage,Http2xx,Http4xx,Http5xx"

# Check Key Vault access
az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name "turn-urls"
```

## Summary

You now have:
- ✅ Signaling server on Azure App Service with WebSockets
- ✅ React frontend on Azure Static Web Apps (or Storage)
- ✅ Secrets managed in Azure Key Vault
- ✅ CORS properly configured
- ✅ Environment variables set up
- ✅ CI/CD pipeline ready
- ✅ Monitoring and logging enabled

**Key URLs:**
- Server: `https://$SERVER_APP_NAME.azurewebsites.net`
- Frontend: `https://$SWA_URL` (or storage URL)
- Key Vault: `https://$KEY_VAULT_NAME.vault.azure.net`

**Environment Variables Used:**
- `VITE_SIGNALING_URL`: Points to your signaling server
- `VITE_TURN_*`: TURN server configuration for NAT traversal
- `CORS_ORIGINS`: Allowed frontend domains
- `CORS_CREDENTIALS`: Enable credential support

The application is now production-ready with proper security, monitoring, and scalability!