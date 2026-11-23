terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }

  # State remoto e com lock: o time inteiro (e o pipeline) enxerga o mesmo
  # estado, e dois `apply` simultâneos não corrompem a infraestrutura.
  # Os valores ficam por ambiente:  terraform init -backend-config=environments/production.backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "pedidos-veloz"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
