# Static Web App Configuration Solution

## Problem: Repository Secrets Still Not Working
User added GitHub repository secret `VITE_SIGNALING_URL` but environment variables are still not being injected into the build process.

## Solution: Use staticwebapp.config.json
This approach bypasses the environment variable injection issues by using Azure Static Web Apps' native configuration file.

### Step 1: Create Configuration File
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

### Step 2: Deploy Configuration
1. Commit and push the configuration file:
   ```bash
   git add web/staticwebapp.config.json
   git commit -m "Add staticwebapp.config.json for environment variables"
   git push origin main
   ```

2. Azure Static Web Apps will automatically detect and use this configuration

### Step 3: Verify Deployment
1. Check GitHub Actions build logs for:
   ```
   ***Environment variables***
   NODE_VERSION = 18
   VITE_SIGNALING_URL = https://app-voice-video-server.azurewebsites.net
   ```

2. Test WebSocket connection in browser console:
   - Should connect to: `wss://app-voice-video-server.azurewebsites.net/socket.io/`
   - Should NOT connect to: `wss://your-static-app.azurestaticapps.net/socket.io/`

### Why This Works
- `staticwebapp.config.json` is processed directly by Azure Static Web Apps
- Environment variables are injected at the infrastructure level, not through GitHub
- This bypasses any GitHub integration issues
- Works reliably across all Azure Static Web Apps deployments

### Configuration Explanation
- **environmentVariables**: Sets build-time environment variables that Vite can access
- **routes**: Ensures SPA routing works correctly (fallback to index.html for all routes)

### Alternative: Runtime Configuration (if above doesn't work)
If staticwebapp.config.json still doesn't work, use runtime configuration:

1. Create `web/public/config.js`:
   ```javascript
   window.APP_CONFIG = {
     SIGNALING_URL: 'https://app-voice-video-server.azurewebsites.net'
   };
   ```

2. Add to `web/index.html` before other scripts:
   ```html
   <script src="/config.js"></script>
   ```

3. Modify WebRTC service to check runtime config first:
   ```typescript
   private ensureSocket() {
     const configUrl = (window as any).APP_CONFIG?.SIGNALING_URL;
     const envUrl = import.meta.env.VITE_SIGNALING_URL;
     
     this.endpoint = configUrl || envUrl || "fallback-url";
     // ... rest of method
   }
   ```

## Next Steps
1. Switch to Code mode to implement the staticwebapp.config.json file
2. Commit and deploy the configuration
3. Verify the WebSocket connection works correctly
4. Test the complete WebRTC functionality