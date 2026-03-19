# =============================================================================
# CODA App — Variables
# =============================================================================

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "coda"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "location" {
  description = "Azure region — colocated with Solstice Network validators"
  type        = string
  default     = "westus2"
}

variable "resource_group_name" {
  description = "Resource group name"
  type        = string
  default     = "rg-coda-app"
}

variable "tags" {
  description = "Additional tags to merge with defaults"
  type        = map(string)
  default     = {}
}

# --- Database ---

variable "db_sku" {
  description = "Postgres Flexible Server SKU"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "db_storage_mb" {
  description = "Postgres storage in MB"
  type        = number
  default     = 32768 # 32 GB
}

variable "db_version" {
  description = "PostgreSQL version"
  type        = string
  default     = "16"
}

variable "db_admin_username" {
  description = "Postgres admin username"
  type        = string
  default     = "codaadmin"
}

variable "db_admin_password" {
  description = "Postgres admin password"
  type        = string
  sensitive   = true
}

# --- Container Apps ---

variable "container_image_tag" {
  description = "Container image tag for backend"
  type        = string
  default     = "latest"
}

variable "container_min_replicas" {
  description = "Minimum container replicas (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "container_max_replicas" {
  description = "Maximum container replicas"
  type        = number
  default     = 3
}

# --- Secrets (set via TF_VAR_* env vars or tfvars file) ---

variable "gemini_api_key" {
  description = "Google Gemini API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "solana_rpc_url" {
  description = "Solana RPC URL — defaults to Solstice Network"
  type        = string
  default     = "https://rpc.solsticenetwork.xyz"
}

# --- Supabase (used by backend for DB access and KV store) ---

variable "supabase_url" {
  description = "Supabase project URL (e.g. https://xxx.supabase.co)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "supabase_service_role_key" {
  description = "Supabase service role key for admin DB operations"
  type        = string
  sensitive   = true
  default     = ""
}
