# Legacy singleplayer runtime archives

These unchanged JSON archives were exported through the public app `0.22.1` interface on 2026-10-01 during an isolated automated audit at `https://mars-tw.github.io/village-siege/play.html?v=0.22.1`. They contain a synthetic test match with no user data.

The save is tick `1141`, hash `5e096065`, rules `village-siege/0.19.0`. The replay is tick `1939`, final hash `3f03bc7f`, and includes the actual novice AI authority. Unlike the construction fixture, these files meet the client runtime's requirement for a live opponent authority.

Keep both files unchanged. Tests first validate their recorded hashes and command chain, then migrate to a separate current-rules checkpoint.
