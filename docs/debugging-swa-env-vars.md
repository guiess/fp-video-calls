# Debugging Azure Static Web Apps Environment Variables

This guide helps you troubleshoot environment variable issues in Azure Static Web Apps, particularly when the frontend can't connect to the signaling server.

## Common Symptom

Your frontend tries to connect to the Static Web App URL instead of the signaling server:

```
WebSocket connection to 'wss://your-static-app.azurestaticapps.net/socket.io/?EIO=4&transport=websocket' failed:
```

Instead of the correct server:
```
wss://your-app-service.azurewebsites.net/socket.io/?EIO=4&transport=websocket
```

## Root Cause

The `VITE_SIGNALING_URL` environment variable is not properly set in Azure Static Web Apps, causing the client to fall back to same-origin connection.

## Quick Diagnosis

### Step 1: Check Environment Variables in Browser

**Method A: Check Network Requests**
1. Open your Static Web App in the browser
2. Open DevTools (F12) > Network tab
3. Try to connect to a room
4. Look for WebSocket connection attempts
5. Check if they're going to:
   - ❌ `wss://your-static-app.azurestaticapps.net/socket.io/` (wrong - same-origin fallback)
   - ✅ `wss://your-server.azurewebsites.net/socket.io/` (correct - signaling server)

**Method B: Check Built Code**
1. Open DevTools > Sources tab
2. Navigate to your built JavaScript files (usually in `_framework/`)
3. Search for "VITE_SIGNALING_URL" in the source code
4. If you find it with a value like `"https://your-server.azurewebsites.net"`, it's configured correctly
5. If you find it as `undefined` or missing, the environment variable wasn't set during build

**Method C: Add Debug Code (Temporary)**
Add this temporarily to your React app's main component:

```javascript
// Add this in your App.tsx or main component
useEffect(() => {
  console.log('🔍 Debug: Checking signaling URL...');
  
  // This will work in the component context
  const signalingUrl = import.meta.env.VITE_SIGNALING_URL;
  console.log('VITE_SIGNALING_URL:', signalingUrl);
  
  if (!signalingUrl) {
    console.error('❌ VITE_SIGNALING_URL is not set!');
    alert('Config Error: Signaling server URL not configured');
  } else {
    console.log('✅ VITE_SIGNALING_URL is configured:', signalingUrl);
  }
}, []);
```

### Step 2: Check Azure Static Web App Configuration

```bash
# List current environment variables
az staticwebapp appsettings list \
  --name "your-swa-name" \
  --resource-group "rg-voice-video" \
  --output table

# Should show VITE_SIGNALING_URL in the output
```

## Solutions

### Solution 1: Set Environment Variable Correctly

```bash
# Replace with your actual resource names
export SWA_NAME="swa-voice-video"
export SERVER_APP_NAME="app-voice-video-server"
export RESOURCE_GROUP="rg-voice-video"

# Set the correct signaling URL
az staticwebapp appsettings set \
  --name "$SWA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --setting-names \
    VITE_SIGNALING_URL="https://$SERVER_APP_NAME.azurewebsites.net"
```

### Solution 2: Trigger New Build

Static Web Apps bake environment variables into the build at build time, so you need to trigger a new build:

**Option A: Push to GitHub**
```bash
# Make a small change and push to trigger rebuild
git commit --allow-empty -m "Trigger rebuild for env vars"
git push origin main
```

**Option B: Manual Deployment**
1. Go to Azure Portal > Your Static Web App > Overview
2. Click "Manage deployment token" 
3. Copy the deployment token
4. Trigger a manual deployment or wait for GitHub Actions

### Solution 3: Verify in GitHub Actions

If using GitHub integration, check the build logs:

1. Go to your GitHub repository > Actions
2. Look for the latest deployment workflow
3. Check the build step for environment variable injection
4. Look for lines like:
   ```
   Setting up environment variables...
   VITE_SIGNALING_URL=https://your-server.azurewebsites.net
   ```

## Verification Steps

### 1. Check Build Logs

In GitHub Actions or Azure Portal deployment logs, look for:
```
[INFO] Building with Vite...
[INFO] Environment variables:
[INFO]   VITE_SIGNALING_URL=https://your-server.azurewebsites.net
```

### 2. Test the Connection

**Method A: Network Tab**
1. Open DevTools > Network tab
2. Filter by "WS" (WebSocket) or "socket.io"
3. Try to connect to a room
4. Verify WebSocket connections go to your App Service URL

**Method B: Console Logs**
Look for console logs from your WebRTC service:
```
[join] emitted { roomId: "test-room", userId: "user123", quality: "720p" }
```

