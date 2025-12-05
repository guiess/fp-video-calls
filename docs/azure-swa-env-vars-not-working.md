# Azure Static Web Apps - Environment Variables Not Working

## Confirmed Issue: Environment Variable Set But Not Injected Into Build

**Your Status Confirmed:**
- ✅ Environment variable exists: `VITE_SIGNALING_URL = "https://app-voice-video-server.azurewebsites.net"`
- ❌ Not appearing in GitHub Actions build logs
- ❌ Still connecting to wrong URL: `wss://your-static-app.azurestaticapps.net/socket.io/`

**Root Cause:** Azure Static Web Apps is not injecting environment variables from Azure Portal into the GitHub Actions build process. This is a known issue with the GitHub integration.

## Critical Diagnostic Step: Check GitHub Actions Build Logs

This is the most important step to determine if environment variables are being injected:

### Step 1: Navigate to Build Logs
1. Go to your GitHub repository
2. Click **"Actions"** tab
3. Click on the latest **"Azure Static Web Apps CI/CD"** workflow run
4. Click on **"Build And Deploy Job"**
5. Click to expand the **"Build And Deploy"** step

### Step 2: Look for Environment Variables Section
Search for the text `***Environment variables***` in the logs.

**✅ If Working Correctly, You'll See:**
```
***Environment variables***
NODE_VERSION = 18
VITE_SIGNALING_URL = https://app-voice-video-server.azurewebsites.net
```

**❌ If NOT Working (Your Case), You'll See:**
```
***Environment variables***
NODE_VERSION = 18
(no VITE_SIGNALING_URL listed)
```

**❌ Or No Environment Variables Section At All**
This indicates Azure Static Web Apps is not passing any custom environment variables to the build.

## If Environment Variable Section Is Missing Completely

This is your situation - the build logs don't show any custom environment variables. Here are the most likely causes:

### Root Cause 1: Azure Static Web Apps GitHub Integration Issue

**Check GitHub App Permissions:**
1. Go to your GitHub repository
2. Click **Settings** > **Integrations & services**
3. Look for **"Azure Static Web Apps"** in the list
4. Click on it to check permissions
5. Verify it has access to "Repository metadata", "Pull requests", "Checks", etc.

**Fix: Reconnect GitHub Integration**
```bash
# Method 1: Via Azure Portal
# 1. Go to Azure Portal > Your Static Web App
# 2. Click "Overview" > "Manage deployment token"
# 3. Copy the deployment token
# 4. Go to GitHub repo > Settings > Secrets and variables > Actions
# 5. Update AZURE_STATIC_WEB_APPS_API_TOKEN with new token

# Method 2: Recreate the Static Web App entirely
az staticwebapp delete --name "swa-voice-video" --resource-group "rg-voice-video"
# Then recreate following the deployment guide
```

### Root Cause 2: Environment Variables Not Syncing

**Force Environment Variable Refresh:**
```bash
# Remove all environment variables
az staticwebapp appsettings delete \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names "VITE_SIGNALING_URL"

# Wait a moment
sleep 10

# Re-add the environment variable
az staticwebapp appsettings set \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names \
    VITE_SIGNALING_URL="https://app-voice-video-server.azurewebsites.net"

# Verify it was added
az staticwebapp appsettings list \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video"

# Trigger new build
git commit --allow-empty -m "Force environment variable sync"
git push origin main
```

### Root Cause 3: Wrong Static Web App Resource

**Verify You're Configuring The Right Resource:**
```bash
# List all Static Web Apps in your resource group
az staticwebapp list --resource-group "rg-voice-video" --output table

# Make sure you're using the correct name
# Check the actual deployed URL matches what you're configuring
```

## If Environment Variable Is Missing from Build Logs

### Solution 1: Verify Azure Portal Configuration

```bash
# Double-check the environment variable exists and spelling is correct
az staticwebapp appsettings list \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --output table
```

**Common Issues:**
- ❌ `VITE_SIGNALLING_URL` (extra L)
- ❌ `SIGNALING_URL` (missing VITE_ prefix)
- ❌ Wrong Static Web App name
- ✅ `VITE_SIGNALING_URL` (correct)

### Solution 2: Check Static Web App GitHub Integration

1. Go to Azure Portal > Your Static Web App
2. Click **"Overview"** > **"Manage deployment token"**
3. Verify GitHub integration is working
4. If broken, you may need to recreate the integration

### Solution 3: Force Environment Variable Sync

```bash
# Delete and re-add the environment variable
az staticwebapp appsettings delete \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names "VITE_SIGNALING_URL"

# Wait 30 seconds, then re-add
sleep 30

az staticwebapp appsettings set \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --setting-names \
    VITE_SIGNALING_URL="https://app-voice-video-server.azurewebsites.net"

# Trigger rebuild
git commit --allow-empty -m "Force env var sync"
git push origin main
```

## If Environment Variable Shows in Build Logs But Still Not Working

### Solution 1: Check Built Application Files

1. Open your Static Web App in browser
2. Open DevTools (F12) > **Sources** tab
3. Navigate to your built JavaScript files (usually in `assets/` folder)
4. Search for `VITE_SIGNALING_URL` in the source files
5. Look for your server URL in the code

**Expected:** You should find your server URL string somewhere in the built JS
**Problem:** If you only find `undefined` or the Static Web App URL

### Solution 2: Clear All Caches

```bash
# Force browser cache clear
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R

# Or open in incognito/private browsing mode
```

### Solution 3: Check Vite Build Configuration

