# Infraestrutura de produção da Pedidos Veloz (esqueleto):
#
#   VPC (3 AZs) ── subnets públicas: load balancer
#              ├─ subnets privadas: nós do EKS
#              └─ subnets de banco: RDS PostgreSQL (sem rota para a internet)
#
# Módulos oficiais da comunidade (terraform-aws-modules): menos código próprio,
# boas práticas já embutidas e versões fixadas.

locals {
  name = "pedidos-veloz-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ------------------------------------------------------------------ rede
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.21"

  name = local.name
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets   = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets  = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 1)]
  database_subnets = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 8, i + 100)]

  enable_nat_gateway     = true
  single_nat_gateway     = var.environment != "production" # economia fora de produção
  one_nat_gateway_per_az = var.environment == "production" # sem ponto único de falha

  create_database_subnet_group = true

  # Tags usadas pelo AWS Load Balancer Controller para descobrir as subnets.
  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}

# ------------------------------------------------------------ Kubernetes
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.37"

  cluster_name    = local.name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = true # restrinja com cluster_endpoint_public_access_cidrs
  enable_cluster_creator_admin_permissions = true

  # Add-ons gerenciados pela AWS.
  cluster_addons = {
    coredns                = {}
    kube-proxy             = {}
    eks-pod-identity-agent = {}
    metrics-server         = {} # fonte de CPU/memória para o HPA

    # VPC CNI com NetworkPolicy habilitada: faz valer k8s/base/network-policies.yaml.
    vpc-cni = {
      configuration_values = jsonencode({ enableNetworkPolicy = "true" })
    }
  }

  eks_managed_node_groups = {
    default = {
      instance_types = var.node_instance_types
      min_size       = var.node_min_size
      max_size       = var.node_max_size
      desired_size   = var.node_min_size
    }
  }
}

# ---------------------------------------------------------- banco de dados
resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL acessivel apenas pelos nos do EKS"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_eks" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = module.eks.node_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_instance" "postgres" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100 # autoscaling de disco
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "postgres"
  username = "pv_admin"
  # Senha gerada e rotacionada pelo RDS no AWS Secrets Manager:
  # nunca aparece no código nem no state do Terraform.
  manage_master_user_password = true

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period         = 7
  deletion_protection             = var.environment == "production"
  skip_final_snapshot             = var.environment != "production"
  final_snapshot_identifier       = "${local.name}-final"
  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  auto_minor_version_upgrade      = true
}
