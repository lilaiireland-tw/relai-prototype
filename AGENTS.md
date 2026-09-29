# ReLai Codex Engineering Rules

## Source of truth
Before implementation, read:
1. AGENTS.md
2. assigned GitHub Issue
3. README.md
4. ReLai_PRD_v3.3.md

If documents conflict:
- Product requirements: PRD
- Infrastructure/implementation: README
- Task scope: assigned GitHub Issue

## Workflow
Always:
1. start from latest develop
2. create one feature branch per Task
3. implement only assigned Issue
4. add/update tests
5. run validation
6. commit
7. push
8. open PR to develop
9. stop

Never:
- merge PRs
- start the next Issue
- perform final acceptance
- expand scope without Product Owner approval

## Architecture
ReLai v1:
- React + Vite
- React Router
- Cloudflare Worker
- Hono
- D1
- Gemini
- no FastAPI/PostgreSQL/Supabase for new work

Production path:
/relaiapp

API:
/relaiapp/api/v1/*

## Environment safety
develop → staging
main → production

Never:
- bind develop to relai-prod-db
- bind production to relai-staging-db
- run destructive production DB commands
- delete Cloudflare resources
- force push shared branches
- expose secrets
- modify production infrastructure without explicit Product Owner approval

## Validation
Unless Issue says otherwise:
npm run lint
npm run typecheck
npm test
npm run build

## PR
PR target: develop
Include:
- Summary
- Changes
- Validation
- Known limitations
- Closes #<issue>

## Responsibility
Codex = implement + test
ChatGPT Web = review + acceptance
Product Owner = merge + architecture/product decisions
