bucket       = "lojaveloz-terraform-state"
key          = "pedidos-veloz/production.tfstate"
region       = "sa-east-1"
encrypt      = true
use_lockfile = true # lock nativo no S3 (Terraform >= 1.10), sem precisar de DynamoDB
