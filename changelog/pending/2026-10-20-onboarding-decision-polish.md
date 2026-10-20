---
pr: unmerged
branch: feat/onboarding-decision-polish
category: feat
summary: Onboarding decision emails, rejection reason on the agency page, owner resubmit and a staff "start review" step that writes under_review
sync_actions:
  - kind: env
    detail: "Decision emails need RESEND_API_KEY, RESEND_FROM_EMAIL and APP_URL (agency app origin) on the Convex deployment; without RESEND_API_KEY the email is skipped and logged"
---
