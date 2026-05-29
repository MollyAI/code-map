# Flexible Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Clean Architecture layer config with a 6-template library; have Phase 1 detect the right template from project signals; allow Phase 2 AI to verify, swap, or tweak.

**Architecture:** Pure input-side change. New `templates/` directory holds 6 YAML files (each with `layers` + `signals`). New `scripts/lib/templates.py` handles loading + scoring-based detection. `scripts/lib/layers.py` becomes a thin three-level resolver (user override → detection → embedded fallback). `scripts/analyze.py` writes detection results into `raw_structure.json`. `build-code-map.md` Phase 2 contract gains step 0 for AI verification. Frontend, `core.py`, `serve.py`, and extractors are untouched.

**Tech Stack:** Python stdlib; PyYAML when present (optional). The project has no test suite — verification is by running `analyze.py` against this repo and inspecting the produced `raw_structure.json` + stdout.

**Spec:** `docs/superpowers/specs/2026-05-23-flexible-architecture-design.md`

---

## File map

**New files:**
- `templates/clean-architecture.yml`
- `templates/mvc.yml`
- `templates/hexagonal.yml`
- `templates/frontend-spa.yml`
- `templates/cli-tool.yml`
- `templates/pipeline.yml`
- `scripts/lib/templates.py`

**Modified:**
- `scripts/lib/layers.py` — `DEFAULT_CONFIG` becomes minimal embedded fallback; `load_config(project_root, plugin_root) -> (config, detection|None)`.
- `scripts/analyze.py` — pass `plugin_root`, write `project.template_detection`, print chosen-template line.
- `commands/build-code-map.md` — Phase 2 step 0 (architecture verification) inserted; step 4 rewritten.
- `examples/default-layers.yml` — annotated walkthrough of full schema with `signals`.
- `README.md` — templates section.
- `CLAUDE.md` — "Templates & layer assignment" invariant extends the right-to-left rule.

---

## Task 1: Create the six template YAML files

**Files:**
- Create: `templates/clean-architecture.yml`
- Create: `templates/mvc.yml`
- Create: `templates/hexagonal.yml`
- Create: `templates/frontend-spa.yml`
- Create: `templates/cli-tool.yml`
- Create: `templates/pipeline.yml`

- [ ] **Step 1: Write `templates/clean-architecture.yml`**

```yaml
# Clean Architecture / Onion — Presentation -> Domain -> Data -> Infrastructure.
# The most common shape for Android, JVM backend, and well-structured Go/Rust apps.
id: clean-architecture
name: "Clean Architecture"
description: "Layered: Presentation depends on Domain depends on Data; Infrastructure cuts across."

layers:
  - id: presentation
    name: Presentation
    order: 0
    summary: "UI, navigation, view models, controllers"
    path_segments: [presentation, ui, view, screen, compose, components, pages, handlers, controllers, routes, endpoints]
    name_suffixes: [Activity, Fragment, ViewModel, Screen, Controller, View, Page, Handler, Route]
  - id: domain
    name: Domain
    order: 1
    summary: "Business rules, use cases, entities"
    path_segments: [domain, usecase, use_case, model, entity, service, logic, core]
    name_suffixes: [UseCase, Service, Model, Entity, Aggregate, DomainEvent, Policy]
  - id: data
    name: Data
    order: 2
    summary: "Repositories, data sources, persistence, APIs"
    path_segments: [data, repository, repo, dao, datasource, db, store, persistence, api, client, gateway, remote, local]
    name_suffixes: [Repository, Dao, DataSource, Store, Client, Gateway, Api]
  - id: infrastructure
    name: Infrastructure
    order: 3
    summary: "DI, network, utilities, build/runtime plumbing"
    path_segments: [di, ioc, inject, network, net, util, utils, common, shared, internal, pkg, cmd, lib, bin, config, infra]
    name_suffixes: [Factory, Module, Provider, Container, Helper, Util, Config, Bootstrap]

signals:
  files:
    - {match: "AndroidManifest.xml",   weight: 5}
    - {match: "app/build.gradle*",     weight: 4}
    - {match: "build.gradle*",         weight: 2}
    - {match: "settings.gradle*",      weight: 2}
    - {match: "pom.xml",               weight: 2}
  dependencies:
    - {match: "androidx.",             weight: 3}
    - {match: "dagger",                weight: 2}
    - {match: "hilt",                  weight: 2}
    - {match: "koin",                  weight: 2}
  paths:
    - {match: "domain",                weight: 3}
    - {match: "data",                  weight: 2}
    - {match: "presentation",          weight: 3}
    - {match: "usecase",               weight: 3}
    - {match: "repository",            weight: 2}
```

- [ ] **Step 2: Write `templates/mvc.yml`**

```yaml
# MVC — Controller routes a request, Model holds state/persistence, View renders.
# Fits Rails, Spring MVC, Laravel, classic Django.
id: mvc
name: "MVC"
description: "Controller dispatches, Model holds data, View renders."

layers:
  - id: controller
    name: Controllers
    order: 0
    summary: "Request dispatch, action handlers"
    path_segments: [controllers, controller, actions]
    name_suffixes: [Controller, Action]
  - id: model
    name: Models
    order: 1
    summary: "Domain models, ActiveRecord, ORM entities"
    path_segments: [models, model, entities, entity]
    name_suffixes: [Model, Entity, Record]
  - id: view
    name: Views
    order: 2
    summary: "Templates, view helpers, presenters"
    path_segments: [views, view, templates, presenters, helpers]
    name_suffixes: [View, Template, Presenter, Helper]
  - id: infrastructure
    name: Infrastructure
    order: 3
    summary: "Middleware, config, lib"
    path_segments: [middleware, config, lib, initializers, support]
    name_suffixes: [Middleware, Config, Initializer]

signals:
  files:
    - {match: "config/routes.rb",      weight: 5}
    - {match: "Gemfile",               weight: 3}
    - {match: "artisan",               weight: 5}
    - {match: "manage.py",             weight: 3}
  dependencies:
    - {match: "rails",                 weight: 4}
    - {match: "django",                weight: 3}
    - {match: "spring-boot-starter-web", weight: 3}
    - {match: "spring-webmvc",         weight: 3}
    - {match: "laravel/framework",     weight: 4}
  paths:
    - {match: "controllers",           weight: 3}
    - {match: "models",                weight: 2}
    - {match: "views",                 weight: 2}
```