**Method C: WebSocket Connection Status**
In Network tab, click on the WebSocket connection:
- ✅ Status should be "101 Switching Protocols"
- ✅ URL should be your App Service domain
- ❌ If connection fails immediately, wrong URL is being used

### 3. Network Tab Verification

In browser DevTools > Network tab:
- Look for WebSocket connections
- Verify they're going to your App Service URL (`.azurewebsites.net`)
- Not to the Static Web App URL (`.azurestaticapps.net`)

## Prevention

### Add Environment Variable Validation

Add this to your React App component for early detection:

```typescript
// In your App.tsx
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    // Validate environment variables on app start
    const signalingUrl = import.meta.env.VITE_SIGNALING_URL;
    
    console.log('🔧 Environment Check:');
    console.log('- MODE:', import.meta.env.MODE);
    console.log('- DEV:', import.meta.env.DEV);
    console.log('- VITE_SIGNALING_URL:', signalingUrl);
    
    if (!signalingUrl) {
      console.error('❌ VITE_SIGNALING_URL not configured!');
      console.error('Expected: https://your-server.azurewebsites.net');
      console.error('Got: undefined');
      
      // Show user-friendly error for 5 seconds
      const errorMsg = 'Configuration error: Signaling server URL not set. Check deployment configuration.';
      console.error(errorMsg);
      
      // Optional: Show in UI
      setTimeout(() => {
        if (!signalingUrl) {
          alert(errorMsg);
        }
      }, 2000);
    } else {
      console.log('✅ Signaling server configured correctly');
    }
  }, []);

  // ... rest of your component
}
```

### Use Build-Time Validation

Add this to your `vite.config.ts`:

```typescript
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'env-validation',
      buildStart() {
        const signalingUrl = process.env.VITE_SIGNALING_URL;
        if (!signalingUrl) {
          this.warn('⚠️  VITE_SIGNALING_URL is not set - frontend will default to same-origin connection');
        } else {
          console.log('✅ VITE_SIGNALING_URL configured:', signalingUrl);
        }
      }
    }
  ],
  // ... rest of config
});
```

## Common Mistakes

1. **Wrong variable name**: Must be `VITE_SIGNALING_URL`, not `SIGNALING_URL`
2. **Missing VITE_ prefix**: All client-side env vars must start with `VITE_`
3. **Runtime vs build-time**: Static Web Apps set variables at build time, not runtime
4. **Not triggering rebuild**: Environment variable changes require a new build
5. **Typos in URLs**: Ensure the server URL is exactly correct with https://

## Quick Fix Commands

```bash
# If environment variable is already set in Azure Portal but still not working:

# 1. Check current build timestamp
az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query "lastUpdatedOn" -o tsv

# 2. Force rebuild by pushing to GitHub (most reliable method)
git commit --allow-empty -m "Trigger rebuild for environment variables"
git push origin main

# 3. Alternative: Manual deployment trigger in Azure Portal
# Go to: Azure Portal > Your Static Web App > Overview > "Browse to GitHub Action"
# Then: Actions tab > "Re-run jobs" on latest workflow

# 4. Monitor redeployment status (see detailed steps below)
echo "✅ Rebuild triggered. Monitoring deployment..."

# 5. Verify build completed successfully
echo "Check: https://github.com/your-username/your-repo/actions"
```

## How to Check If Web App Has Been Redeployed

### Method 1: GitHub Actions (Recommended)

**Step 1: Check GitHub Actions Status**
```bash
# Open your repository in browser
echo "Open: https://github.com/YOUR-USERNAME/YOUR-REPO/actions"

# Or use GitHub CLI if installed
gh run list --limit 5
```

**Step 2: Monitor Workflow Progress**
1. Go to your GitHub repository
2. Click "Actions" tab
3. Look for "Azure Static Web Apps CI/CD" workflow
4. Latest run should show:
   - 🟡 **In Progress** (yellow circle) - Building...
   - ✅ **Success** (green checkmark) - Deployment complete
   - ❌ **Failed** (red X) - Check logs for errors

**Step 3: Check Workflow Logs**
Click on the workflow run to see detailed logs:
- **Build And Deploy Job** > **Build And Deploy** step
- Look for environment variables injection:
```
***Environment variables***
VITE_SIGNALING_URL = https://app-voice-video-server.azurewebsites.net
```

### Method 2: Azure CLI

**Check Last Updated Timestamp**
```bash
# Get the last deployment time
az staticwebapp show \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --query "lastUpdatedOn" \
  --output tsv

# Compare with current time to see if it's recent
date
```

**Check Deployment Status**
```bash
# Get overall status
az staticwebapp show \
  --name "swa-voice-video" \
  --resource-group "rg-voice-video" \
  --query "{name:name,status:status,lastUpdated:lastUpdatedOn}" \
  --output table
```

