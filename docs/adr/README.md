# Architecture decision records

One file per decision, named `NNNN-title-in-kebab-case.md`, numbered sequentially. Each ADR records the context, the decision, and its consequences at the time it was made; superseded decisions get a new ADR rather than an edit, with the old one marked superseded.

A breaking change to a cross-lane contract (schema, permission, event payload, migration column, connector/model interface — see `docs/superpowers/plans/README.md` "Canonical cross-lane names") requires a new ADR here before merge. Additive, backward-compatible changes only need the PR itself.

| ADR | Title |
|---|---|
| [0001](0001-contracts-ownership.md) | Contracts ownership |
