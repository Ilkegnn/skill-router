# skill-router (Universal)

Coding agents rarely invoke installed skills on their own. This router makes them use them — fully supporting both **Claude Code** and **Google Antigravity**.

- **Specialized fast routing per platform:**
  - **In Claude Code:** Supports two modes:
    - **`inline`** (default in Claude Desktop App & Cloud sessions): Zero latency and zero extra model calls. The active model receives a direct prompt injection to pick needed skills, plus periodic model/effort advisor checks.
    - **`haiku`** (default in standalone CLI): Claude Haiku analyzes your prompt and determines needed skills before passing them to the main model.
  - **In Antigravity:** Gemini Flash (`gemini-2.5-flash` / `gemini-3.8-flash`) analyzes your task in the background via direct lightweight API calls before the main agent generates its response, with offline heuristic fallback.
- **On every actionable request** (25+ characters, skipping slash commands and trivial acknowledgements like "ok" or "tamam"), the router checks installed skills and provides the exact skills needed in execution order.
- **While editing files**, each file edit/write is checked against the file type (UI, tests, Swift, Kotlin, Python, SQL, etc.). If a matching skill is not loaded yet, the agent gets a one-time reminder. This part runs 100% locally and costs zero tokens.
- **Model and effort check:** Evaluates whether the task fits the model and effort level the session runs on (Haiku for lookups and simple edits, Sonnet for routine coding, Opus for architecture and complex debugging; low effort for mechanical work, high effort for hard reasoning). Only clear mismatches are flagged.
- **Self-tuning & cleanup:** On first start (and whenever skills change), a background pass groups skills into domains, maps file kinds, and flags duplicated or deprecated skills. Review those with `/skill-router:cleanup`.
- **Cloud sessions ready:** Runs seamlessly in remote cloud environments (claude.ai/code, GitHub Codespaces, remote containers) using the included `extras/cloud-loader.mjs`.

---

## Installation

### For Claude Code
Inside Claude Code:
```bash
/plugin marketplace add Ilkegnn/skill-router
/plugin install skill-router@skill-router
```

Or via terminal:
```bash
claude plugin marketplace add Ilkegnn/skill-router
claude plugin install skill-router@skill-router
```

### For Antigravity
Run the one-step installer from this repository:
```bash
node scripts/install-antigravity.mjs
```
*This automatically registers `SessionStart`, `PreInvocation` (Gemini Flash background routing), and `PreToolUse` (file editing reminders) in `~/.gemini/config/hooks.json` across all workspaces.*

To enable only for a specific workspace, copy `.agents/hooks.json` to your workspace root.

---

## Updating

### Claude Code
Inside Claude Code:
```bash
/plugin marketplace update Ilkegnn/skill-router
/plugin update skill-router
```
Or via terminal:
```bash
claude plugin marketplace update Ilkegnn/skill-router
claude plugin update skill-router@skill-router
```

### Antigravity
Pull the latest commits and run the installer:
```bash
git pull
node scripts/install-antigravity.mjs
```

---

## Cloud Sessions (Claude Code)

Cloud sessions (claude.ai/code, remote containers) do not read `~/.claude` but execute hooks committed to the repository:

1. Copy `extras/cloud-loader.mjs` to `<repo>/.claude/hooks/skill-router.mjs`.
2. Merge `extras/cloud-settings.json` into `<repo>/.claude/settings.json`.
3. Put project-specific rules in `<repo>/.claude/skill-router.json` and commit all three.

At session start, the loader automatically shallow-clones the repository into `~/.cache/skill-router` inside the VM and executes hooks from there. On local machines with the plugin installed, the loader exits immediately with zero overhead.

---

## Configuration & Overrides (Optional)

Skill router works automatically out of the box. To customize behavior, configure `~/.claude/skill-router/overrides.json` (global) or `<project>/.claude/skill-router.json` (per project):

```json
{
  "protect": ["my-custom-skill"],
  "ignore": ["skill-i-never-want-suggested"],
  "fileRules": {
    "ui": ["impeccable"],
    "test": ["test-driven-development"]
  },
  "extraSkillDirs": [
    { "dir": "~/my-skills", "prefix": "mine:" }
  ],
  "minPromptChars": 25,
  "mode": "auto",
  "advisor": "notify"
}
```

- **`mode`**: `"auto"` (default: inline in Desktop app/cloud, haiku in CLI), `"inline"`, or `"haiku"`.
- **`advisor`**: `"notify"` (default: alerts on significant model/effort mismatches) or `"off"`.
- **`protect`**: List of skill names never suggested for cleanup.
- **`ignore`**: List of skills never suggested or reminded.
- **`fileRules`**: Override file kind to skill mappings (`ui`, `motion`, `test`, `e2e`, `reactNative`, `swift`, `android`, `python`, `rust`, `go`, `sql`, `infra`, `llmApp`, `designSpec`, `skillFile`).
- **`extraSkillDirs`**: Custom skill directories to scan.
- **`minPromptChars`**: Minimum character length of prompt to trigger routing (default: 25).

---

## Testing

Run the test suite using Node's native test runner:
```bash
node --test tests/router.test.mjs tests/antigravity.test.mjs
```

---

## License

MIT
