#!/usr/bin/env bash
# Deploys the built Sites artifact to your own Cloudflare account.
#
# The vinext build already emits a complete Worker config at
# dist/server/wrangler.json, but with placeholder resource identifiers. This
# script patches in the real ones and hands the result to wrangler, so the
# generated file is never edited by hand and survives every rebuild.
#
# Configure once by copying deploy.env.example to deploy.env and filling it in.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

if [[ -f deploy.env ]]; then
  # shellcheck disable=SC1091
  source deploy.env
fi

: "${WORKER_NAME:?Set WORKER_NAME in deploy.env}"
: "${D1_DATABASE_NAME:?Set D1_DATABASE_NAME in deploy.env}"
: "${D1_DATABASE_ID:?Set D1_DATABASE_ID in deploy.env (from: wrangler d1 create <name>)}"
: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME in deploy.env}"

wrangler="${project_root}/node_modules/.bin/wrangler"
[[ -x "${wrangler}" ]] || { echo "wrangler is missing. Run npm ci first." >&2; exit 69; }

echo "==> Building"
npm run build

generated="dist/server/wrangler.json"
[[ -f "${generated}" ]] || { echo "Missing ${generated}. The build did not complete." >&2; exit 66; }

echo "==> Patching resource identifiers into ${generated}"
node --input-type=module - "${generated}" <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const [configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));

config.name = process.env.WORKER_NAME;
config.topLevelName = process.env.WORKER_NAME;

const d1 = config.d1_databases?.find((entry) => entry.binding === "DB");
if (!d1) throw new Error("The generated config has no D1 binding named DB.");
d1.database_name = process.env.D1_DATABASE_NAME;
d1.database_id = process.env.D1_DATABASE_ID;

const r2 = config.r2_buckets?.find((entry) => entry.binding === "BUCKET");
if (!r2) throw new Error("The generated config has no R2 binding named BUCKET.");
r2.bucket_name = process.env.R2_BUCKET_NAME;

// Point wrangler's own migration tracking at the drizzle output. It records
// what it has already run in a d1_migrations table, so re-deploying only
// applies what is new. Relative to this config file, which lives in dist/server.
d1.migrations_dir = "../../drizzle";

await writeFile(configPath, JSON.stringify(config, null, 2));
console.log(`   worker=${config.name} d1=${d1.database_name} r2=${r2.bucket_name}`);
NODE

# The platform this app was built for applies drizzle/*.sql itself; a plain
# Cloudflare account does not. Apply anything pending before the new code
# starts serving requests against an older schema.
echo "==> Applying pending D1 migrations"
"${wrangler}" d1 migrations apply "${D1_DATABASE_NAME}" \
  --remote \
  --config="${generated}"

echo "==> Deploying"
"${wrangler}" deploy --config="${generated}"

echo
echo "Deployed. Set the Supabase variables once, if you have not already:"
echo "  npx wrangler secret put SUPABASE_URL --name ${WORKER_NAME}"
echo "  npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --name ${WORKER_NAME}"
