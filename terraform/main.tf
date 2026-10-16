terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "apiforge-vpc"
    Environment = "dev"
    Project     = "APIForge"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "eu-north-1a"
  map_public_ip_on_launch = true

  tags = {
    Name        = "apiforge-public-subnet"
    Environment = "dev"
    Project     = "APIForge"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name        = "apiforge-igw"
    Environment = "dev"
    Project     = "APIForge"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name        = "apiforge-public-rt"
    Environment = "dev"
    Project     = "APIForge"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web" {
  name        = "apiforge-web-sg"
  description = "Allow SSH from my IP and HTTP from the internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH from my IP only"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["${var.my_ip}/32"]
  }

  ingress {
    description = "HTTP from my IP only (local-development deployment)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["${var.my_ip}/32"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "apiforge-web-sg"
    Environment = "dev"
    Project     = "APIForge"
  }
}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

data "aws_caller_identity" "current" {}

resource "aws_ecr_repository" "backend" {
  name                 = "apiforge-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = "APIForge"
    Environment = "dev"
  }
}

resource "aws_ecr_repository" "frontend" {
  name                 = "apiforge-frontend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = "APIForge"
    Environment = "dev"
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_actions_deploy" {
  name = "apiforge-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/main"
        }
      }
    }]
  })

  tags = {
    Project = "APIForge"
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "apiforge-github-actions-deploy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "PushAPIForgeImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = [
          aws_ecr_repository.backend.arn,
          aws_ecr_repository.frontend.arn
        ]
      },
      {
        Sid    = "DeployToAPIForgeInstance"
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
          "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.web.id}"
        ]
      },
      {
        Sid      = "ReadDeploymentCommand"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "ec2_ssm" {
  name = "apiforge-ec2-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Project = "APIForge"
  }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_ecr_pull" {
  name = "apiforge-ec2-ecr-pull"
  role = aws_iam_role.ec2_ssm.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuthorization"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "PullAPIForgeImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = [
          aws_ecr_repository.backend.arn,
          aws_ecr_repository.frontend.arn
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "apiforge-ec2-profile"
  role = aws_iam_role.ec2_ssm.name
}

resource "aws_instance" "web" {
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.web.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  associate_public_ip_address = true

  user_data = <<-EOF
    #!/bin/bash
    set -e
    dnf install -y docker nginx curl awscli
    systemctl enable --now docker nginx

    install -d -m 0755 /usr/local/lib/docker/cli-plugins
    curl -fsSL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose

    cat > /etc/nginx/conf.d/default.conf <<'NGINX'
    server {
        listen 80 default_server;
        server_name _;

        location /api/ {
            proxy_pass http://127.0.0.1:4000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location ~ ^/(health/(live|ready)|metrics)$ {
            proxy_pass http://127.0.0.1:4000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
    NGINX

    nginx -t
    systemctl reload nginx
  EOF

  tags = {
    Name        = "apiforge-web-server"
    Environment = "dev"
    Project     = "APIForge"
  }

  depends_on = [
    aws_iam_role_policy_attachment.ssm,
    aws_iam_role_policy.ec2_ecr_pull
  ]
}