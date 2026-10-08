# Economic Downturn

> Storyline `storyline-economy`. Part of the [Main Street storylines](../storylines.md) reference.

![Economic Downturn storyline](../assets/storyline-graph-economy.svg)

## Events

| Event | Description | Trigger / tier / cost | Game-state impact | Choice routing |
|-------|-------------|-----------------------|-------------------|----------------|
| Depression (`evt-depression`) | All businesses generate 50% income for 5 turns. | Incident · tier 9 · cost 100 | all businesses income ×0.5 for 5 turns | Resolves immediately (no choice) |
| Economic Recession (`evt-recession`) | All businesses generate 70% income for 4 turns. Duration reduced by Clinic/Medical Center. | Incident · tier 9 · cost 100 | all businesses income ×0.7 for 4 turns | Accept: effect applies → chain ends · Reject: effect skipped → Depression |