- [ ] **Step 3: Write `templates/hexagonal.yml`**

```yaml
# Hexagonal / Ports & Adapters — Application orchestrates Domain through
# Ports; Adapters implement Ports for specific tech. DDD-flavored backends.
id: hexagonal
name: "Hexagonal (Ports & Adapters)"
description: "Application orchestrates Domain via Ports; Adapters bind tech."

layers:
  - id: application
    name: Application
    order: 0
    summary: "Use cases, application services orchestrating the domain"
    path_segments: [application, app, usecase, use_case]
    name_suffixes: [UseCase, ApplicationService, CommandHandler, QueryHandler]
  - id: domain
    name: Domain
    order: 1
    summary: "Entities, value objects, domain services"
    path_segments: [domain, model]
    name_suffixes: [Entity, Aggregate, ValueObject, DomainEvent, DomainService]
  - id: ports
    name: Ports
    order: 2
    summary: "Interfaces the domain expects of the world"
    path_segments: [ports, port, interfaces]
    name_suffixes: [Port, Gateway]
  - id: adapters
    name: Adapters
    order: 3
    summary: "Concrete implementations of ports — HTTP, DB, message bus"
    path_segments: [adapters, adapter, infrastructure, infra, persistence, http, rest, grpc]
    name_suffixes: [Adapter, Repository, Controller, HttpClient]
  - id: infrastructure
    name: Infrastructure
    order: 4
    summary: "Wiring, config, cross-cutting"
    path_segments: [config, wiring, bootstrap, di]
    name_suffixes: [Config, Module, Bootstrap]

signals:
  files: []
  dependencies: []
  paths:
    - {match: "ports",                 weight: 5}
    - {match: "adapters",              weight: 5}
    - {match: "application",           weight: 2}
    - {match: "domain",                weight: 2}
    - {match: "hexagonal",             weight: 4}
```

- [ ] **Step 4: Write `templates/frontend-spa.yml`**

```yaml
# Frontend SPA — page-routed apps in React/Vue/Svelte/Next/etc.
id: frontend-spa
name: "Frontend SPA"
description: "Page-routed single-page app; components, state, and API calls."

layers:
  - id: pages
    name: Pages
    order: 0
    summary: "Top-level route components"
    path_segments: [pages, routes, views, app]
    name_suffixes: [Page, Route, Screen]
  - id: components
    name: Components
    order: 1
    summary: "Reusable UI building blocks"
    path_segments: [components, ui, widgets]
    name_suffixes: [Component, Card, Button, Modal, Dialog, List, Item]
  - id: state
    name: Hooks & State
    order: 2
    summary: "Custom hooks, stores, contexts, state management"
    path_segments: [hooks, stores, store, state, context, contexts, atoms, slices]
    name_suffixes: [Store, Provider, Context, Atom, Slice, Reducer]
  - id: api
    name: API & Services
    order: 3
    summary: "Network calls, API clients, data services"
    path_segments: [api, services, queries, fetchers, lib]
    name_suffixes: [Client, Service, Api, Query, Fetcher]
  - id: utils
    name: Utils
    order: 4
    summary: "Helpers, formatters, types"
    path_segments: [utils, util, helpers, types, constants]
    name_suffixes: [Helper, Util, Formatter]

signals:
  files:
    - {match: "package.json",          weight: 2}
    - {match: "next.config.*",         weight: 5}
    - {match: "vite.config.*",         weight: 4}
    - {match: "svelte.config.*",       weight: 5}
    - {match: "nuxt.config.*",         weight: 5}
    - {match: "remix.config.*",        weight: 5}
    - {match: "tsconfig.json",         weight: 1}
  dependencies:
    - {match: "react",                 weight: 4}
    - {match: "vue",                   weight: 4}
    - {match: "@sveltejs/kit",         weight: 5}
    - {match: "svelte",                weight: 3}
    - {match: "next",                  weight: 4}
    - {match: "nuxt",                  weight: 4}
    - {match: "@remix-run",            weight: 4}
    - {match: "solid-js",              weight: 3}
  paths:
    - {match: "src/components",        weight: 3}
    - {match: "src/pages",             weight: 3}
    - {match: "src/hooks",             weight: 2}
    - {match: "src/stores",            weight: 2}
    - {match: "components",            weight: 1}
```

- [ ] **Step 5: Write `templates/cli-tool.yml`**

