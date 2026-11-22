# makefun-token-radar-02

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fajarmalik755/makefun-token-radar-02/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fajarmalik755/makefun-token-radar-02/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks 198 pre-token DeFi protocols by expected launch value — a comps-fitted implied value (log-log OLS on 128 traded tokens plus shrunk category residuals) times token odds from the snapshot's own age-by-TVL buckets — with a 68% interval per row, a costed seven-step farm plan and a FARM / THIN / SKIP verdict for each one, in a sortable, filterable offline dashboard. Every one of the snapshot's 758 protocols is accounted for: 198 ranked, 416 already trading, 144 excluded with reasons. The held-out validation (split-half both ways plus leave-one-out) is shown on the page, with its honest numbers: the median held-out error is about 84%, so this model ranks — it does not price precisely.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=25xq9bc4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
