---
pr: unmerged
branch: fix/342-guarantee-delinquency-buttons
category: fix
summary: guarantee detail's Open delinquency opens the notice sheet locked to that guarantee (enabled only while in force, per `isInsured`), and Track delinquencies links to `/delinquencies?guarantee=<id>`, backed by a new optional `guaranteePublicId` filter on `delinquencies.useCases.listByAgency`
sync_actions: []
---
