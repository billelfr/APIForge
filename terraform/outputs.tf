output "ec2_instance_id" {
  description = "APIForge EC2 instance ID"
  value       = aws_instance.web.id
}

output "aws_region" {
  description = "AWS region containing the APIForge resources"
  value       = var.aws_region
}

output "ec2_public_ip" {
  description = "Public IPv4 address of the web server"
  value       = aws_instance.web.public_ip
}

output "ec2_public_dns" {
  description = "Public DNS name of the web server"
  value       = aws_instance.web.public_dns
}

output "github_actions_deploy_role_arn" {
  description = "IAM role assumed by GitHub Actions using OIDC"
  value       = aws_iam_role.github_actions_deploy.arn
}

output "ecr_registry" {
  description = "Amazon ECR registry hostname for this account and region"
  value       = split("/", aws_ecr_repository.backend.repository_url)[0]
}

output "ecr_backend_repository_url" {
  description = "Amazon ECR repository URL for the APIForge backend image"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecr_frontend_repository_url" {
  description = "Amazon ECR repository URL for the APIForge frontend image"
  value       = aws_ecr_repository.frontend.repository_url
}