# =============================================================================
# CODA App — Outputs
# =============================================================================

# --- Resource Group ---
output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

# --- Database ---
output "db_fqdn" {
  description = "Postgres server FQDN"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

output "db_connection_string" {
  description = "Postgres connection string (sensitive)"
  value       = "postgresql://${var.db_admin_username}:${var.db_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/coda?sslmode=require"
  sensitive   = true
}

# --- Container Registry ---
output "acr_login_server" {
  description = "ACR login server URL"
  value       = azurerm_container_registry.main.login_server
}

output "acr_admin_username" {
  description = "ACR admin username"
  value       = azurerm_container_registry.main.admin_username
}

# --- Container Apps ---
output "backend_url" {
  description = "Container App backend URL"
  value       = "https://${azurerm_container_app.backend.ingress[0].fqdn}"
}

# --- Static Web App ---
output "frontend_default_hostname" {
  description = "Static Web App default hostname"
  value       = azurerm_static_web_app.production.default_host_name
}

# --- Docker Push Command ---
output "docker_push_command" {
  description = "Command to build and push the backend container"
  value       = <<-EOT
    az acr login --name ${azurerm_container_registry.main.name}
    docker build -t ${azurerm_container_registry.main.login_server}/coda-api:latest -f docker/Dockerfile .
    docker push ${azurerm_container_registry.main.login_server}/coda-api:latest
  EOT
}
