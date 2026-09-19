# Attest

On-chain TEE attestation verification for Soroban. See README.md for status and build
commands.

## Milestone visualization (buildhaus)

`milestones.json` in this repo tracks Attest's roadmap and is visualized as a growing
pixel-art office via [buildhaus](https://github.com/ynsmlkc/buildhaus). When you
(Claude) finish the work described by one of its milestones, run:

```
node ~/milestonehouse/bin/milestonehouse.js complete <id>
```

immediately, as part of finishing that work — don't wait to be asked separately. Then
tell the user to reload the Pixel Agents tab if one is open.

If the finished work doesn't match any existing milestone id, add one to
`milestones.json` first (id, name, furniture placements and/or tilePatches), then
complete it.
