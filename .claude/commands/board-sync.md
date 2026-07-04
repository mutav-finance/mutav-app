---
description: Sincroniza o board (projeto #3) com as issues da org, marca resolvidas como Done, audita labels e aponta gaps + próximos passos.
allowed-tools: Bash, Read
---

# /board-sync — manutenção do board Mutav Project (#3)

Você é o mantenedor do board de projeto da organização `mutav-finance`
(projeto org #3, "Mutav Project"). Este comando roda o motor de sincronização,
lê os achados e produz um relatório acionável.

**Comportamento de comentários (decisão do usuário):** o motor comenta
**automaticamente, sem aprovação**, na issue que foi **fechada/concluída** —
e somente nessa (não em movida/vinculada). O Status do board serve de memória:
cada fechamento é comentado exatamente uma vez. **Criar/corrigir labels** ainda
requer "ok" (muta os repos), mas não notifica ninguém.

## Padrão de labels (o nosso padrão)

Derivado do esquema namespaced do `mutav-pulse`. Toda issue **de trabalho** aberta no board deve ter:

- **type** (exatamente 1): `bug` · `enhancement` · `documentation` · `security`
- **priority** (exatamente 1): `priority:high` · `priority:med` · `priority:low`
- **area** (≥1, recomendado): `area:contracts` · `area:frontend` · `area:docs` · `area:business`
- **owner** (opcional): `owner:cto` · `owner:ceo`

**Itens estruturais (epic / story) são isentos de `priority`** — não priorizamos
esse nível. As labels `epic` e `pilot` são reconhecidas (não contam como
`NONSTANDARD`). `pilot` marca o horizonte do piloto (cross-repo); a data-alvo
vive no milestone **Pilot** (mutav-app).

## Modelo de PM (o que o motor audita além de labels)

- **Árvore:** Epic (tema permanente) → Story (entregável) → sub-issue (trabalho).
  Toda issue de trabalho deve ter um pai; issues soltas são **órfãs** (gap).
- **Sprint = Iteration "Summit Sprint":** rastreada no **nó-folha** (sub-issue, ou
  a própria story se for task-only). Story-com-subs **e** suas subs juntas no
  sprint = **duplicação** (deve ser 0).
- **Repos fora de escopo** (`mutav-pulse`, `mutav-fund`, `mutav-solana`) não são
  auto-adicionados ao board.

## Passos

1. **Rode o motor** (aplica só a sincronização determinística e interna do board —
   adiciona issues abertas novas em Backlog, marca fechadas como Done):

   ```bash
   node .claude/scripts/board-sync.mjs
   ```

   Para inspecionar sem mutar nada, use `--dry-run`. A última linha do stdout é
   `FINDINGS <caminho>` — leia esse JSON com a tool Read.

2. **Relate a sincronização**: quantos itens no board, quantos adicionados,
   quantos marcados Done (liste os `markedDone` — essas são as issues que já
   foram resolvidas/fechadas no GitHub).

3. **Checagem de resolução**: o motor já postou o comentário de encerramento e
   marcou Done em cada item de `markedDone` (issues fechadas desde a última
   rodada). Apenas **relate** quais foram — não recomente.
   - Os `staleCandidates` (parados ≥30d) são **informativos** (entram nos gaps).
     Não comente neles automaticamente. Se o usuário pedir, investigue com
     `gh issue view <n> --repo <repo>` e proponha ação (fechar/repriorizar).

4. **Auditoria de labels**: agrupe `labelViolations` por repo e por código
   (`MISSING_TYPE`, `MISSING_PRIORITY`, `MISSING_AREA`, `MULTIPLE_TYPE`,
   `NONSTANDARD`). Se `repoLabelGaps` não estiver vazio, os repos listados nem
   têm as labels do padrão definidas — proponha rodar:

   ```bash
   node .claude/scripts/board-labels-init.mjs        # cria priority:* / area:* / owner:* em todos os repos
   ```

   (Rode `--dry-run` primeiro para mostrar o que seria criado.) Só execute a
   versão real após o "ok". Criar labels não notifica ninguém, mas muta os repos.

5. **Integridade da estrutura** (findings novos): reporte e proponha ação —
   - `orphans`: issues de trabalho **sem pai** na árvore (fora de qualquer
     epic/story). Destaque as `pilot: true` (prioridade). Proponha encaixá-las
     num epic/story existente.
   - `sprintDuplications`: story-container no sprint junto das suas subs —
     proponha **tirar a story do sprint** (as subs cobrem). Deve ser 0.
   - `pilotCoverageGaps`: itens do horizonte `pilot` fora da árvore (subconjunto
     de `orphans`). O tracker `#208` aparece aqui por ser topo — é esperado.
   - `skippedOutOfScope`: issues novas de repos fora de escopo que **não** foram
     adicionadas — só liste, não aja sem "ok".

6. **Gaps e próximos passos**: sintetize em uma lista priorizada — o que está
   bloqueando a governança do board (labels-padrão ausentes, órfãos pilot,
   duplicação de sprint, milestones sem cobertura). Termine com 3–5 ações
   concretas e ordenadas.

## Regras

- Comentário de encerramento em issue fechada é automático (o motor faz). Não
  peça aprovação pra isso e não recomente.
- Criar/editar label ainda exige "ok" (muta os repos). A sincronização do board
  (add/Done/reopen) é interna e roda direto.
- Nunca exiba mensagens de erro cruas do GitHub ao usuário — resuma.
- Se um repo/issue sumiu ou foi transferido, sinalize em vez de assumir.
