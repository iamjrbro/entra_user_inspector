# Project workflow

This repository is the Entra User Inspector web dashboard. Keep it separate from the parent GodEye project.

The user has authorized committing and pushing requested implementation changes to `origin/main`. After completing the requested change and appropriate validation, commit and push it without asking for another conversational confirmation. Do not force-push or overwrite unrelated changes. Review-only requests do not authorize code changes.

Never commit `.env`, credentials, real tenant reports, generated audit images, or `node_modules`.

Use `npm start` for the real dashboard and `npm run demo` for synthetic data. Keep demo data visibly labeled. Run `npm test` for relevant changes. Reports must preserve all memberships, escape directory text in HTML, and paginate image exports instead of silently dropping rows.
