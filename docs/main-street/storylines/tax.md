# Tax Troubles

> Storyline `storyline-tax`. Part of the [Main Street storylines](../storylines.md) reference.

![Tax Troubles storyline](../assets/storyline-graph-tax.svg)

## Events

| Event | Description | Trigger / tier / cost | Game-state impact | Choice routing |
|-------|-------------|-----------------------|-------------------|----------------|
| Tax Audit (`evt-tax`) | Lose 45% of your banked coins. | Incident · tier 1 · cost 0 | −45% of banked coins (nominal −300 coins) | Accept: effect applies → chain ends · Reject: effect skipped → Inquiry Commission |
| Error in Tax Return (`evt-tax-error`) | Lose 200 coins to paperwork errors. | Incident · tier 1 · cost 0 | −200 coins | Accept: effect applies → chain ends · Reject: effect skipped → Tax Audit |
| Inquiry Commission (`evt-tax-inquiry`) | Lose 600 coins and 100 reputation to the inquiry. | Incident · tier 2 · cost 0 | −600 coins; −100 reputation | Accept: effect applies → Error in Tax Return · Reject: effect skipped → chain ends |
