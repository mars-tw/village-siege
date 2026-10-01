# Construction compatibility fixture

Captured from the unchanged shared simulation and persistence code at commit `933f9f1` (app `0.22.0`, rules `village-siege/0.19.0`) before the construction-resume fix. This is a synthetic test match with no user data.

Normal commands stop three workers, build a house for 60 ticks, then redirect the same worker to a barracks for 80 ticks. Both foundations retain genuine partial progress. A completed town center receives fixture-only damage so the old accepted `repair` behavior can also be recorded.

The original `repair` against the abandoned foundation (sequence 3) was rejected as `INVALID_PAYLOAD`; rejected commands did not enter the journal. The saved checkpoint is tick 140, hash `fbf4d7a8`. The historical replay contains accepted sequence 4 repairing the completed town center plus 200 ordinary fixed steps; tick 340 must remain hash `b32f0001` after this fix. Runtime sequence metadata includes the rejected command attempt.

Keep the JSON unchanged. Regenerating it with the new validator would erase the compatibility evidence.
