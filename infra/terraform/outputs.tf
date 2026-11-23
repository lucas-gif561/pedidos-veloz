output "cluster_name" {
  description = "Nome do cluster EKS (aws eks update-kubeconfig --name ...)"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint da API do Kubernetes"
  value       = module.eks.cluster_endpoint
}

output "db_endpoint" {
  description = "Host do PostgreSQL: vai para a variável DB_HOST do environment production no GitHub"
  value       = aws_db_instance.postgres.address
}

output "db_master_secret_arn" {
  description = "ARN do segredo (Secrets Manager) com a senha do usuário administrador do RDS"
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}
