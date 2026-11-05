# Deploying subsidydropoff.com

## Status

Cloudflare Pages serves `subsidydropoff.com` from `main`. A push to the separate
repository default branch, `claude/aca-marketplace-subsidy-estimator-xaujqu`, matches the workflow’s `claude/aca-marketplace-subsidy-estimator-**` push trigger and creates a branch preview. Promote a reviewed revision
to `main` to release it. The existing weekly job checks out `main`, verifies it,
and refreshes the production data from that exact commit.

## One-time setup

### 1. Create the Cloudflare API token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**.

| Setting | Value |
|---|---|
| Permissions | `Account` → `Cloudflare Pages` → **Edit** |
| Account Resources | Include → your account |

Copy the token. It is shown once.

### 2. Add repository secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar |

### 3. Trigger the first deploy

Push to a release branch, or run the workflow manually:

```
GitHub → Actions → "Deploy to Cloudflare Pages" → Run workflow
```

The workflow creates the Pages project (`subsidy-dropoff`) on first run. It will
typecheck, run the test suite, pull the CMS public use files, derive benchmark shards,
refuse to proceed if synthetic fixture data is present, and deploy.

### 4. Attach the domain

Cloudflare dashboard → **Workers & Pages → subsidy-dropoff → Custom domains →
Set up a custom domain**. Add both:

- `subsidydropoff.com`
- `www.subsidydropoff.com`

DNS is created automatically because the zone is already in the same Cloudflare
account. `public/_redirects` collapses `www` onto the apex with a 301, so search
engines see one canonical origin.

## Why the ETL runs in CI rather than being committed

GitHub runners have the outbound access to CMS that the authoring environment lacked.
Running the ETL in the pipeline means:

- Premium data is rebuilt from the published files on every deploy, so it cannot
  silently drift from source.
- The weekly `schedule` trigger picks up CMS's in-year revisions without anyone
  remembering to do it.
- A new plan year requires a reviewed, year-specific source registry before it can ship.

Both `npm run build` for Next.js and the Pages release workflow run `npm run benchmarks:prepare`. The version-controlled snapshot is historical. To refresh a local checkout or development server, run the same preparation command. To verify a prepared directory separately, use `npm run etl:verify -- public/data 2026`.

The workflow builds into an empty temporary directory. It promotes the dataset only after every listed shard passes integrity and source checks. A failed or empty refresh preserves the prior deployment.

## Manual deploy

```bash
npx wrangler login &&
npm ci &&
npm run typecheck && npm run engine:typecheck && npm run check:security-floor && npm test &&
npm run check:production &&
npx wrangler pages deploy public --project-name=subsidy-dropoff --branch=main
```

## Verifying a deploy

```bash
curl -s https://subsidydropoff.com/api/health

curl -s "https://subsidydropoff.com/api/estimate?planYear=2026&zip=77002&householdSize=2&income=80000&ages=60,58"
```

`/api/health` should return `{"ok":true,...}`. The estimate should return
`"ok": true` with a real `benchmark.monthlySlcsp`. If it returns
`"reason": "dataset-not-loaded"`, the ETL step did not produce shards — check that
job's log.

Then confirm the security headers landed:

```bash
curl -sI https://subsidydropoff.com | grep -iE 'content-security-policy|strict-transport'
```

## Before you call it launched

- [x] Verify the 2027 IRS table and all three regional HHS poverty guidelines against published sources (see ACCURACY.md).
- [ ] Spot-check ten PUF-derived benchmarks against HealthCare.gov window shopping,
      target ±$2/month
- [ ] Confirm the disclaimer renders above the fold on mobile
- [ ] Re-check the plan year 2027 open-enrollment end date — vacated 2026-06-12 in
      *City of Columbus v. Kennedy*, currently on appeal to the Fourth Circuit