```yaml
# CLI tool — argparse/click/typer/cobra/clap-driven command-line program.
id: cli-tool
name: "CLI Tool"
description: "Command-line program: an entry point dispatches into subcommands."

layers:
  - id: entry
    name: Entry
    order: 0
    summary: "Argument parsing, top-level dispatch"
    path_segments: [cmd, bin, main]
    name_suffixes: [Main, Cli, Entry]
  - id: commands
    name: Commands
    order: 1
    summary: "Subcommand handlers"
    path_segments: [commands, command, subcommands, cli]
    name_suffixes: [Command, Cmd, Subcommand]
  - id: core
    name: Core
    order: 2
    summary: "Business logic invoked by commands"
    path_segments: [core, internal, lib, services, logic]
    name_suffixes: [Service, Runner, Engine]
  - id: util
    name: Util
    order: 3
    summary: "Output formatting, IO helpers, shared utilities"
    path_segments: [util, utils, helpers, output, format, io]
    name_suffixes: [Helper, Util, Formatter, Writer]

signals:
  files:
    - {match: "Cargo.toml",            weight: 2}
    - {match: "pyproject.toml",        weight: 1}
    - {match: "go.mod",                weight: 1}
  dependencies:
    - {match: "clap",                  weight: 5}
    - {match: "structopt",             weight: 4}
    - {match: "click",                 weight: 4}
    - {match: "typer",                 weight: 5}
    - {match: "argparse",              weight: 2}
    - {match: "spf13/cobra",           weight: 5}
    - {match: "github.com/urfave/cli", weight: 5}
    - {match: "commander",             weight: 3}
  paths:
    - {match: "cmd",                   weight: 4}
    - {match: "commands",              weight: 3}
    - {match: "subcommands",           weight: 3}
    - {match: "cli",                   weight: 2}
```

- [ ] **Step 6: Write `templates/pipeline.yml`**

```yaml
# Pipeline / Compiler — stages transform data left-to-right.
# Covers compilers (lexer/parser/codegen), data ETL, interpreters.
id: pipeline
name: "Pipeline"
description: "Staged transformation: Input -> Parse -> Transform -> Output."

layers:
  - id: input
    name: Input
    order: 0
    summary: "Source loading, tokenization, lexing"
    path_segments: [input, lex, lexer, scanner, tokenizer, source, reader]
    name_suffixes: [Lexer, Scanner, Tokenizer, Reader, Loader]
  - id: parse
    name: Parse
    order: 1
    summary: "Parsing into AST / structured form"
    path_segments: [parse, parser, ast, syntax]
    name_suffixes: [Parser, Ast, AstNode, Syntax]
  - id: transform
    name: Transform
    order: 2
    summary: "IR passes, optimizations, semantic analysis"
    path_segments: [transform, ir, sema, analyze, optimize, passes, middle]
    name_suffixes: [Pass, Transformer, Analyzer, Optimizer, Visitor]
  - id: output
    name: Output
    order: 3
    summary: "Code generation, emission, serialization"
    path_segments: [codegen, emit, output, backend, writer, gen]
    name_suffixes: [CodeGen, Emitter, Writer, Backend, Generator]

signals:
  files: []
  dependencies: []
  paths:
    - {match: "lexer",                 weight: 5}
    - {match: "parser",                weight: 5}
    - {match: "ast",                   weight: 4}
    - {match: "codegen",               weight: 5}
    - {match: "backend",               weight: 2}
    - {match: "ir",                    weight: 3}
    - {match: "passes",                weight: 3}
```

- [ ] **Step 7: Verify all six files parse as YAML**

Run:
```bash
python3 -c "
import sys, pathlib
try:
    import yaml
except ImportError:
    print('SKIP: pyyaml not installed'); sys.exit(0)
for p in sorted(pathlib.Path('templates').glob('*.yml')):
    d = yaml.safe_load(p.read_text())
    assert 'id' in d and 'layers' in d and 'signals' in d, p
    print(f'OK {p}: id={d[\"id\"]} layers={len(d[\"layers\"])} signals={sum(len(v) for v in d[\"signals\"].values())}')
"
```

Expected: six `OK templates/<name>.yml` lines, each with sensible counts. If `pyyaml` isn't installed locally, `SKIP` is fine — the runtime path handles missing PyYAML.

- [ ] **Step 8: Commit**

```bash
git add templates/
git commit -m "feat(templates): seed 6 architecture templates with signals

Clean Architecture, MVC, Hexagonal, Frontend SPA, CLI Tool, Pipeline.
Each carries its own layer definitions plus signal weights used by the
detector to pick the most likely template per project."
```

---

## Task 2: New module `scripts/lib/templates.py`

**Files:**
- Create: `scripts/lib/templates.py`

- [ ] **Step 1: Write `scripts/lib/templates.py`**

