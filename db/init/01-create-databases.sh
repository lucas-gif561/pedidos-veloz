#!/bin/sh
# Executado pelo container do Postgres só na primeira inicialização (volume vazio).
# Database-per-service: cada microsserviço tem o próprio banco e usuário, sem
# acesso às tabelas do outro. Mesmo dividindo a instância, os dados ficam isolados.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v orders_pw="$ORDERS_DB_PASSWORD" -v inventory_pw="$INVENTORY_DB_PASSWORD" <<-'EOSQL'
	CREATE ROLE orders LOGIN PASSWORD :'orders_pw';
	CREATE DATABASE orders OWNER orders;
	REVOKE ALL ON DATABASE orders FROM PUBLIC;

	CREATE ROLE inventory LOGIN PASSWORD :'inventory_pw';
	CREATE DATABASE inventory OWNER inventory;
	REVOKE ALL ON DATABASE inventory FROM PUBLIC;
EOSQL
