# =============================================================================
# CODA App — Terraform Remote State
# =============================================================================
#
# State is stored in Azure Blob Storage with locking.
# The storage account is bootstrapped before first `terraform init`:
#
#   az storage account create \
#     --name codatfstate<suffix> \
#     --resource-group rg-coda-app \
#     --location westus2 \
#     --sku Standard_LRS \
#     --encryption-services blob
#
#   az storage container create \
#     --name tfstate \
#     --account-name codatfstate<suffix>
#
# Then uncomment the backend block below and run `terraform init`.
# =============================================================================

# terraform {
#   backend "azurerm" {
#     resource_group_name  = "rg-coda-app"
#     storage_account_name = "codatfstate"  # Update with actual name
#     container_name       = "tfstate"
#     key                  = "coda-app.tfstate"
#   }
# }