```python
"""
Template loading + project-signal detection.

A "template" is a layer configuration plus a signals block. The signals
block tells the detector how to recognize this kind of project by looking
at files, dependency manifests, and directory names.

Detection is intentionally cheap: glob the project root, read a few
well-known manifests, count directory-name occurrences. The result is
deterministic, language-agnostic, and easy to override (the user can
drop a `.code-map/layers.yml` to bypass detection entirely).
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path


# Manifests we know how to scan for dependency names. Each entry is
# (filename_pattern, extractor_callable_or_None). When extractor is None,
# we fall back to substring search on the raw file text.
_MANIFEST_FILES = (
    "package.json", "go.mod", "Cargo.toml", "pyproject.toml",
    "requirements.txt", "requirements-dev.txt",
    "build.gradle", "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts",
    "pom.xml", "Gemfile", "composer.json",
)

# Directory names we never recurse into when counting path signals.
_SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "build", ".gradle", ".idea",
    "vendor", "target", "dist", "__pycache__", ".venv", "venv", ".env",
    ".code-map", ".pytest_cache",
}

# Cap per-rule path matches so a single dir name doesn't dominate scoring.
_PATH_COUNT_CAP = 3


def load_templates(plugin_root: Path) -> list[dict]:
    """Load every templates/*.yml under plugin_root. Bad files are skipped
    with a stderr warning. Returns [] if PyYAML is missing or the dir doesn't
    exist."""
    tpl_dir = plugin_root / "templates"
    if not tpl_dir.is_dir():
        return []
    try:
        import yaml  # type: ignore
    except ImportError:
        return []
    out = []
    for path in sorted(tpl_dir.glob("*.yml")):
        try:
            data = yaml.safe_load(path.read_text())
            if not isinstance(data, dict) or "id" not in data or "layers" not in data:
                print(f"[templates] skip {path.name}: missing id/layers", file=sys.stderr)
                continue
            data.setdefault("signals", {})
            out.append(data)
        except Exception as e:
            print(f"[templates] skip {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
    return out


def detect_template(project_root: Path, templates: list[dict]) -> dict:
    """Score each template against the project; return chosen + evidence.

    Always returns a result even when scores are all zero — picks
    'clean-architecture' as a deterministic fallback, or the first
    template in the list if that id isn't present.
    """
    scores: dict[str, int] = {t["id"]: 0 for t in templates}
    evidence: list[dict] = []

    manifest_text = _read_manifests(project_root)
    project_dirs = _list_project_dirs(project_root)

    for t in templates:
        tid = t["id"]
        sig = t.get("signals", {}) or {}

        for rule in sig.get("files", []) or []:
            for match in _glob_top_two_levels(project_root, rule["match"]):
                scores[tid] += rule["weight"]
                evidence.append({
                    "template": tid, "kind": "file",
                    "match": str(match.relative_to(project_root)),
                    "weight": rule["weight"],
                })

        for rule in sig.get("dependencies", []) or []:
            if rule["match"] in manifest_text:
                scores[tid] += rule["weight"]
                evidence.append({
                    "template": tid, "kind": "dependency",
                    "match": rule["match"],
                    "weight": rule["weight"],
                })

        for rule in sig.get("paths", []) or []:
            count = sum(1 for d in project_dirs if d == rule["match"] or d.endswith("/" + rule["match"]))
            if count > 0:
                capped = min(count, _PATH_COUNT_CAP)
                scores[tid] += capped * rule["weight"]
                evidence.append({
                    "template": tid, "kind": "path",
                    "match": rule["match"],
                    "count": count, "weight": rule["weight"],
                })

    chosen = _pick_winner(scores)
    return {"chosen": chosen, "scores": scores, "evidence": evidence}


def _pick_winner(scores: dict[str, int]) -> str:
    """Highest score wins. Ties broken by 'clean-architecture' if present,
    else by alphabetical id (deterministic)."""
    if not scores:
        return "clean-architecture"
    max_score = max(scores.values())
    candidates = sorted(tid for tid, s in scores.items() if s == max_score)
    if max_score == 0:
        return "clean-architecture" if "clean-architecture" in candidates else candidates[0]
    if "clean-architecture" in candidates and len(candidates) > 1:
        return "clean-architecture"
    return candidates[0]


def _glob_top_two_levels(root: Path, pattern: str) -> list[Path]:
    """Match `pattern` at project root and one level down. Avoids walking
    huge trees for what should be top-level config files."""
    if "/" in pattern:
        # Caller already wrote a relative path like "app/build.gradle.kts"
        return list(root.glob(pattern))
    out = list(root.glob(pattern))
    for child in root.iterdir():
        if child.is_dir() and child.name not in _SKIP_DIRS:
            out.extend(child.glob(pattern))
    return out


def _read_manifests(root: Path) -> str:
    """Read every known manifest file (top-level only) into one big string
    for substring matching. Returns '' if none found or all unreadable."""
    blobs = []
    for name in _MANIFEST_FILES:
        path = root / name
        if path.is_file():
            try:
                blobs.append(path.read_text(errors="ignore"))
            except OSError:
                continue
    return "\n".join(blobs)


def _list_project_dirs(root: Path) -> list[str]:
    """All directory paths relative to root, normalized with forward slashes."""
    out = []
    for path in root.rglob("*"):
        if not path.is_dir():
            continue
        parts = path.relative_to(root).parts
        if any(p in _SKIP_DIRS for p in parts):
            continue
        out.append("/".join(parts))
    return out
```

- [ ] **Step 2: Smoke test the loader**

Run from repo root:
```bash
python3 -c "
import sys; sys.path.insert(0, '.')
from pathlib import Path
from scripts.lib.templates import load_templates, detect_template
tpls = load_templates(Path('.'))
print(f'loaded {len(tpls)} templates: {[t[\"id\"] for t in tpls]}')
r = detect_template(Path('.'), tpls)
print(f'chosen: {r[\"chosen\"]}')
print(f'scores: {r[\"scores\"]}')
print(f'evidence (first 5):')
for e in r['evidence'][:5]:
    print(f'  {e}')
"
```

Expected: 6 templates loaded; some template wins on this repo (likely cli-tool or pipeline since the repo has `scripts/` + `commands/`); evidence list is non-empty.

If PyYAML isn't installed: `loaded 0 templates`. That's expected — the runtime path in Task 4 falls back to embedded clean-architecture.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/templates.py
git commit -m "feat(templates): add template loader and project-signal detector

