# Beacon Onboard

A small local Electron app that gives the chat-sdk `beacon-investigate-site`
and `beacon-manifest` skills a UI: paste a URL, run the investigation, review
the plan it writes, then click a second button to generate the manifest from
it.

This is an experiment, kept deliberately outside the `chat-sdk` checkout —
nothing here modifies that repo. It's a thin wrapper: both steps run by
shelling out to `claude -p "/beacon-investigate-site <url>"` /
`claude -p "/beacon-manifest ..."` with `cwd` pointed at your chat-sdk
checkout, exactly as if you'd typed the slash command yourself. All the real
work happens inside those skills; this app just gives you a form, streams the
output, and finds the file each step produces.

## Setup

```bash
npm install
npm start
```

On first launch, open **Settings** and confirm the chat-sdk checkout path
(defaults to `~/chat-sdk` if that exists).

## Using it

1. **Investigate a site** — paste a URL, click **Run investigation**. This
   runs `beacon-investigate-site`, which drives a connected browser tab
   through the site. Watch the log; when it finishes, the newest file under
   `docs/customer-research/` is shown.
2. Read the plan. This step is deliberately manual — the plan is what the
   manifest step commits to.
3. **Generate manifest** — the plan path is pre-filled from step 1 (editable
   if you want to point at an older plan). Enter an `appId`. Leave cluster
   host/org blank to only write the local manifest file
   (`web-v2/public/orgs/configs/chat/{appId}-manifest.json`); fill both in if
   you also want it uploaded to a cluster and the tool cache busted.

## Known limitations — read before assuming a run "just didn't work"

This app cannot make the underlying skills more automatable than they are.
Things that can make a run fail or stall that have nothing to do with this
UI:

- **`beacon-investigate-site` needs a connected browser tool** (the skill
  says "Investigate with the connected Chrome tab"). If nothing's connected
  when `claude -p` runs headless, the investigation will fail or the model
  will improvise — read the log, don't just trust a green status.
- **Interactive prompts don't have anyone to answer them.** Both skills use
  `AskUserQuestion` at a few points (e.g. "a research page already exists —
  update it, create a sibling, or cancel?"). In headless `-p` mode there's no
  terminal for that prompt to reach — watch the log for a run that seems to
  hang or stop making progress there.
- **Tool permission prompts fail closed, not silently.** By default a
  headless run that hits an unapproved tool has that one call denied and
  should say so in the log, rather than doing it anyway. The **"Skip
  permission prompts"** checkbox in Settings (off by default) passes
  `--dangerously-skip-permissions` instead — only turn it on if you're
  comfortable with the run using any tool, including writes, unattended.
- **The manifest step can fail its lint gate on purpose.** Per the skill, a
  manifest with checkout/sap-commerce config that has lint warnings refuses
  to upload until someone acknowledges them. Read the warnings in the log,
  then re-run with **"Acknowledge lint warnings"** checked if you want to
  proceed anyway.
- **Windows: the Claude Code CLI must be the native installer.** If `claude`
  resolves only to the npm-installed `.cmd` shim, spawning it can fail. See
  the chat-sdk `gladly-inbox` skill's README notes for the same issue and
  fix (`irm https://claude.ai/install.ps1 | iex` in PowerShell, then a fresh
  terminal).

None of the above is something this app works around — it surfaces the
skill's own output as-is so you can see what actually happened.

## Files

```
main.js               Electron main process: spawns `claude -p`, streams
                       output over IPC, locates the plan/manifest files.
preload.js             contextBridge surface exposed to the renderer.
renderer/              The UI (plain HTML/CSS/JS, no build step).
```

Nothing this app produces is written here — the plan and manifest files land
inside your chat-sdk checkout, same as if you'd run the skills yourself.
Settings (chat-sdk path, last-used appId/cluster) are stored in this app's
own Electron `userData` folder, not in this repo.
