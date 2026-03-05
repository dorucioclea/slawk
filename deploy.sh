#!/bin/bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────
# Set these environment variables before running:
#   GCP_PROJECT_ID   - your GCP project ID
#   DATABASE_URL     - Cloud SQL connection string
#   JWT_SECRET       - secret for JWT signing
#   GCS_BUCKET_NAME  - GCS bucket for file uploads
#   RUN_SEED         - "true" for first deploy, "false" after

GCP_PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-slawk}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-${GCP_PROJECT_ID}:${REGION}:slawk-db}"

DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL}"
JWT_SECRET="${JWT_SECRET:?Set JWT_SECRET}"
GCS_BUCKET_NAME="${GCS_BUCKET_NAME:-slawk-uploads-${GCP_PROJECT_ID}}"
RUN_SEED="${RUN_SEED:-false}"

echo "Deploying ${SERVICE_NAME} to Cloud Run..."
echo "  Project:  ${GCP_PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  SQL:      ${CLOUD_SQL_INSTANCE}"
echo "  Bucket:   ${GCS_BUCKET_NAME}"
echo "  Seed:     ${RUN_SEED}"
echo ""

# ── Ensure GCS bucket exists and has correct permissions ─────────────
echo "Ensuring GCS bucket gs://${GCS_BUCKET_NAME} exists..."
if ! gcloud storage buckets describe "gs://${GCS_BUCKET_NAME}" --project "${GCP_PROJECT_ID}" &>/dev/null; then
  echo "  Creating bucket gs://${GCS_BUCKET_NAME}..."
  gcloud storage buckets create "gs://${GCS_BUCKET_NAME}" \
    --project "${GCP_PROJECT_ID}" \
    --location "${REGION}" \
    --uniform-bucket-level-access
else
  echo "  Bucket already exists."
fi

# Grant the Cloud Run default service account access to the bucket
SA_EMAIL="${GCP_PROJECT_ID}@appspot.gserviceaccount.com"
# Try compute default SA if App Engine SA doesn't exist
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project "${GCP_PROJECT_ID}" &>/dev/null; then
  PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')
  SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
echo "  Granting storage access to ${SA_EMAIL}..."
gcloud storage buckets add-iam-policy-binding "gs://${GCS_BUCKET_NAME}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --project "${GCP_PROJECT_ID}" 2>/dev/null || true
echo "  GCS bucket ready."
echo ""

# ── Deploy to Cloud Run ──────────────────────────────────────────────
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${GCP_PROJECT_ID}" \
  --region "${REGION}" \
  --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
  --set-env-vars "DATABASE_URL=${DATABASE_URL}" \
  --set-env-vars "JWT_SECRET=${JWT_SECRET}" \
  --set-env-vars "GCS_BUCKET_NAME=${GCS_BUCKET_NAME}" \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "RUN_SEED=${RUN_SEED}" \
  --timeout 3600 \
  --session-affinity \
  --min-instances 0 \
  --max-instances 3 \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated

echo ""
echo "Deploy complete! Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --project "${GCP_PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)'