load_templates() reads templates/*.yml; detect_template() scores each
against the project by globbing top-level files, substring-matching
dependency manifests, and counting directory-name occurrences (capped).
Ties broken deterministically toward clean-architecture."
```

---

## Task 3: Refactor `scripts/lib/layers.py`

**Files:**
- Modify: `scripts/lib/layers.py`

- [ ] **Step 1: Rewrite `scripts/lib/layers.py` end-to-end**

```python
"""
Layer assignment by path segments + name suffixes.

Three-level config resolution (highest precedence first):
  1. <project_root>/.code-map/layers.yml — user override, no detection.
  2. <plugin_root>/templates/*.yml + signal-based detection.
  3. Embedded clean-architecture fallback (used if templates/ missing
     or PyYAML absent).

Path segments are checked right-to-left so deeper packages outweigh
the prefix. Falls back to name-suffix matching, then "uncategorized".
"""
from __future__ import annotations
from pathlib import Path
from typing import Iterable, Optional
from .extractors.base import Declaration
from . import templates as _templates


# Minimal embedded fallback used only when templates/ is unavailable.
# When templates/ is present, templates/clean-architecture.yml supersedes
# this — kept here only so the framework can produce *something* if the
# plugin install is incomplete.
_EMBEDDED_FALLBACK = [
    {
        "id": "presentation", "name": "Presentation", "order": 0,
        "summary": "UI, navigation, view models, controllers",
        "path_segments": ["presentation", "ui", "view", "screen", "compose",
                          "components", "pages", "handlers", "controllers",
                          "routes", "endpoints"],
        "name_suffixes": ["Activity", "Fragment", "ViewModel", "Screen",
                          "Controller", "View", "Page", "Handler", "Route"],
    },
    {
        "id": "domain", "name": "Domain", "order": 1,
        "summary": "Business rules, use cases, entities",
        "path_segments": ["domain", "usecase", "use_case", "model", "entity",
                          "service", "logic", "core"],
        "name_suffixes": ["UseCase", "Service", "Model", "Entity", "Aggregate",
                          "DomainEvent", "Policy"],
    },
    {
        "id": "data", "name": "Data", "order": 2,
        "summary": "Repositories, data sources, persistence, APIs",
        "path_segments": ["data", "repository", "repo", "dao", "datasource",
                          "db", "store", "persistence", "api", "client",
                          "gateway", "remote", "local"],
        "name_suffixes": ["Repository", "Dao", "DataSource", "Store",
                          "Client", "Gateway", "Api"],
    },
    {
        "id": "infrastructure", "name": "Infrastructure", "order": 3,
        "summary": "DI, network, utilities, build/runtime plumbing",
        "path_segments": ["di", "ioc", "inject", "network", "net", "util",
                          "utils", "common", "shared", "internal", "pkg",
                          "cmd", "lib", "bin", "config", "infra"],
        "name_suffixes": ["Factory", "Module", "Provider", "Container",
                          "Helper", "Util", "Config", "Bootstrap"],
    },
]

_UNCATEGORIZED = {
    "id": "uncategorized", "name": "Uncategorized", "order": 99,
    "summary": "Could not be assigned automatically",
    "path_segments": [], "name_suffixes": [],
}


# Public — kept for backward compatibility with code that imported it.
DEFAULT_CONFIG = _EMBEDDED_FALLBACK + [_UNCATEGORIZED]


def load_config(project_root: Path, plugin_root: Optional[Path] = None
                ) -> tuple[list[dict], Optional[dict]]:
    """Return (layer_config, detection_result | None).

    Precedence:
      1. <project_root>/.code-map/layers.yml — user override.
      2. <plugin_root>/templates/*.yml + detection.
      3. Embedded fallback (clean-architecture).
    """
    # 1. User override
    override = _load_user_override(project_root)
    if override is not None:
        return _ensure_uncategorized(override), None

    # 2. Templates + detection
    if plugin_root is not None:
        tpls = _templates.load_templates(plugin_root)
        if tpls:
            detection = _templates.detect_template(project_root, tpls)
            chosen = next((t for t in tpls if t["id"] == detection["chosen"]), tpls[0])
            return _ensure_uncategorized(list(chosen["layers"])), detection

    # 3. Embedded fallback
    return list(DEFAULT_CONFIG), None


def _load_user_override(project_root: Path) -> Optional[list[dict]]:
    cfg_path = project_root / ".code-map" / "layers.yml"
    if not cfg_path.exists():
        return None
    try:
        import yaml  # type: ignore
    except ImportError:
        return None
    try:
        with open(cfg_path) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception:
        return None
    layers = cfg.get("layers")
    if not isinstance(layers, list) or not layers:
        return None
    return layers


def _ensure_uncategorized(layers: list[dict]) -> list[dict]:
    if not any(l.get("id") == "uncategorized" for l in layers):
        return list(layers) + [_UNCATEGORIZED]
    return list(layers)


def assign_layer(decl: Declaration, layers: list[dict]) -> str:
    """Return the layer id this declaration belongs to."""
    path_segments = [s.lower() for s in Path(decl.path).parts]
    namespace_segments = [s.lower() for s in (decl.namespace or "").replace("::", ".").split(".") if s]
    segments = list(reversed(path_segments + namespace_segments))  # rightmost wins

    # First pass: path/namespace segments
    for seg in segments:
        for layer in layers:
            if seg in [s.lower() for s in layer.get("path_segments", []) or []]:
                return layer["id"]
    # Second pass: name suffixes
    for layer in layers:
        for suf in layer.get("name_suffixes", []) or []:
            if decl.name.endswith(suf):
                return layer["id"]
    return "uncategorized"


def apply_to(declarations: Iterable[Declaration], layers: list[dict]) -> None:
    for d in declarations:
        d._layer = assign_layer(d, layers)  # type: ignore[attr-defined]
```

- [ ] **Step 2: Smoke test the resolver**

Run from repo root:
```bash
python3 -c "
import sys; sys.path.insert(0, '.')
from pathlib import Path
from scripts.lib.layers import load_config

# Plugin root = this repo; project root = same repo for the smoke check
cfg, det = load_config(Path('.'), Path('.'))
print(f'layers: {[l[\"id\"] for l in cfg]}')
print(f'detection.chosen: {det[\"chosen\"] if det else None}')
print(f'detection.scores: {det[\"scores\"] if det else None}')
"
```

Expected: layers list ends with `uncategorized`. If PyYAML installed: detection is non-None and `chosen` reflects this repo's signals. Else: `detection: None` and the embedded fallback is used.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/layers.py
git commit -m "refactor(layers): three-level config (user yml > templates > embedded)

load_config(project_root, plugin_root) now returns (config, detection),
where detection carries the scoring evidence from templates.detect_template.
The embedded DEFAULT_CONFIG is kept only as a last-resort fallback when
templates/ is missing or PyYAML is unavailable."
```

---

## Task 4: Wire detection into `scripts/analyze.py`

**Files:**
- Modify: `scripts/analyze.py`

- [ ] **Step 1: Edit `scripts/analyze.py` to pass `plugin_root` and emit detection**

Find the block around line 70-75 that currently reads:
```python
    layer_config = layers.load_config(root)
```
Replace with:
```python
    # plugin_root resolves to this script's grandparent (the build-code-map repo).
    # When the plugin is installed normally, $CLAUDE_PLUGIN_ROOT also points here.
    plugin_root = Path(os.environ.get("CLAUDE_PLUGIN_ROOT") or HERE.parent)
    layer_config, detection = layers.load_config(root, plugin_root)
```

Find the `project_meta = { ... }` block (around line 110) and add the detection key. Replace the whole assignment with:
```python
    project_meta = {
        "name": args.name or root.name,
        "root": str(root),
        "languages": sorted(lang_counts.keys()),
        "files_scanned": len(files),
        "files_by_language": dict(files_by_lang),
        "declarations_by_language": dict(lang_counts),
        "parse_failures": parse_failures,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    if detection is not None:
        project_meta["template_detection"] = detection
```

Find the print block at the bottom (around line 142-147). After the existing `print(f"[analyze] languages: ...")` line, insert:
```python
    if detection is not None:
        ranked = sorted(detection["scores"].items(), key=lambda kv: kv[1], reverse=True)[:3]
        ranked_str = ", ".join(f"{tid}={sc}" for tid, sc in ranked)
        print(f"[analyze] template: {detection['chosen']} (top: {ranked_str})")
```

- [ ] **Step 2: Run analyze end-to-end against this repo**

```bash
rm -rf /tmp/build-code-map-self
python3 scripts/analyze.py --root . --out /tmp/build-code-map-self/raw_structure.json --name build-code-map-self
```

Expected stdout: includes a `[analyze] template: <id> (top: ...)` line. If PyYAML is absent locally, the line is omitted (detection is None) and the run still succeeds with embedded fallback layers.

- [ ] **Step 3: Check the output JSON**

```bash
python3 -c "
import json
d = json.load(open('/tmp/build-code-map-self/raw_structure.json'))
print('project keys:', sorted(d['project'].keys()))
print('layer ids:', [l['id'] for l in d['layers']])
if 'template_detection' in d['project']:
    td = d['project']['template_detection']
    print('chosen:', td['chosen'])
    print('top scores:', sorted(td['scores'].items(), key=lambda kv: -kv[1])[:3])
"
```

Expected: `template_detection` (when PyYAML installed) and `layers` list reflects the chosen template.

- [ ] **Step 4: Commit**

```bash
git add scripts/analyze.py
git commit -m "feat(analyze): emit template_detection + chosen-template stdout line

Phase 1 now resolves the plugin root, asks layers.load_config for the
detection result, writes it under project.template_detection in
raw_structure.json, and prints a one-line summary so the user can see
which template won and the runners-up."
```

---

## Task 5: Phase 2 contract — update `commands/build-code-map.md`

**Files:**
- Modify: `commands/build-code-map.md`

- [ ] **Step 1: Insert Phase 2 step 0 and rewrite step 4**

Find the line `## Phase 2: semantic refinement (your job)`. After it, the existing numbered steps start with `1. \`Read\` \`.code-map/raw_structure.json\`...`. Insert a new step 0 BEFORE step 1, and rewrite step 4.

Replace the entire Phase 2 numbered list (steps 1–7) with:

```markdown
0. **Verify the architecture.** Read `project.template_detection` from `raw_structure.json` — it carries `chosen`, `scores`, and `evidence` from Phase 1's signal-based detection. Glob the project top level (`app/`, `src/`, `cmd/`, `internal/`, `frontend/`, etc.) to confirm or rebut the call. Pick one:

   - **Accept** — Phase 1's pre-assigned layers are the final architecture. Proceed.
   - **Swap** — load a different template from `${CLAUDE_PLUGIN_ROOT}/templates/<name>.yml` and replace `raw_structure.json`'s `layers[]` with that template's `layers` (with empty `classes` arrays). Step 4 will reassign every class.
   - **Tweak** — keep the chosen template but rename / add / remove / merge layers. Each layer id within `layers[]` must remain unique. The frontend reads `name` and `summary`, so renaming is purely cosmetic to the UI.

   Record the decision in the output as:
   ```json
   "project": {
     ...,
     "architecture": {"template": "<id>", "customized": <bool>}
   }
   ```
   Set `customized: true` if you swapped templates or tweaked the layer set.

   If `template_detection.scores` are all 0 or very low, the detector had nothing to go on — be more skeptical and more willing to swap.

1. `Read` `.code-map/raw_structure.json` and `.code-map/unresolved.json`.

2. For every class in `raw_structure.json`, examine its file briefly (`Read` the path, look at the top of the file and the class declaration) and produce a **one-sentence description** that explains what this declaration does at the architecture level. Skip mechanical detail; capture intent.

3. Walk the `unresolved.json.skipped` list:
   - If the file is genuinely empty/generated/test code → mark with `tags: ["excluded"]` in the output (do not include in code-map.json).
   - If tree-sitter just couldn't parse it but the file looks important (read it yourself) → add it back manually with `confidence: "ai-inferred"` and `tags: ["ai-inferred"]`. Include just `name`, `namespace`, `kind`, `path`, `line`, and a description.

4. **Re-route classes** against the final architecture from step 0. For each class, ask: does its current layer match what the code actually does? If not, move it from the source layer's `classes` array to the target layer's `classes` array. If step 0 swapped templates, every class needs reassignment — use the new template's `path_segments` / `name_suffixes` as guidance plus the class's actual role. Genuinely ambiguous classes go to `uncategorized`.

5. Apply the focus hint if `$1` was a focus string. Surface relevant classes by marking `core: true` and writing emphatic descriptions.

6. Mark entry points: any class with `MainActivity`, `*Application`, `App`, `main`, or path containing `/cmd/` should have `core: true` and `tags` include `"entry-point"`.

7. `Write` the final `.code-map/code-map.json`. Same shape as `raw_structure.json` but with descriptions populated, the `project.architecture` field set, and any manual overrides applied.
```

(The "**Important**:" paragraph after step 7 stays as-is.)

- [ ] **Step 2: Commit**

```bash
git add commands/build-code-map.md
git commit -m "docs(command): Phase 2 step 0 (verify architecture) and step 4 rewrite

AI now reads project.template_detection, decides whether to accept,
swap, or tweak the template, and records the final choice under
project.architecture. Step 4 explicitly covers full re-routing when
the template was swapped."
```

---

## Task 6: Update `examples/default-layers.yml`

**Files:**
- Modify: `examples/default-layers.yml`

- [ ] **Step 1: Rewrite `examples/default-layers.yml`**

Replace the file content entirely with:

```yaml
# build-code-map — user override example.
#
# Copy this to `<project>/.code-map/layers.yml` to fully override
# template detection. When this file is present, build-code-map skips
# the detector and uses these layers verbatim.
#
# This is the same shape as the bundled templates in `templates/`,
# minus the `signals` block (which only the detector consumes). You
# can omit `id`, `name`, `description`, and the top-level metadata —
# only the `layers` list is required.
#
# Right-to-left matching: path segments are checked from the rightmost
# segment inward, so deeper packages outweigh the prefix
# (e.g. `app/domain/order/data/...` lands in `data`, not `domain`).
# After path matching fails, name-suffix matching runs as a fallback.
# Anything still unmatched lands in the `uncategorized` layer
# (auto-appended if you omit it).
#
# Example below is the bundled Clean Architecture template. To see the
# other shipped shapes, browse the plugin's `templates/` directory.

layers:
  - id: presentation
    name: Presentation
    order: 0
    summary: "UI, navigation, view models, controllers"
    path_segments:
      - presentation
      - ui
      - view
      - screen
      - compose
      - components
      - pages
      - handlers
      - controllers
      - routes
      - endpoints
    name_suffixes:
      - Activity
      - Fragment
      - ViewModel
      - Screen
      - Controller
      - View
      - Page
      - Handler
      - Route

  - id: domain
    name: Domain
    order: 1
    summary: "Business rules, use cases, entities"
    path_segments:
      - domain
      - usecase
      - use_case
      - model
      - entity
      - service
      - logic
      - core
    name_suffixes:
      - UseCase
      - Service
      - Model
      - Entity
      - Aggregate
      - DomainEvent
      - Policy

  - id: data
    name: Data
    order: 2
    summary: "Repositories, data sources, persistence, APIs"
    path_segments:
      - data
      - repository
      - repo
      - dao
      - datasource
      - db
      - store
      - persistence
      - api
      - client
      - gateway
      - remote
      - local
    name_suffixes:
      - Repository
      - Dao
      - DataSource
      - Store
      - Client
      - Gateway
      - Api

  - id: infrastructure
    name: Infrastructure
    order: 3
    summary: "DI, network, utilities, build/runtime plumbing"
    path_segments:
      - di
      - ioc
      - inject
      - network
      - net
      - util
      - utils
      - common
      - shared
      - internal
      - pkg
      - cmd
      - lib
      - bin
      - config
      - infra
    name_suffixes:
      - Factory
      - Module
      - Provider
      - Container
      - Helper
      - Util
      - Config
      - Bootstrap

  - id: uncategorized
    name: Uncategorized
    order: 99
    summary: "Could not be auto-assigned — review and override here"
    path_segments: []
    name_suffixes: []
```

- [ ] **Step 2: Commit (bundled with Task 7 if desired, or alone)**

```bash
git add examples/default-layers.yml
git commit -m "docs(examples): default-layers.yml as the user-override walkthrough"
```

---

## Task 7: Update `README.md` and `CLAUDE.md`

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate the layers section in `README.md`**

Run: `grep -n -i "layer\|template" README.md | head -20`

Identify the paragraph that describes the current 4-layer Clean Architecture default. Replace it with a "Templates" section listing the 6 templates and the precedence rule.

- [ ] **Step 2: Add the templates section**

The replacement copy (adapt headings to match the existing structure):

```markdown
### Templates

The plugin ships with six architectural templates. Phase 1 picks one
per project by scanning filesystem signals (build files, dependencies,
directory names); Phase 2 AI verifies and may swap or tweak it.

| Template | Layers |
| --- | --- |
| `clean-architecture` | Presentation → Domain → Data → Infrastructure |
| `mvc` | Controller → Model → View → Infrastructure |
| `hexagonal` | Application → Domain → Ports → Adapters → Infrastructure |
| `frontend-spa` | Pages → Components → Hooks/State → API/Services → Utils |
| `cli-tool` | Entry → Commands → Core → Util |
| `pipeline` | Input → Parse → Transform → Output |

Precedence: a `.code-map/layers.yml` in the target project wins outright
(detection is skipped). Otherwise the detector picks the template with
the highest signal score. If signals are weak, Phase 2 AI is more likely
to swap. To fully customize, copy `examples/default-layers.yml` to
`<project>/.code-map/layers.yml`.
```

- [ ] **Step 3: Update `CLAUDE.md`**

Find the section "Layer assignment is right-to-left." Replace it with:

```markdown
**Templates and layer assignment.** Phase 1 picks a template from `templates/*.yml` by signal-scoring the project (files / manifest deps / directory names). The winner's `layers` become the predefined buckets; Phase 2 AI can accept, swap, or tweak.

Within a template, `layers.assign_layer` reverses path + namespace segments so deeper packages outweigh prefixes (e.g. `app/domain/order/data/...` lands in `data`, not `domain`). First pass matches `path_segments`, second pass matches `name_suffixes`, fallback is `uncategorized`. The user may bypass detection entirely with `<project>/.code-map/layers.yml`; PyYAML is optional (silently falls back to the embedded clean-architecture config if missing).
```

Also under "Repo layout", update the tree to add the `templates/` directory and `scripts/lib/templates.py`. The relevant lines should read:

```
templates/
  clean-architecture.yml  mvc.yml  hexagonal.yml
  frontend-spa.yml  cli-tool.yml  pipeline.yml
scripts/
  bootstrap.py  analyze.py  serve.py
  lib/
    core.py  layers.py  templates.py
    extractors/
      ...
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: cover the templates system in README and CLAUDE.md

README ships the six-template table and precedence summary. CLAUDE.md
replaces the right-to-left layer rule with a templates-aware invariant
and updates the repo layout to include templates/ and templates.py."
```

---

## Task 8: End-to-end verification

**Files:** none modified

- [ ] **Step 1: Run analyze against this repo**

```bash
rm -rf /tmp/bcm-verify && \
python3 scripts/analyze.py --root . --out /tmp/bcm-verify/raw_structure.json --name self-test
```

Expected stdout includes:
- `[analyze] languages: python`
- `[analyze] template: <id> (top: ...)` (only if PyYAML installed)
- `[analyze] wrote /tmp/bcm-verify/raw_structure.json`

- [ ] **Step 2: Inspect the JSON**

```bash
python3 -c "
import json
d = json.load(open('/tmp/bcm-verify/raw_structure.json'))
p = d['project']
print('languages:', p['languages'])
print('files_scanned:', p['files_scanned'])
print('layer ids:', [l['id'] for l in d['layers']])
if 'template_detection' in p:
    td = p['template_detection']
    print('chosen:', td['chosen'])
    print('scores:', td['scores'])
    print('evidence count:', len(td['evidence']))
else:
    print('detection: None (PyYAML missing or templates/ empty)')
"
```

Expected: layer ids end with `uncategorized`; detection info present (when PyYAML available).

- [ ] **Step 3: Confirm bundled sample is not broken**

```bash
python3 -c "
import json
d = json.load(open('examples/sample-code-map.json'))
print('sample layers:', [l['id'] for l in d['layers']])
print('sample classes total:', sum(len(l.get('classes', [])) for l in d['layers']))
"
```

Expected: layer ids and class totals unchanged from before — the sample is a static fixture and serve.py reads it byte-for-byte.

- [ ] **Step 4: Confirm `.code-map/layers.yml` override path still works**

```bash
mkdir -p /tmp/bcm-override/.code-map && \
cp examples/default-layers.yml /tmp/bcm-override/.code-map/layers.yml && \
echo 'def foo(): pass' > /tmp/bcm-override/app.py && \
python3 scripts/analyze.py --root /tmp/bcm-override --out /tmp/bcm-override/.code-map/raw_structure.json --name override-test
```

Expected stdout: no `[analyze] template:` line (detection is skipped under user override).

```bash
python3 -c "
import json
d = json.load(open('/tmp/bcm-override/.code-map/raw_structure.json'))
print('template_detection in project:', 'template_detection' in d['project'])
print('layer ids:', [l['id'] for l in d['layers']])
"
```

Expected: `template_detection in project: False`; layer ids match `examples/default-layers.yml`.

- [ ] **Step 5: Cleanup**

```bash
rm -rf /tmp/bcm-verify /tmp/bcm-override /tmp/build-code-map-self
```

No commit — pure verification.

---

## Self-review

- Templates: ✓ six files, ✓ shared schema with `signals.{files,dependencies,paths}`, ✓ `uncategorized` auto-appended in `_ensure_uncategorized`.
- Detector: ✓ scoring across files/deps/paths, ✓ path count capped, ✓ deterministic tie-break, ✓ stderr warnings on bad templates.
- Resolver: ✓ three-level precedence (user yml → detection → embedded), ✓ PyYAML-optional, ✓ signature `(project_root, plugin_root)` and return `(config, detection|None)`.
- `analyze.py`: ✓ plugin_root resolution, ✓ `template_detection` written when non-None, ✓ stdout summary line.
- Phase 2 contract: ✓ step 0 covers accept/swap/tweak, ✓ writes `project.architecture`, ✓ step 4 covers full re-routing.
- Frontend / `core.py` / `serve.py` / extractors: untouched, as designed.
