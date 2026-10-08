# Independence: who designs the cases

Why: a model that builds a feature carries its own misreadings into its tests, and agrees with itself. A designer that only sees the requirements and the public surface can only test what the app is supposed to do. The more different the designer is from the builder, the better. Be honest about how different yours was.

## Levels (report exactly one)

1. `different model + fresh context`
2. `fresh context only`
3. `none (same context)`

## What the designer gets

Only `qa/REQUIREMENTS.md`, `qa/SURFACE.md`, `references/templates.md`, `references/attack-angles.md`. Tell it explicitly: do not open source files, migrations, or tests; write `qa/TEST_CASES.md`; report the counts. If the app already has automated tests, give it a plain list of what they cover so it goes deeper instead of restating them ("Already covered, do NOT merely restate, vary or go deeper").

## Claude Code

Use the Agent tool (also called Task in older versions) with `subagent_type` `general-purpose` and the `model` parameter set to an alias such as `sonnet`, `opus` or `haiku`. A subagent starts with a fresh context and sees only the prompt you write. Pick a model different from your own (your current model is stated in your system prompt). Different model families are not available inside Claude Code, so "different" means a different Claude model. You can also define a reusable subagent in `.claude/agents/<name>.md` with a `model:` field in its frontmatter. In a headless run you can choose the main model with `claude -p --model <alias>`.

If the Agent tool is not available, you are at level 3. State it.

Prompt skeleton for the subagent:

```
You are a QA test designer. You did not write this app and must not read its code.
Read only qa/REQUIREMENTS.md, qa/SURFACE.md and the two reference files at <paths>.
Write qa/TEST_CASES.md in the exact format of templates.md. At most about 15% happy
path. Every requirement gets at least one non-happy case. Weight toward edge,
negative, boundary, security, concurrency, timezone and role cases. Then reply with
the case count only.
```

## Codex

Codex can spawn subagents when you ask for one in the prompt (the `multi_agent` feature is on by default in current releases), which gives you a fresh context, but per-subagent model choice is not something to rely on. For a real model difference, run a separate non-interactive session on another model with only the requirements in a clean folder:

```sh
mkdir -p /tmp/qa-design && cp qa/REQUIREMENTS.md qa/SURFACE.md /tmp/qa-design/
codex exec -m <other-model> -s workspace-write -C /tmp/qa-design \
  "Read REQUIREMENTS.md and SURFACE.md. You are a QA test designer ... (skeleton above) ... write TEST_CASES.md here"
cp /tmp/qa-design/TEST_CASES.md qa/TEST_CASES.md
```

`-m` picks the model, `-p <profile>` layers a profile from `$CODEX_HOME/<name>.config.toml`, `-C` sets the working root so the designer cannot see the project's source. Use a model other than the one the main session runs (see `model` in `~/.codex/config.toml`). If you cannot run a second session, use a subagent and report level 2, or report level 3.

Cross-agent option for the user: build with one tool and run this skill's design step in the other (for example build in Claude Code, design in Codex). That is the strongest independence.

## Reporting

In Codex, a subagent you spawn always counts as `fresh context only`, unless you ran a separate `codex exec -m <other-model>` session as the designer. The builder name in the `Designed by:` line must be the model printed in the session header or the `model` key in `~/.codex/config.toml`; always read that file when it exists and use its value, and write `unknown` only if neither source names a model. Never write a name you did not read. If the designer and builder names are equal, or you cannot name the builder, write `Independence: fresh context only`. `scripts/case-mix.mjs` warns when the line claims `different model` with equal or unknown names.

A subagent spawned inside Codex inherits the session model unless you can set it, so by default that is `fresh context only`, even if the subagent labels itself otherwise. Only an explicit `codex exec -m <other-model>` run, or a subagent whose model you set and can name, earns `different model`. The `Designed by:` line must name the designer model and the builder model.

Write the level at the top of `qa/TEST_CASES.md` and in the final summary. If you are unsure whether the models differ, say `fresh context only`.
