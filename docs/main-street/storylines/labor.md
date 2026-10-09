# Labour Unrest

> Storyline `storyline-labor`. Part of the [Main Street storylines](../storylines.md) reference.

![Labour Unrest storyline](../assets/storyline-graph-labor.svg)

## Events

| Event | Description | Trigger / tier / cost | Game-state impact | Choice routing |
|-------|-------------|-----------------------|-------------------|----------------|
| General Strike (`evt-general-strike`) | Lose 500 coins and 100 reputation from the general strike. | Incident · tier 12 · cost 0 | −500 coins; −100 reputation | Resolves immediately (no choice) |
| Service Workers Strike (`evt-strike-service`) | Service staff strike: -200 coins per Service business. | Incident · tier 7 · cost 0 | −200 coins; target: Service businesses | Accept: effect applies → chain ends · Reject: effect skipped → General Strike |
