# =============================================================================
# CODA App — Azure Container Registry
# =============================================================================

resource "azurerm_container_registry" "main" {
  name                = "${var.project_name}acr${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true # Needed for Container Apps pull

  tags = local.tags
}
