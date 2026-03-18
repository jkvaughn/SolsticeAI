# =============================================================================
# CODA App — Azure Postgres Flexible Server
# =============================================================================

resource "random_string" "db_suffix" {
  length  = 8
  lower   = true
  upper   = false
  special = false
  numeric = true
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "${local.name_prefix}-pgdb-${random_string.db_suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = "westus3" # Postgres restricted in westus2; westus AZ1 unavailable
  version                       = var.db_version
  administrator_login           = var.db_admin_username
  administrator_password        = var.db_admin_password
  sku_name                      = var.db_sku
  storage_mb                    = var.db_storage_mb
  backup_retention_days         = 7
  geo_redundant_backup_enabled  = false
  zone                          = "1"
  public_network_access_enabled = true # Restrict via firewall rules below

  tags = local.tags
}

# Default database for CODA
resource "azurerm_postgresql_flexible_server_database" "coda" {
  name      = "coda"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# --- Firewall Rules ---

# Allow Azure services (Container Apps, Static Web Apps)
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Allow current developer IP (update as needed)
# To find your IP: curl -s https://ifconfig.me
resource "azurerm_postgresql_flexible_server_firewall_rule" "dev_access" {
  name             = "DevAccess"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "255.255.255.255"

  lifecycle {
    # This rule is intentionally broad for initial setup.
    # Tighten to specific IPs before production launch.
    ignore_changes = [start_ip_address, end_ip_address]
  }
}
