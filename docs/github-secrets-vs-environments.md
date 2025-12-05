# GitHub Secrets vs Environments for Azure Static Web Apps

## Your Question: Environment vs Repository Secrets

You created a GitHub environment and added secrets there, but **for Azure Static Web Apps, you need Repository secrets, not Environment secrets**.

## Key Difference

### Repository Secrets (What you need ✅)
- **Location**: GitHub repo > Settings > Secrets and variables > Actions > **Repository secrets** tab
- **Usage**: Available to all workflows in the repository
- **Azure Static Web Apps**: Automatically picks these up

### Environment Secrets (What you created ❌)
- **Location**: GitHub repo > Settings > Secrets and variables > Actions > **Environments** tab
- **Usage**: Only available when workflows explicitly reference the environment
- **Azure Static Web Apps**: Doesn't automatically use these

## Quick Fix

### Step 1: Add Repository Secret
1. Go to your GitHub repository
2. Click **Settings** > **Secrets and variables** > **Actions**  
3. Make sure you're on the **"Repository secrets"** tab (not "Environments")
4. Click **"New repository secret"**
5. Name: `VITE_SIGNALING_URL`
6. Value: `https://app-voice-video-server.azurewebsites.net`
7. Click **"Add secret"**

### Step 2: Check Your Azure Static Web Apps Workflow

Your workflow file (`.github/workflows/azure-static-web-apps-*.yml`) should automatically use repository secrets. Look for:

```yaml
- name: Build And Deploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_... }}
    # ... other settings
```

**If environment variables aren't being passed**, you might need to add them explicitly:

```yaml
- name: Build And Deploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_... }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: "upload"
    app_location: "web" 
    output_location: "dist"
  env:
    VITE_SIGNALING_URL: ${{ secrets.VITE_SIGNALING_URL }}
```

### Step 3: Trigger Build

```bash
git commit --allow-empty -m "Use GitHub repository secrets"
git push origin main
```

### Step 4: Verify in Build Logs

Check GitHub Actions logs for:
```
Setting up environment variables
VITE_SIGNALING_URL=https://app-voice-video-server.azurewebsites.net
```

## Do You Need to Link Environment to Actions?

**No** - For Azure Static Web Apps, you don't need to link environments to actions. The workflow should automatically use repository secrets.

**Environment secrets are only needed when:**
- You explicitly reference an environment in your workflow
- You want environment-specific approvals or protections
- You have multiple deployment environments (staging, prod, etc.)

For a simple Azure Static Web Apps deployment, **repository secrets are the correct approach**.

## Alternative: Use staticwebapp.config.json (Simpler)

If GitHub secrets continue to cause issues, the most reliable method is:

Create `web/staticwebapp.config.json`:
```json
{
  "environmentVariables": {
    "VITE_SIGNALING_URL": "https://app-voice-video-server.azurewebsites.net"
  }
}
```

This method doesn't depend on GitHub secrets and is guaranteed to work.

## Summary

1. ✅ **Use Repository secrets** (Settings > Secrets and variables > Actions > Repository secrets)
2. ❌ **Don't use Environment secrets** for Azure Static Web Apps
3. 🔄 **Alternative**: Use staticwebapp.config.json for guaranteed results

The repository secret should be automatically picked up by your Azure Static Web Apps workflow without any additional configuration.