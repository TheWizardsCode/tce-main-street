# Restaurant Renaissance

> Storyline `storyline-restaurant`. Part of the [Main Street storylines](../storylines.md) reference.

![Restaurant Renaissance storyline](../assets/storyline-graph-restaurant.svg)

## Events

| Event | Description | Trigger / tier / cost | Game-state impact | Choice routing |
|-------|-------------|-----------------------|-------------------|----------------|
| Farm-to-Table Feature (`evt-farm-table`) | Farm-to-table features earn 600 coins and 100 reputation. | Incident · tier 5 · cost 0 | +600 coins; +100 reputation | Resolves immediately (no choice) |
| Popular Menu Item (`evt-popular-menu`) | A popular menu item earns 300 coins. | Incident · tier 4 · cost 0 | +300 coins | Accept: effect applies → chain ends · Reject: effect skipped → Farm-to-Table Feature |