### Method 3: Azure Portal

**Steps:**
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Static Web App resource
3. Click **"Overview"** in left menu
4. Check **"Status"** field (should be "Ready")
5. Check **"Last deployment"** timestamp
6. Click **"Browse to GitHub Action"** to see workflow

**Look for:**
- Status: **Ready** ✅
- Last deployment: Recent timestamp (within last few minutes)
- GitHub Action: Green checkmark ✅

### Method 4: Browser Cache Verification

**Force Browser Refresh**
```bash
# After deployment completes, force refresh to clear cache
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R
# Or: Ctrl/Cmd + F5
```

**Check Network Tab**
1. Open DevTools (F12) > Network tab
2. Reload page (to see all requests)
3. Look for requests to your Static Web App
4. Check response headers for recent timestamps
5. Try connecting to a room to test WebSocket URL

### Method 5: Automated Monitoring Script

**Create a monitoring script:**
```bash
#!/bin/bash
# monitor-deployment.sh

SWA_NAME="swa-voice-video"
RESOURCE_GROUP="rg-voice-video"
GITHUB_REPO="YOUR-USERNAME/YOUR-REPO"

echo "🔍 Monitoring Azure Static Web App deployment..."

while true; do
    # Get last updated time
    LAST_UPDATED=$(az staticwebapp show \
        --name "$SWA_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "lastUpdatedOn" \
        --output tsv 2>/dev/null)
    
    echo "[$(date '+%H:%M:%S')] Last deployment: $LAST_UPDATED"
    
    # Check if GitHub Actions are running
    if command -v gh &> /dev/null; then
        GH_STATUS=$(gh run list --repo "$GITHUB_REPO" --limit 1 --json status --jq '.[0].status' 2>/dev/null)
        echo "[$(date '+%H:%M:%S')] GitHub Actions status: $GH_STATUS"
        
        if [ "$GH_STATUS" = "completed" ]; then
            echo "✅ Deployment completed! Test your app now."
            break
        fi
    fi
    
    sleep 30  # Check every 30 seconds
done
```

## Signs Deployment is Complete

### ✅ Successful Deployment Indicators:

1. **GitHub Actions:** Green checkmark with "completed" status
2. **Azure Portal:** Status shows "Ready", recent last deployment time
3. **Azure CLI:** Recent timestamp in `lastUpdatedOn` field
4. **Browser Test:** WebSocket connects to App Service URL, not Static Web App URL
5. **Network Tab:** New requests show recent timestamps

### ⚠️ Still Deploying Indicators:

1. **GitHub Actions:** Yellow circle "in_progress" status
2. **Azure Portal:** Status shows "Uploading" or similar
3. **Azure CLI:** Old timestamp in `lastUpdatedOn`
4. **Browser Test:** Still connects to Static Web App URL (wrong)

## Typical Timeline

- **Trigger:** Git push
- **GitHub Actions Start:** 10-30 seconds after push
- **Build Time:** 2-4 minutes
- **Deployment:** 30-60 seconds
- **Total:** Usually 3-5 minutes from push to live

## Quick Test After Deployment

```bash
# Wait for deployment to complete, then test
echo "Testing WebSocket connection..."

# Method A: Check in browser DevTools Network tab
echo "1. Open your Static Web App"
echo "2. Open DevTools > Network tab"
echo "3. Try to connect to a room"
echo "4. Verify WebSocket goes to your-server.azurewebsites.net"

# Method B: Check built source
echo "Or check DevTools > Sources > Search for 'VITE_SIGNALING_URL'"
echo "Should find your server URL, not 'undefined'"
```

Following these steps will help you confirm when the redeployment is complete and the environment variables are properly injected.

**If Environment Variable Is Set But Still Not Working:**

This is the most common scenario. The environment variable exists in Azure Portal, but the Static Web App was built before the variable was set. Solution:

1. **Trigger GitHub Actions Rebuild:**
   ```bash
   git commit --allow-empty -m "Rebuild for env vars"
   git push origin main
   ```

2. **Monitor Build Progress:**
   - Go to your GitHub repository > Actions tab
   - Watch the "Azure Static Web Apps CI/CD" workflow
   - Build typically takes 2-3 minutes

3. **Verify Environment Variable in Build Logs:**
   Look for lines like:
   ```
   Setting up environment variables
   VITE_SIGNALING_URL=https://app-voice-video-server.azurewebsites.net
   ```

4. **Test After Build Completes:**
   - Refresh your Static Web App
   - Try connecting to a room
   - Check Network tab for correct WebSocket URL

Following this guide should resolve the WebSocket connection issues and ensure your frontend connects to the correct signaling server.