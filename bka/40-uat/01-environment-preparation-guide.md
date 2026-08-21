# ARCNAVE — UAT Environment Preparation Guide

## 1. What testers need

A running instance of ARCNAVE at baseline `v1.0-architecture-conformant`,
with the demo tenant seeded, and five login credentials handed out per
role. No tester needs shell/DB access — this guide is for whoever sets up
the environment, not the testers themselves.

## 2. Setup steps (operator)

1. Check out the tagged baseline:

```bash
git checkout v1.0-architecture-conformant
```

2. Start Postgres (Docker Compose, per this repo's `docker-compose.yml`)
   and the backend's environment variables:

```bash
docker compose up -d db
source backend/.env.local.sh
```

3. Apply migrations:

```bash
cd backend && node scripts/migrate.js up
```

4. Load demo data (safe to re-run — resets the `demo` tenant only):

```bash
docker exec -i arcnave-blueprint-db-1 psql -U arcnave_admin -d arcnave < backend/db/seed-test-data.sql
```

5. Start the backend and frontend:

```bash
cd backend && npm start
cd frontend && npm run dev
```

6. Confirm login works before inviting testers: log in as `principal` /
   `Test@1234`, college code `demo`, and confirm the Dashboard loads.

## 3. Credentials to distribute

College code for every login below: **`demo`**. Password for every login:
**`Test@1234`**.

| Give to tester acting as | Username |
|---|---|
| Principal | `principal` |
| HOD | `hod.cse` |
| Class Tutor | `tutor.cse3a` |
| Class Tutor (timetable not yet approved) | `tutor.cse3b` |
| Staff / Office | `staff.ece` |

Distribute credentials individually, not as a shared sheet all testers see
— testers should not see each other's role script in advance.

## 4. Resetting between test rounds

Re-run the seed script (step 4 above). It deletes and recreates only the
`demo` college, so it is safe to run between rounds without affecting any
other tenant. Re-running resets attendance sessions, fee payment marks, and
any student/document changes testers made — plan reset timing so a tester
doesn't lose their own in-progress task.

## 5. Known environment limitations to brief testers on

- Position Account login does not exist in the UI — testers will only ever
  use the personal-login screen (username, not an email-style position
  address).
- The demo tenant has no Level 2 position and no "Office/Admin" role —
  testers filling an office-staff persona use the `staff.ece` login.
- Attendance can only be marked for CSE-3A (`tutor.cse3a`) — CSE-3B's
  timetable is deliberately left "Pending HOD" so testers can observe the
  lock (see [Task Script — Class Tutor](02-role-based-task-scripts.md), task
  CT-3).

## 6. Support during UAT

Nominate one internal contact per test round who can answer "is this
supposed to happen?" without leading the tester to the intended answer —
UAT value comes from testers' unprompted reactions.
