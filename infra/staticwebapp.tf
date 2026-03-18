# =============================================================================
# CODA App — Azure Static Web App (Production Frontend)
# =============================================================================
#
# NOTE: The staging Static Web App remains in rg-solstice-network.
# This creates the production instance in rg-coda-app.
#
# Custom domain (coda.solsticenetwork.xyz) must be added after deployment:
#   1. Create CNAME record: coda -> <default_hostname>
#   2. az staticwebapp hostname set --name <name> --hostname coda.solsticenetwork.xyz
# =============================================================================

resource "azurerm_static_web_app" "production" {
  name                = "${local.name_prefix}-web"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags

  # GitHub connection is configured via the Azure portal or CLI
  # after the resource is created, as it requires OAuth.
}
