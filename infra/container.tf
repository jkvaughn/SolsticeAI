# =============================================================================
# CODA App — Azure Container Apps (Backend)
# =============================================================================

# Log Analytics workspace for Container Apps
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${local.name_prefix}-law-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                       = "${local.name_prefix}-cae"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags
}

# Container App — CODA Backend (Hono/Deno)
resource "azurerm_container_app" "backend" {
  name                         = "${local.name_prefix}-api"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.tags

  template {
    min_replicas = var.container_min_replicas
    max_replicas = var.container_max_replicas

    container {
      name   = "coda-api"
      image  = "${azurerm_container_registry.main.login_server}/coda-api:${var.container_image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "DATABASE_URL"
        value = "postgresql://${var.db_admin_username}:${var.db_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/coda?sslmode=require"
      }
      env {
        name  = "GEMINI_API_KEY"
        value = var.gemini_api_key
      }
      env {
        name  = "SOLANA_RPC_URL"
        value = var.solana_rpc_url
      }
      env {
        name  = "SOLANA_CLUSTER"
        value = "mainnet-beta"
      }
      env {
        name  = "SOLANA_EXPLORER_URL"
        value = "https://explorer.solsticenetwork.xyz"
      }
      env {
        name  = "SOLANA_FAUCET_URL"
        value = ""
      }
      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "SUPABASE_SERVICE_ROLE_KEY"
        value = var.supabase_service_role_key
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8000
    transport        = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  registry {
    server               = azurerm_container_registry.main.login_server
    username             = azurerm_container_registry.main.admin_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = azurerm_container_registry.main.admin_password
  }
}
