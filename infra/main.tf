# =============================================================================
# CODA App — Root Configuration
# =============================================================================

locals {
  default_tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
    application = "coda-agentic-payments"
  }
  tags = merge(local.default_tags, var.tags)

  # Resource naming: {project}-{environment}-{resource}
  name_prefix = "${var.project_name}-${var.environment}"
}

# Current Azure client
data "azurerm_client_config" "current" {}

# Random suffix for globally unique names (ACR, storage)
resource "random_string" "suffix" {
  length  = 6
  lower   = true
  upper   = false
  special = false
  numeric = true
}

# -----------------------------------------------------------------------------
# Resource Group
# -----------------------------------------------------------------------------

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}
