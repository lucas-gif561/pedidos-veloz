variable "environment" {
  description = "Nome do ambiente (staging, production)"
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment deve ser staging ou production."
  }
}

variable "region" {
  description = "Região AWS"
  type        = string
  default     = "sa-east-1" # São Paulo: menor latência para clientes no Brasil
}

variable "vpc_cidr" {
  description = "Faixa de IPs da VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "kubernetes_version" {
  description = "Versão do Kubernetes no EKS"
  type        = string
  default     = "1.33"
}

variable "node_instance_types" {
  description = "Tipos de instância dos nós (lista: permite fallback em Spot)"
  type        = list(string)
  default     = ["t3.large"]
}

variable "node_min_size" {
  description = "Mínimo de nós (o Cluster Autoscaler/Karpenter escala dentro do intervalo)"
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Máximo de nós: teto de custo no pico da campanha"
  type        = number
  default     = 6
}

variable "db_instance_class" {
  description = "Classe da instância RDS"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Réplica síncrona em outra AZ (failover automático)"
  type        = bool
  default     = true
}
