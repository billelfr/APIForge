variable "aws_region" {
  description = "AWS region for APIForge infrastructure"
  type        = string
  default     = "eu-north-1"
}

variable "my_ip" {
  description = "Your public IPv4 address for SSH access"
  type        = string
  sensitive   = true
}