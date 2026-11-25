# Deploying the live demo

Render runs the app, Neon holds the database. Both have free tiers that are
enough for judging. About 20 minutes end to end.

## 1. Database on Neon

1. Sign in at neon.tech, create a project (region: Singapore, closest to
   Pakistan), Postgres 16.
2. Copy the **pooled** connection string. It looks like
   `postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
3. Nothing else to set up: `btree_gist` is available on Neon and the first
   migration enables it.

## 2. App on Render

1. Sign in at render.com with GitHub, **New → Blueprint**, pick
   `ahmedmalik07/cye_hacks`. Render reads `render.yaml`.
2. When asked, set:
   - `DATABASE_URL`: the Neon string from step 1.
   - `NEXT_PUBLIC_APP_URL`: `https://<service-name>.onrender.com` (guest links
     in WhatsApp messages use it).
   - `AUTH_SECRET` and `CRON_SECRET` are generated for you.
3. Deploy. The build runs `prisma migrate deploy`, so the tables and the
   no-overlap constraint are created on the first deploy.

## 3. Seed the demo restaurant

From your laptop, against the Neon database (one time, and again on the
morning of the demo so "tonight" is tonight):

```bash
DATABASE_URL="<neon string>" SEED_ALLOW_REMOTE=1 npm run db:seed
```

## 4. Keep it awake and ticking

Render's free web service sleeps after 15 minutes idle and takes about 50 s
to wake. While awake it runs the job queue and the no-show sweep itself
every 30 s. To keep it awake during judging and run the sweep even when no
one is looking, add a free scheduler (cron-job.org) that calls every
5 minutes:

```
POST https://<service-name>.onrender.com/api/cron/tick
Authorization: Bearer <CRON_SECRET from Render's environment tab>
```

Open the site a minute before presenting so it is warm.

## 5. Check before submitting

- `/` loads, **Open the host screen** → sign in with the Owner demo button.
- `/floor` shows the Saffron Courtyard room with tables in different states.
- `/r/saffron-courtyard/reserve` books a table for tomorrow and shows a code.
- `/r/saffron-courtyard/waitlist` on a phone joins the queue.

## Optional: WhatsApp Cloud API

Without it, every message waits on the host screen as a one-tap `wa.me`
link, which is the right demo mode. To send automatically, create a Meta
WhatsApp Business app, get a permanent token and phone number id, approve a
utility template named `mezbaan_guest_update` with one body parameter, and
set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` on Render.

## Alternative: Vercel

Works too (import the repo, same environment variables, build command
`npx prisma migrate deploy && npm run build`). Vercel has no long-lived
process, so the cron call in step 4 is required for reminders and no-show
release.
