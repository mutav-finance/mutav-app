---
pr: unmerged
branch: feat/underwriting-review
category: feat
summary: mutav underwriting review — agency requests analysis, compliance accepts with a rate or refuses, then marks the contract sent
sync_actions:
  - kind: seed
    detail: "bun run seed — guarantees gained underwriting.review / terms.feeRateBps and a new index; existing rows lack the required review field until reseeded"
---
