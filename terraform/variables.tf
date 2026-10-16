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