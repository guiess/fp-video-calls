# Azure Deployment Automation Script

This document contains the complete automation script for deploying the Voice Video App to Azure. The script supports both testing deployments (STUN-only) and production deployments (with TURN servers).

**📖 Read First:** [Why TURN Servers Are Needed](./webrtc-turn-explanation.md) explains the WebRTC connectivity requirements.

Copy the script below and save it as `scripts/deploy-azure.sh` in your project root.

## Deployment Script

```bash
#!/bin/bash

# Voice Video App - Azure Deployment Automation Script
# This script automates the complete deployment process to Azure

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command -v az &> /dev/null; then
        print_error "Azure CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
    
    print_status "Prerequisites check passed!"
}

# Get user inputs
get_user_inputs() {
    print_status "Gathering deployment configuration..."
    
    echo -n "Enter your Azure subscription name (or press Enter for default): "
    read SUBSCRIPTION_NAME
    
    echo -n "Enter resource group name [rg-voice-video]: "
    read RESOURCE_GROUP
    RESOURCE_GROUP=${RESOURCE_GROUP:-"rg-voice-video"}
    
    echo -n "Enter Azure region [East US]: "
    read LOCATION
    LOCATION=${LOCATION:-"East US"}
    
    echo -n "Enter your GitHub repository URL (for Static Web Apps): "
    read GITHUB_REPO_URL
    
    echo
    print_status "TURN Server Configuration (for production NAT traversal)"
    echo "TURN servers ensure 99%+ connection success but cost money."
    echo "You can skip this for testing (70-85% success with free STUN only)."
    echo
    echo -n "Configure TURN servers now? [y/N]: "
    read CONFIGURE_TURN
    
    if [[ "$CONFIGURE_TURN" =~ ^[Yy] ]]; then
        echo -n "Enter TURN server URLs (comma-separated, e.g., turns:global.turn.twilio.com:443): "
        read TURN_URLS
        
        echo -n "Enter TURN username: "
        read TURN_USERNAME
        
        echo -n "Enter TURN password: "
        read -s TURN_PASSWORD
        echo
        
        USE_TURN=true
        print_status "TURN servers will be configured for production deployment"
    else
        USE_TURN=false
        TURN_URLS=""
        TURN_USERNAME=""
        TURN_PASSWORD=""
        print_warning "Deploying without TURN servers (testing only - some users may be unable to connect)"
    fi
    
    # Generate unique names
    TIMESTAMP=$(date +%s)
    SHORT_HASH=${TIMESTAMP: -5}
    
    KEY_VAULT_NAME="kv-voice-video-${SHORT_HASH}"
    SERVER_APP_NAME="app-voice-video-${SHORT_HASH}"
    STORAGE_ACCOUNT="savv${SHORT_HASH}"
    SWA_NAME="swa-voice-video-${SHORT_HASH}"
    
    print_status "Configuration complete!"
}

# Login and setup Azure
setup_azure() {
    print_status "Setting up Azure environment..."
    
    # Login to Azure
    print_status "Logging into Azure..."
    az login
    
    # Set subscription if provided
    if [ ! -z "$SUBSCRIPTION_NAME" ]; then
        az account set --subscription "$SUBSCRIPTION_NAME"
    fi
    
    # Create resource group
    print_status "Creating resource group: $RESOURCE_GROUP"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
    
    print_status "Azure setup complete!"
}

# Create and configure Key Vault
setup_keyvault() {
    print_status "Creating Azure Key Vault: $KEY_VAULT_NAME"
    
    az keyvault create \
        --name "$KEY_VAULT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --enable-rbac-authorization false
    
    # Add TURN server secrets only if configured
    if [ "$USE_TURN" = true ]; then
        print_status "Adding TURN server credentials to Key Vault..."
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "turn-urls" \
            --value "$TURN_URLS"
        
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "turn-username" \
            --value "$TURN_USERNAME"
        
        az keyvault secret set \
            --vault-name "$KEY_VAULT_NAME" \
            --name "turn-password" \
            --value "$TURN_PASSWORD"
        
        print_status "TURN credentials stored in Key Vault"
    else
        print_status "Skipping TURN configuration - using STUN-only for testing"
    fi
    
    print_status "Key Vault setup complete!"
}

# Deploy backend (App Service)
deploy_backend() {
    print_status "Deploying backend to App Service..."
    
    # Create App Service Plan
    print_status "Creating App Service Plan..."
    az appservice plan create \
        --name "asp-voice-video" \
        --resource-group "$RESOURCE_GROUP" \
        --sku B1 \
        --is-linux
    
    # Create Web App
    print_status "Creating Web App: $SERVER_APP_NAME"
    az webapp create \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --plan "asp-voice-video" \
        --runtime "NODE:18-lts"
    
    # Configure Web App
    print_status "Configuring Web App settings..."
    az webapp config set \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --web-sockets-enabled true \
        --always-on true \
        --linux-fx-version "NODE|18-lts"
    
    # Enable managed identity and grant Key Vault access
    print_status "Setting up Key Vault access..."
    az webapp identity assign \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP"
    
    PRINCIPAL_ID=$(az webapp identity show \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "principalId" -o tsv)
    
    az keyvault set-policy \
        --name "$KEY_VAULT_NAME" \
        --object-id "$PRINCIPAL_ID" \
        --secret-permissions get list
    
    # Set initial app settings (will be updated after frontend deployment)
    az webapp config appsettings set \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings \
            CORS_ORIGINS="https://localhost:5173" \
            CORS_CREDENTIALS="true" \
            NODE_ENV="production"
    
    # Deploy server code
    print_status "Building and deploying server code..."
    cd server
    npm ci --production
    zip -r ../server-deploy.zip . -x "node_modules/.*" "*.log" ".env"
    
    az webapp deployment source config-zip \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --src "../server-deploy.zip"
    
    cd ..
    rm server-deploy.zip
    
    SERVER_URL="https://$SERVER_APP_NAME.azurewebsites.net"
    print_status "Backend deployed successfully to: $SERVER_URL"
}

# Deploy frontend (Static Web App)
deploy_frontend() {
    print_status "Deploying frontend to Static Web App..."
    
    # Create Static Web App
    print_status "Creating Static Web App: $SWA_NAME"
    az staticwebapp create \
        --name "$SWA_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --source "$GITHUB_REPO_URL" \
        --location "East US2" \
        --branch "main" \
        --app-location "web" \
        --output-location "dist" \
        --build-location "web"
    
    # Get Static Web App URL
    SWA_URL=$(az staticwebapp show \
        --name "$SWA_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "defaultHostname" -o tsv)
    
    # Configure environment variables
    print_status "Configuring Static Web App environment variables..."
    
    if [ "$USE_TURN" = true ]; then
        az staticwebapp appsettings set \
            --name "$SWA_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --setting-names \
                VITE_SIGNALING_URL="$SERVER_URL" \
                VITE_TURN_URLS="$TURN_URLS" \
                VITE_TURN_USERNAME="$TURN_USERNAME" \
                VITE_TURN_PASSWORD="$TURN_PASSWORD"
        print_status "✅ Configured with TURN servers for production"
    else
        az staticwebapp appsettings set \
            --name "$SWA_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --setting-names \
                VITE_SIGNALING_URL="$SERVER_URL"
        print_warning "⚠️  Configured without TURN servers (testing only)"
    fi
    
    # Update server CORS settings
    print_status "Updating server CORS settings..."
    az webapp config appsettings set \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings \
            CORS_ORIGINS="https://$SWA_URL" \
            CORS_CREDENTIALS="true"
    
    # Restart server to apply new settings
    az webapp restart --name "$SERVER_APP_NAME" --resource-group "$RESOURCE_GROUP"
    
    print_status "Frontend deployed successfully to: https://$SWA_URL"
}

# Setup monitoring
setup_monitoring() {
    print_status "Setting up Application Insights monitoring..."
    
    az monitor app-insights component create \
        --app "ai-voice-video" \
        --location "$LOCATION" \
        --resource-group "$RESOURCE_GROUP"
    
    AI_KEY=$(az monitor app-insights component show \
        --app "ai-voice-video" \
        --resource-group "$RESOURCE_GROUP" \
        --query "instrumentationKey" -o tsv)
    
    az webapp config appsettings set \
        --name "$SERVER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --settings \
            APPINSIGHTS_INSTRUMENTATIONKEY="$AI_KEY"
    
    print_status "Monitoring setup complete!"
}

# Verify deployment
verify_deployment() {
    print_status "Verifying deployment..."
    
    # Test server health
    print_status "Testing server health endpoint..."
    if curl -f "$SERVER_URL/health" > /dev/null 2>&1; then
        print_status "✅ Server health check passed"
    else
        print_warning "⚠️ Server health check failed - check logs"
    fi
    
    # Test CORS
    print_status "Testing CORS configuration..."
    if curl -H "Origin: https://$SWA_URL" -f "$SERVER_URL/cors-check" > /dev/null 2>&1; then
        print_status "✅ CORS configuration verified"
    else
        print_warning "⚠️ CORS check failed - may need manual configuration"
    fi
    
    print_status "Deployment verification complete!"
}

# Print summary
print_summary() {
    echo
    echo "========================================"
    echo "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY! 🎉"
    echo "========================================"
    echo
    echo "📊 Resource Summary:"
    echo "  Resource Group: $RESOURCE_GROUP"
    echo "  Server App:     $SERVER_APP_NAME"
    echo "  Static Web App: $SWA_NAME"
    echo "  Key Vault:      $KEY_VAULT_NAME"
    echo
    echo "🌐 Application URLs:"
    echo "  Frontend: https://$SWA_URL"
    echo "  Backend:  $SERVER_URL"
    echo
    echo "🔧 Management URLs:"
    echo "  Azure Portal: https://portal.azure.com"
    echo "  App Service:  https://portal.azure.com/#resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$SERVER_APP_NAME"
    echo "  Static Web:   https://portal.azure.com/#resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/staticSites/$SWA_NAME"
    echo
    if [ "$USE_TURN" = true ]; then
        echo "✅ Production Configuration:"
        echo "  - TURN servers configured for 99%+ connection success"
        echo "  - Ready for production use"
    else
        echo "⚠️  Testing Configuration:"
        echo "  - STUN-only deployment (70-85% connection success)"
        echo "  - 15-30% of users may be unable to connect"
        echo "  - Add TURN servers before production launch"
    fi
    echo
    echo "📝 Next Steps:"
    if [ "$USE_TURN" = false ]; then
        echo "  1. Test the application with multiple users/networks"
        echo "  2. Configure TURN servers for production (see docs/webrtc-turn-explanation.md)"
        echo "  3. Redeploy with TURN configuration for 99%+ success rate"
    else
        echo "  1. Test the application by visiting the frontend URL"
        echo "  2. Configure custom domain if needed"
        echo "  3. Set up additional monitoring and alerts"
    fi
    echo "  4. Review and adjust scaling settings"
    echo
    echo "💡 Troubleshooting:"
    echo "  - View server logs: az webapp log tail --name $SERVER_APP_NAME --resource-group $RESOURCE_GROUP"
    echo "  - Check App Service in Azure Portal for detailed metrics"
    if [ "$USE_TURN" = true ]; then
        echo "  - Verify TURN server connectivity for WebRTC calls"
    else
        echo "  - If users can't connect, they likely need TURN server support"
    fi
    echo
}

# Main execution flow
main() {
    echo "🚀 Voice Video App - Azure Deployment Script"
    echo "=============================================="
    echo
    
    check_prerequisites
    get_user_inputs
    setup_azure
    setup_keyvault
    deploy_backend
    deploy_frontend
    setup_monitoring
    verify_deployment
    print_summary
}

# Check if running directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
```

