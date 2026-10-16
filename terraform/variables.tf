variable "aws_region" {
  description = "AWS region for APIForge infrastructure"
  type        = string
  default     = "eu-north-1"
}

variable "my_ip" {
  description = "Your public IPv4 address allowed to access the development instance over SSH and HTTP"
  type        = string
  sensitive   = true
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deployment role, in owner/name format"
  type        = string
  default     = "billelfr/APIForge"

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must be in owner/name format."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable numeric GitHub owner ID used in GitHub OIDC subject claims"
  type        = string
  default     = "190740351"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must contain only digits."
  }
}

variable "github_repository_id" {
  description = "Immutable numeric GitHub repository ID used in GitHub OIDC subject claims"
  type        = string
  default     = "1421551217"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must contain only digits."
  }
}