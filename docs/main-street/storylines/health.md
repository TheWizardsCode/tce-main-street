# Public Health Crisis

> Storyline `storyline-health`. Part of the [Main Street storylines](../storylines.md) reference.

![Public Health Crisis storyline](../assets/storyline-graph-health.svg)

## Events

| Event | Description | Trigger / tier / cost | Game-state impact | Choice routing |
|-------|-------------|-----------------------|-------------------|----------------|
| Flu Outbreak (`evt-flu-outbreak`) | All businesses generate 80% income for 5 turns. Duration reduced by Clinic/Medical Center. | Incident · tier 9 · cost 100 | all businesses income ×0.8 for 5 turns | Accept: effect applies → chain ends · Reject: effect skipped → Pandemic |
| Pandemic (`evt-pandemic`) | All businesses generate 60% income for 7 turns. Duration reduced by Clinic/Medical Center. | Incident · tier 6 · cost 100 | all businesses income ×0.6 for 7 turns | Resolves immediately (no choice) |
