# APIForge

APIForge is a small, local-first REST API client and DevOps portfolio workload. It provides a browser UI for sending HTTP requests, saving request definitions in PostgreSQL, and operating the service with health endpoints and Prometheus-compatible metrics.

> **Local use only:** This initial version is intended for local development. Do not expose it publicly without adding appropriate authentication, authorization, rate limiting, and security controls. The request proxy can reach public internet hosts and must not be exposed publicly without thorough security testing.

## Architecture

- **Frontend:** Next.js and TypeScript on port 3000.
- **Backend:** Node.js, Express, and TypeScript on port 4000.
- **Database:** PostgreSQL with Prisma migrations.
- The frontend calls the backend directly from the browser. Compose binds both web services to `127.0.0.1`; PostgreSQL is only available on the internal Compose network.
- The backend accepts only HTTP/HTTPS outbound requests, rejects non-public DNS/IP destinations, connects to the vetted IP address directly, and does not follow redirects.
- Saved requests omit the bearer-token field and common authentication/cookie headers. URLs, query parameters, custom headers, and request bodies are otherwise stored in PostgreSQL; do not save credentials in those fields.

## Prerequisites

- Docker Engine and Docker Compose plugin, or
- Node.js 22+, npm, and a PostgreSQL 16+ server.

No dependency installation has been run as part of preparing this repository.

## Start with Docker Compose

```sh
cp .env.example .env
docker compose up --build
```

The backend runs `prisma migrate deploy` before starting. In a second terminal, optionally load the sample collection:

```sh
docker compose exec backend npm run db:seed
```

Open <http://localhost:3000>. To stop the services, run `docker compose down`; the `postgres_data` volume remains. To remove the database volume and its data, run `docker compose down -v`.

## Local development with a Docker database

Install Node.js dependencies from the repository root. The PostgreSQL database itself runs in Docker and is exposed to host commands on `127.0.0.1:5432`, matching `DATABASE_URL` in `.env`; a local PostgreSQL installation is not needed:

```sh
cp .env.example .env
npm install
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

The root development command starts the application services. The frontend listens on `FRONTEND_PORT` (default `3000`) and the backend listens on `PORT` (default `4000`); these are separate settings. The root command loads `.env` for both processes, so the frontend script explicitly reads `FRONTEND_PORT` instead of inheriting the backend's `PORT`. Do not use `PORT` to configure the frontend. `DATABASE_URL` and the other backend settings are read from the root `.env`; the frontend browser API URL is configured with `NEXT_PUBLIC_API_URL`. If port 5432 is already occupied, change `POSTGRES_PORT` and update the host port in `DATABASE_URL` to match. The backend container connects to PostgreSQL using the internal Compose hostname `db`.

## Migrations

Create and apply the checked-in initial migration in a new database:

```sh
npm run db:migrate
```

When changing the Prisma schema during development, create a migration with:

```sh
npm run db:migrate:dev -- --name describe_change
```

Compose applies committed migrations automatically when the backend starts.

## Verification

```sh
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run build
```

Tests use Vitest and cover URL safety and the live health endpoint.

## Health and metrics

- Liveness: <http://localhost:4000/health/live>
- Readiness (includes a database check): <http://localhost:4000/health/ready>
- Prometheus metrics: <http://localhost:4000/metrics>

The metrics endpoint reports HTTP request counts by method and status class, duration histograms by method, and error counts by method. Labels are bounded and do not contain URLs, user data, or credentials.

## Troubleshooting

- **Backend does not start:** Check that `DATABASE_URL` points to the Compose database (`db`) when running in Compose, and that the PostgreSQL health check passes.
- **Readiness is unhealthy:** Inspect `docker compose logs backend db`; migrations are applied during backend startup.
- **Browser cannot reach the API:** Keep `NEXT_PUBLIC_API_URL` set to `http://localhost:4000` for local browser access and check `CORS_ORIGIN` matches the frontend origin. Rebuild the frontend after changing its public environment value.
- **Outbound request is rejected:** APIForge blocks private, loopback, link-local, reserved, and metadata destinations, including DNS names that resolve to any such address. Redirects are intentionally not followed.
- **Frontend reports `EADDRINUSE` on port 4000:** The frontend must use `FRONTEND_PORT` (default `3000`); `PORT=4000` is for the backend. Set a free `FRONTEND_PORT` in `.env`. If changing the frontend port, update `CORS_ORIGIN` to `http://localhost:<frontend-port>`; the backend URL in `NEXT_PUBLIC_API_URL` remains on the backend port.
- **Port conflict:** Change `FRONTEND_PORT` for the frontend or `BACKEND_PORT` for the Compose host mapping. If changing the backend's listening port for local development, update `PORT` and `NEXT_PUBLIC_API_URL`. `CORS_ORIGIN` must match the frontend's origin, so update it when changing the frontend port.