Verify your `web/vite.config.ts` doesn't have conflicting configuration:

```typescript
// Make sure you don't have any conflicting environment variable logic
export default defineConfig({
  plugins: [react()],
  // Don't override environment variables here
});
```

## Immediate Workarounds (Since Environment Variables Aren't Working)

Since the environment variables aren't being injected at all, use these immediate fixes:

### Workaround 1: Hard-Code in WebRTC Service (Fastest Fix)

Add this temporary fix to your `web/src/services/webrtc.ts` file:

```typescript
// In the ensureSocket() method, around line 50-70, replace the environment variable logic:

private ensureSocket() {
  // TEMPORARY FIX: Hard-code the signaling server URL
  const SIGNALING_SERVER_URL = "https://app-voice-video-server.azurewebsites.net";
  
  this.endpoint = SIGNALING_SERVER_URL;
  
  if (!this.socket || !(this.socket as any).connected) {
    try {
      this.socket?.off(); // remove previous listeners if any
    } catch {}
    this.socket = io(this.endpoint, { transports: ["websocket"] });
    this.bindSocketEvents();
  }
}
```

**This will immediately fix your connection issue while we solve the environment variable problem.**

### Workaround 2: Use Public Configuration File

Create `web/public/config.js`:
```javascript
window.APP_CONFIG = {
  SIGNALING_URL: 'https://app-voice-video-server.azurewebsites.net'
};
```

Add to your `web/index.html` (before other scripts):
```html
<script src="/config.js"></script>
```

Then modify your WebRTC service:
```typescript
private ensureSocket() {
  // Check for runtime configuration first
  const configUrl = (window as any).APP_CONFIG?.SIGNALING_URL;
  const envUrl = (import.meta as any)?.env?.VITE_SIGNALING_URL;
  
  this.endpoint = configUrl || envUrl || "fallback-url";
  
  // ... rest of method
}
```

### Workaround 3: Use staticwebapp.config.json

Create `web/staticwebapp.config.json`:
```json
{
  "environmentVariables": {
    "VITE_SIGNALING_URL": "https://app-voice-video-server.azurewebsites.net"
  },
  "routes": [
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ]
}
```

## Advanced Diagnostics

### Check What Environment Variables Are Available

Add this temporarily to your React app:

```typescript
// Add to your App.tsx
useEffect(() => {
  console.log('🔍 Environment Debug:');
  console.log('- All env keys:', Object.keys(import.meta.env));
  console.log('- VITE_SIGNALING_URL:', import.meta.env.VITE_SIGNALING_URL);
  console.log('- Mode:', import.meta.env.MODE);
  console.log('- VITE_ vars:', Object.keys(import.meta.env).filter(key => key.startsWith('VITE_')));
  
  // Check if window config exists
  if ((window as any).APP_CONFIG) {
    console.log('- Window config:', (window as any).APP_CONFIG);
  }
}, []);
```

## Workarounds

### Workaround 1: Use Configuration File

Create `web/public/config.js`:
```javascript
window.APP_CONFIG = {
  SIGNALING_URL: 'https://app-voice-video-server.azurewebsites.net'
};
```

Add to `web/index.html`:
```html
<script src="/config.js"></script>
```

Then modify WebRTC service to use:
```typescript
const signalingUrl = window.APP_CONFIG?.SIGNALING_URL || 'fallback-url';
```

### Workaround 2: Use staticwebapp.config.json

Create `web/staticwebapp.config.json`:
```json
{
  "environmentVariables": {
    "VITE_SIGNALING_URL": "https://app-voice-video-server.azurewebsites.net"
  }
}
```

Note: This hard-codes the URL but should work if environment variables fail.

### Workaround 3: Temporary Hard-Code

As an absolute last resort, temporarily hard-code in the WebRTC service:

```typescript
// TEMPORARY: Hard-code until environment variables work
private ensureSocket() {
  // Override for testing
  this.endpoint = "https://app-voice-video-server.azurewebsites.net";
  
  if (!this.socket || !(this.socket as any).connected) {
    try {
      this.socket?.off();
    } catch {}
    this.socket = io(this.endpoint, { transports: ["websocket"] });
    this.bindSocketEvents();
  }
}
```

## Your Situation - Checklist

Based on your feedback, here's your current status:

1. ✅ **Environment variable exists in Azure Portal**
2. ❌ **Environment variable does NOT appear in GitHub Actions build logs**
3. ❌ **Built JavaScript files do NOT contain the server URL**
4. ❌ **Browser shows environment variable as undefined**
5. ❌ **WebSocket connects to Static Web App URL (wrong)**

**Immediate Action:** Use Workaround 1 (hard-code) above to fix the connection immediately, then work on solving the environment variable injection issue.

## Common Root Causes

1. **Spelling Error**: Most common - typo in `VITE_SIGNALING_URL`
2. **Missing VITE_ Prefix**: Environment variable not prefixed with `VITE_`
3. **GitHub Integration Issue**: Azure Static Web Apps can't access your repository
4. **Caching Issue**: Browser or CDN serving old files
5. **Build Process Issue**: Something in the build pipeline ignoring environment variables

## Get Help

If none of these solutions work:

1. Check GitHub Actions logs for any error messages
2. Verify your Azure Static Web Apps tier supports environment variables
3. Try creating a new Static Web App as a test
4. Use one of the workarounds above to verify the rest of your application works

The most important step is checking the GitHub Actions build logs to see if Azure Static Web Apps is actually passing the environment variable to the build process.