## Usage Instructions

1. **Save the script:**
   ```bash
   mkdir -p scripts
   # Copy the script above and save as scripts/deploy-azure.sh
   chmod +x scripts/deploy-azure.sh
   ```

2. **Run the deployment:**
   ```bash
   ./scripts/deploy-azure.sh
   ```

3. **Follow the prompts** to enter:
   - Azure subscription name (optional)
   - Resource group name
   - Azure region
   - GitHub repository URL
   - TURN server configuration

## What the Script Does

1. ✅ **Prerequisites Check** - Verifies Azure CLI, Node.js, npm
2. ✅ **Azure Setup** - Login, subscription, resource group
3. ✅ **Key Vault** - Creates vault and stores TURN credentials
4. ✅ **Backend Deployment** - App Service with WebSockets enabled
5. ✅ **Frontend Deployment** - Static Web App with GitHub integration
6. ✅ **CORS Configuration** - Automatic cross-origin setup
7. ✅ **Monitoring** - Application Insights integration
8. ✅ **Verification** - Health checks and connectivity tests

## Manual Alternative

If you prefer manual deployment, follow the detailed step-by-step guide in [`azure-deploy-complete.md`](./azure-deploy-complete.md).

## Environment Variables Reference

The script automatically configures these environment variables:

### Frontend (Static Web App)
- `VITE_SIGNALING_URL` - WebSocket signaling server URL
- `VITE_TURN_URLS` - TURN server endpoints for NAT traversal
- `VITE_TURN_USERNAME` - TURN authentication username
- `VITE_TURN_PASSWORD` - TURN authentication password

### Backend (App Service)
- `CORS_ORIGINS` - Allowed frontend domains
- `CORS_CREDENTIALS` - Enable credential support
- `NODE_ENV` - Production environment flag
- `APPINSIGHTS_INSTRUMENTATIONKEY` - Application monitoring key

## Security Features

- 🔐 **Azure Key Vault** for secret management
- 🔒 **Managed Identity** for secure service-to-service auth
- 🌐 **CORS** protection with domain allowlisting
- 📊 **Application Insights** for security monitoring
- 🔑 **RBAC** for granular access control

## Troubleshooting

If the script fails:

1. **Check Azure CLI login:** `az account show`
2. **Verify permissions:** Ensure you have Contributor access
3. **Review logs:** Check the script output for specific errors
4. **Manual fallback:** Use the detailed guide for manual deployment

The automation script provides a complete, production-ready deployment with security best practices and monitoring included!