## Environment variables

| Variable | Default in `.env.example` | Purpose |
| --- | --- | --- |
| `POSTGRES_DB` | `apiforge` | Compose database name |
| `POSTGRES_USER` | `apiforge` | Compose database user |
| `POSTGRES_PASSWORD` | `local-dev-only-change-me` | Local-only database password; change it for your environment |
| `POSTGRES_PORT` | `5432` | Host port mapped to the Compose PostgreSQL container |
| `DATABASE_URL` | Local PostgreSQL URL; Compose uses its internal `db` service | Prisma database connection |
| `FRONTEND_PORT` | `3000` | Frontend listening port in local development and host port for the Compose web UI |
| `BACKEND_PORT` | `4000` | Host port for the local API |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend URL used by the browser |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed frontend origin |
| `REQUEST_TIMEOUT_MS` | `10000` | Maximum outbound request duration |
| `MAX_REQUEST_BYTES` | `1048576` | Maximum inbound API request body size |
| `MAX_RESPONSE_BYTES` | `1048576` | Maximum outbound response body size |
| `PORT` | `4000` | Backend listening port (used by the backend process in local development and inside its container) |
| `HOST` | `0.0.0.0` | Backend bind address inside its container |
| `NODE_ENV` | `development` | Runtime environment |
| `LOG_LEVEL` | `info` | Structured log level |

The sample credentials are for local development only. Do not reuse them for a publicly reachable deployment.

## GitHub Actions deployment to the development EC2 instance

The `Deploy APIForge` workflow runs on pushes to `main` or by manual dispatch. It runs lint, type checking, tests, and builds; builds and pushes commit-tagged backend and frontend images to ECR; then uses GitHub OIDC and Systems Manager (SSM) to deploy them. It does not use long-lived AWS access keys or SSH from GitHub-hosted runners.

This is a **development-only deployment**, not a production release setup. Terraform restricts HTTP and SSH ingress to the `my_ip` address. Keep the application private: it has no user authentication, serves HTTP without TLS, and includes an outbound request proxy. Do not change the security group to allow public access without adding and testing suitable security controls.

### One-time setup

1. Copy `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars`, set `my_ip` to your public IPv4 address without a `/32` suffix, and set the correct `github_repository` if deploying a fork.
2. Apply the Terraform configuration (this provisions resources and can incur AWS charges):

   ```sh
   cd terraform
   terraform init
   terraform apply
   ```

   Terraform creates the EC2 instance profile, GitHub OIDC provider and deploy role, two ECR repositories, and installs Docker/Compose and Nginx on the instance. On first deployment, the workflow generates a random database password on the instance. If the AWS account already has the GitHub Actions OIDC provider, import it into this Terraform state before applying:

   ```sh
   terraform import aws_iam_openid_connect_provider.github arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com
   ```

3. In GitHub, open **Settings → Secrets and variables → Actions → Variables** and add these repository variables from Terraform outputs:

   | Variable | Value |
   | --- | --- |
   | `AWS_REGION` | Optional override; default is `eu-north-1` (the Terraform default). Set it to `terraform output -raw aws_region` if you changed the Terraform region. |
   | `AWS_DEPLOY_ROLE_ARN` | `terraform output -raw github_actions_deploy_role_arn` |
   | `EC2_INSTANCE_ID` | `terraform output -raw ec2_instance_id` |
   | `ECR_BACKEND_REPOSITORY` | `terraform output -raw ecr_backend_repository_url` |
   | `ECR_FRONTEND_REPOSITORY` | `terraform output -raw ecr_frontend_repository_url` |

   These are configuration values, not credentials. No AWS access-key secrets are needed. The OIDC role trust is limited to pushes and manual runs from the configured repository's `main` branch.

### Deploy and access

Push a commit to `main`, or manually run **Deploy APIForge** from the Actions tab while selecting `main`. The workflow deploys the exact commit's immutable images via SSM. Nginx on EC2 routes the UI to the frontend container and `/api`, `/health`, and `/metrics` to the backend; containers bind only to loopback. PostgreSQL data is kept in the Docker volume, and the instance's randomly generated database password is stored in `/opt/apiforge/.env` with restrictive file permissions.

Use `terraform output -raw ec2_public_ip` to find the instance address, then open `http://<ec2-public-ip>`. Because ingress is restricted to `my_ip`, access is limited to the IPv4 address configured in Terraform. To change it, update `my_ip` and apply Terraform again.

This deployment is intentionally separate from the local Compose setup. The workflow and deployment configuration have been added but have **not** been run as part of this change.
