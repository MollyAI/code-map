# Design: 7 new architecture templates + Subsystem layout view

Date: 2026-05-30
Status: Approved for planning

## Goal

Two independent, non-overlapping additions to the `code-map` plugin:

1. **Templates** — add 7 architecture templates (total 6 → 13): `layered`, `mvvm`,
   `mvp`, `cqrs`, `mvi`, `ecs`, `microkernel`. Pure additions under `templates/*.yml`
   plus one small detection-infra change in `scripts/lib/templates.py`.
2. **Subsystem layout view** — a second grouping mode in `viewer/index.html`:
   group nodes by top-level module/subsystem (derived from file paths) instead of
   by architecture layer. Pure front-end; reuses the existing band renderer.

Non-goals (explicitly out of scope, decided during brainstorming): dependency/call
DAG layout, package-hierarchy tree layout, force-directed graph. No changes to the
extractor framework, `core.py`, or `layers.py` assignment logic.

## Architectural fit

- A template is a `{id, name, description, layers[], signals}` YAML. `lib/templates.py`
  signal-scores every template against the project and picks a winner deterministically;
  `lib/layers.py` assigns each declaration to a layer by right-to-left path/namespace
  segment matching then name-suffix matching. Adding templates requires **no core code
  change** — only new YAML files (+ the manifest-scan widening below).
- Detection is a best-guess; **Phase 2 (AI, `commands/build.md`) verifies and may swap
  templates.** This is the established philosophy (CLAUDE.md: "miss rather than
  misidentify", Phase 1 auditable, Phase 2 judgment). Adding overlapping templates is
  therefore safe: ties resolve to a best guess and Phase 2 corrects.
- The viewer reads only `layer.name`, `layer.summary`, `layer.classes` for rendering,
  plus each class's `path` / `namespace` / `core` / `importance`. Subsystem grouping is
  computable entirely client-side from data already in `code-map.json`.

---

## Part A — Templates

### A.0 Detection-infra change (`scripts/lib/templates.py`)

Dependency signals only fire for manifests that `_read_manifests` reads, and today it
reads a fixed list of exact filenames. .NET (`*.csproj`), Swift (`Package.swift`),
C/C++ (`CMakeLists.txt`), and Dart (`pubspec.yaml`) manifests are never read, so
dependency signals like `MediatR` / `entt` would silently never match.

Change: after reading the fixed `_MANIFEST_FILES`, also glob a small set of
**patterned** manifests at the project root and one level down (reuse the existing
`_glob_top_two_levels` bound so it stays cheap), and append their text to the blob:

```
_MANIFEST_GLOBS = ("*.csproj", "*.vcxproj", "Package.swift", "pubspec.yaml", "CMakeLists.txt")
```

File-presence signals (`signals.files`) already work for any pattern via
`_glob_top_two_levels`, so no change is needed there. Path signals need nothing.

`_pick_winner` is **unchanged** — keep the deterministic clean-architecture / alphabetical
tie-break. Each new template gets high-weight "home-turf" path signals (e.g. `viewmodel/`
at weight 5) so genuine matches break ties naturally; residual ambiguity is Phase 2's job.

### A.1 `templates/layered.yml`

The dominant Spring Boot / .NET / NestJS enterprise-backend shape. Currently misdetected
as MVC (but REST backends have no View layer; they have Service + Repository).

```yaml
id: layered
name: "Layered (N-Tier)"
description: "Controller dispatches to a Service; Service uses a Repository; Repository persists Domain entities."
layers:
  - {id: api,        name: "API / Controllers",        order: 0, summary: "HTTP controllers, REST endpoints, request handling",
     path_segments: [controllers, controller, api, rest, web, resources, endpoints, routes, http],
     name_suffixes: [Controller, Resource, Endpoint, Rest, Api]}
  - {id: service,    name: "Service",                  order: 1, summary: "Business logic, application services, orchestration",
     path_segments: [services, service, application, usecases, business, logic],
     name_suffixes: [Service, ServiceImpl, Manager, Facade, UseCase, Orchestrator]}
  - {id: repository, name: "Repository / Persistence", order: 2, summary: "Data access — repositories, DAOs, ORM mappers",
     path_segments: [repository, repositories, repo, dao, persistence, mapper, mappers, datasource],
     name_suffixes: [Repository, RepositoryImpl, Dao, Mapper, Store, DataSource]}
  - {id: domain,     name: "Domain / Model",           order: 3, summary: "Entities, DTOs, value objects, domain model",
     path_segments: [domain, model, models, entity, entities, dto, dtos, vo, pojo, bean, beans],
     name_suffixes: [Entity, Model, Dto, Vo, Pojo, Bean]}
  - {id: infrastructure, name: "Infrastructure / Config", order: 4, summary: "Configuration, security, cross-cutting, utilities",
     path_segments: [config, configuration, infra, infrastructure, security, common, shared, util, utils, exception, exceptions, filter, interceptor],
     name_suffixes: [Config, Configuration, Properties, Filter, Interceptor, Exception, Aspect, Util, Helper]}
signals:
  files:
    - {match: "application.properties", weight: 4}
    - {match: "application.yml",        weight: 4}
    - {match: "application.yaml",       weight: 4}
    - {match: "nest-cli.json",          weight: 5}
    - {match: "*.csproj",               weight: 2}
    - {match: "pom.xml",                weight: 1}
    - {match: "build.gradle*",          weight: 1}
  dependencies:
    - {match: "spring-boot-starter-data-jpa", weight: 4}
    - {match: "spring-boot-starter-web",      weight: 3}
    - {match: "spring-boot-starter",          weight: 2}
    - {match: "@nestjs/common",               weight: 4}
    - {match: "@nestjs/core",                 weight: 3}
    - {match: "Microsoft.AspNetCore",         weight: 3}
    - {match: "Microsoft.EntityFrameworkCore", weight: 3}
  paths:
    - {match: "service",      weight: 3}
    - {match: "services",     weight: 3}
    - {match: "repository",   weight: 3}
    - {match: "repositories", weight: 3}
    - {match: "controller",   weight: 2}
    - {match: "controllers",  weight: 2}
    - {match: "dao",          weight: 2}
```

Disambiguation: vs **MVC** — MVC has high `views` weight + Rails/Django/Laravel deps;
layered has `service`+`repository`+spring-data/nest. vs **clean-architecture** — clean
scores on `usecase`/`domain` dirs + androidx/dagger/hilt; layered does not list `usecase`
in signals.

### A.2 `templates/mvvm.yml`

```yaml
id: mvvm
name: "MVVM"
description: "View binds to a ViewModel; the ViewModel exposes observable state from the Model."
layers:
  - {id: view,      name: "View",              order: 0, summary: "Activities, fragments, composables, screens — the UI",
     path_segments: [view, views, ui, screen, screens, page, pages, activity, activities, fragment, fragments, compose, widget, widgets],
     name_suffixes: [Activity, Fragment, View, Screen, Page, Widget, Dialog]}
  - {id: viewmodel, name: "ViewModel",         order: 1, summary: "ViewModels exposing observable UI state",
     path_segments: [viewmodel, viewmodels, vm, presentation],
     name_suffixes: [ViewModel, VM]}
  - {id: model,     name: "Model / Repository", order: 2, summary: "Repositories and domain model backing the view state",
     path_segments: [model, models, repository, repositories, repo, domain],
     name_suffixes: [Repository, Model, Entity, UseCase, Interactor]}
  - {id: data,      name: "Data / Services",   order: 3, summary: "Remote/local data sources, network, persistence",
     path_segments: [data, datasource, remote, local, network, net, api, db, service, services],
     name_suffixes: [DataSource, Service, Api, Client, Dao]}
  - {id: infrastructure, name: "Infrastructure", order: 4, summary: "DI, utilities, app wiring",
     path_segments: [di, ioc, inject, util, utils, common, shared, core],
     name_suffixes: [Module, Provider, Factory, Util, Helper]}
signals:
  files:
    - {match: "AndroidManifest.xml", weight: 3}
    - {match: "Package.swift",       weight: 1}
    - {match: "build.gradle*",       weight: 1}
  dependencies:
    - {match: "androidx.lifecycle:lifecycle-viewmodel", weight: 5}
    - {match: "lifecycle-viewmodel-compose",            weight: 4}
    - {match: "androidx.lifecycle",                     weight: 2}
    - {match: "pinia",                                  weight: 3}
    - {match: "vuex",                                   weight: 2}
  paths:
    - {match: "viewmodel",  weight: 5}
    - {match: "viewmodels", weight: 5}
    - {match: "view",       weight: 1}
    - {match: "views",      weight: 1}
```

Disambiguation: vs **clean-architecture** — MVVM is flat with no `usecase`/`domain`
*signal*; the `viewmodel/` dir (weight 5) tilts MVVM. `UseCase` remains a name-suffix in
the model layer so stray use cases still get bucketed if MVVM is chosen, without being a
*detection* signal.

### A.3 `templates/mvp.yml`

```yaml
id: mvp
name: "MVP (Model-View-Presenter)"
description: "A passive View talks to a Presenter; the Presenter drives the Model."
layers:
  - {id: view,      name: "View",      order: 0, summary: "Passive views — activities, fragments, UI",
     path_segments: [view, views, ui, screen, screens, activity, activities, fragment, fragments, page, pages],
     name_suffixes: [Activity, Fragment, View, Screen, Page]}
  - {id: presenter, name: "Presenter", order: 1, summary: "Presenters mediating between view and model",
     path_segments: [presenter, presenters, presentation],
     name_suffixes: [Presenter]}
  - {id: contract,  name: "Contract",  order: 2, summary: "View/Presenter interface contracts",
     path_segments: [contract, contracts],
     name_suffixes: [Contract]}
  - {id: model,     name: "Model",     order: 3, summary: "Domain model, repositories, interactors",
     path_segments: [model, models, data, repository, repositories, domain, entity, entities, interactor, interactors],
     name_suffixes: [Model, Repository, Entity, Interactor, UseCase]}
  - {id: infrastructure, name: "Infrastructure", order: 4, summary: "DI, networking, utilities",
     path_segments: [di, inject, network, net, util, utils, common],
     name_suffixes: [Module, Provider, Util, Helper]}
signals:
  files:
    - {match: "AndroidManifest.xml", weight: 2}
  dependencies:
    - {match: "mosby",   weight: 5}
    - {match: "nucleus", weight: 4}
  paths:
    - {match: "presenter",  weight: 5}
    - {match: "presenters", weight: 5}
    - {match: "contract",   weight: 4}
    - {match: "contracts",  weight: 4}
    - {match: "view",       weight: 1}
    - {match: "views",      weight: 1}
```

Disambiguation: `presenter/` + `contract/` dirs are a strong, near-unique MVP fingerprint;
mutually exclusive with MVVM (Presenter vs ViewModel).

### A.4 `templates/cqrs.yml`

```yaml
id: cqrs
name: "Event-Driven / CQRS"
description: "Commands and queries flow through handlers; aggregates emit events; projections build read models."
layers:
  - {id: messages,   name: "Commands & Queries",       order: 0, summary: "Command and query messages",
     path_segments: [command, commands, query, queries, cqrs, messages],
     name_suffixes: [Command, Query]}
  - {id: handlers,   name: "Handlers",                 order: 1, summary: "Command/query handlers and dispatchers",
     path_segments: [handler, handlers, dispatchers],
     name_suffixes: [Handler, CommandHandler, QueryHandler, Dispatcher]}
  - {id: domain,     name: "Domain / Aggregates",      order: 2, summary: "Aggregates, entities, value objects",
     path_segments: [domain, aggregate, aggregates],
     name_suffixes: [Aggregate, AggregateRoot, Entity, ValueObject]}
  - {id: events,     name: "Events",                   order: 3, summary: "Domain and integration events, event handlers",
     path_segments: [event, events, eventbus, subscribers],
     name_suffixes: [Event, DomainEvent, IntegrationEvent, EventHandler, Subscriber]}
  - {id: readmodels, name: "Read Models / Projections", order: 4, summary: "Projections, read models, query views",
     path_segments: [projection, projections, readmodel, readmodels, readstore],
     name_suffixes: [Projection, ReadModel]}
  - {id: infrastructure, name: "Infrastructure",       order: 5, summary: "Buses, config, wiring",
     path_segments: [infra, infrastructure, config, bus, messaging, store],
     name_suffixes: [Bus, Config, Store]}
signals:
  files: []
  dependencies:
    - {match: "axon",          weight: 5}
    - {match: "MediatR",       weight: 5}
    - {match: "@nestjs/cqrs",  weight: 5}
    - {match: "eventstore",    weight: 4}
  paths:
    - {match: "aggregate",   weight: 4}
    - {match: "aggregates",  weight: 4}
    - {match: "projection",  weight: 4}
    - {match: "projections", weight: 4}
    - {match: "commands",    weight: 3}
    - {match: "queries",     weight: 3}
    - {match: "cqrs",        weight: 5}
    - {match: "events",      weight: 2}
```

### A.5 `templates/mvi.yml`

Distinct template (not folded into MVVM, per decision).

```yaml
id: mvi
name: "MVI (Model-View-Intent)"
description: "Unidirectional flow: the View emits Intents, a reducer folds them into State, the View renders State."
layers:
  - {id: view,   name: "View",            order: 0, summary: "UI rendering state — activities, composables, screens",
     path_segments: [view, views, ui, screen, screens, compose, activity, fragment, page, pages],
     name_suffixes: [Activity, Fragment, Screen, View, Page]}
  - {id: intent, name: "Intent / Action",  order: 1, summary: "User intents and actions",
     path_segments: [intent, intents, action, actions],
     name_suffixes: [Intent, Action]}
  - {id: state,  name: "State / Reducer",  order: 2, summary: "View state, reducers, stores, side-effect processors",
     path_segments: [state, states, reducer, reducers, store, stores, mvi],
     name_suffixes: [State, ViewState, UiState, Reducer, Store]}
  - {id: model,  name: "Model / Domain",   order: 3, summary: "Use cases, repositories, domain model",
     path_segments: [model, models, domain, usecase, usecases, repository, repositories, data, interactor],
     name_suffixes: [UseCase, Repository, Model, Interactor]}
  - {id: infrastructure, name: "Infrastructure", order: 4, summary: "DI, utilities",
     path_segments: [di, inject, util, utils, common],
     name_suffixes: [Module, Provider, Util]}
signals:
  files:
    - {match: "AndroidManifest.xml", weight: 2}
  dependencies:
    - {match: "mavericks",          weight: 5}
    - {match: "com.spotify.mobius", weight: 5}
    - {match: "mobius",             weight: 4}
    - {match: "orbit-mvi",          weight: 5}
    - {match: "orbit",              weight: 3}
    - {match: "flutter_bloc",       weight: 4}
    - {match: "redux",              weight: 2}
  paths:
    - {match: "intent",   weight: 5}
    - {match: "intents",  weight: 5}
    - {match: "reducer",  weight: 5}
    - {match: "reducers", weight: 5}
    - {match: "mvi",      weight: 5}
    - {match: "state",    weight: 2}
```

Disambiguation: `intent/` + `reducer/` dirs separate MVI from MVVM (which has neither);
Redux's `state` overlaps Frontend SPA but MVI's `intent`/`reducer`/Mobius/Mavericks deps tilt it.

### A.6 `templates/ecs.yml`

```yaml
id: ecs
name: "ECS (Entity-Component-System)"
description: "Systems process entities composed of data components held in a world/registry."
layers:
  - {id: components, name: "Components",        order: 0, summary: "Data components attached to entities",
     path_segments: [component, components, comp],
     name_suffixes: [Component]}
  - {id: systems,    name: "Systems",           order: 1, summary: "Systems running logic over entities each tick",
     path_segments: [system, systems],
     name_suffixes: [System]}
  - {id: entities,   name: "Entities",          order: 2, summary: "Entity definitions, archetypes, bundles, prefabs",
     path_segments: [entity, entities, archetype, archetypes, prefab, prefabs, bundle, bundles],
     name_suffixes: [Entity, Archetype, Bundle, Prefab]}
  - {id: world,      name: "Resources / World", order: 3, summary: "Shared resources, world, registry, scheduler",
     path_segments: [resource, resources, world, registry, scheduler],
     name_suffixes: [Resource, World, Registry, Scheduler]}
  - {id: engine,     name: "Core / Engine",     order: 4, summary: "Engine plumbing, ECS core, runtime",
     path_segments: [engine, core, ecs, runtime, common],
     name_suffixes: [Engine, Dispatcher]}
signals:
  files: []
  dependencies:
    - {match: "bevy_ecs",        weight: 5}
    - {match: "bevy",            weight: 5}
    - {match: "specs",           weight: 4}
    - {match: "hecs",            weight: 4}
    - {match: "legion",          weight: 4}
    - {match: "entt",            weight: 5}
    - {match: "flecs",           weight: 5}
    - {match: "Unity.Entities",  weight: 5}
  paths:
    - {match: "systems",    weight: 4}
    - {match: "components", weight: 3}
    - {match: "ecs",        weight: 5}
    - {match: "archetype",  weight: 4}
    - {match: "entities",   weight: 2}
```

Disambiguation: `components` overlaps Frontend SPA, but `systems`(4) + `ecs`(5) +
game-engine deps (no React/Vue) separate it.

### A.7 `templates/microkernel.yml`

```yaml
id: microkernel
name: "Microkernel / Plugin"
description: "A minimal core loads plugins that extend it through well-defined contracts."
layers:
  - {id: core,      name: "Core / Host",          order: 0, summary: "The kernel/host that loads and coordinates plugins",
     path_segments: [core, host, kernel, engine, runtime],
     name_suffixes: [Kernel, Host, Engine, Runtime]}
  - {id: contracts, name: "Contracts / API",       order: 1, summary: "Extension points, SPIs, plugin-facing interfaces",
     path_segments: [api, contract, contracts, spi, interfaces, extensionpoint, extensionpoints],
     name_suffixes: [Api, Spi, Contract, ExtensionPoint]}
  - {id: plugins,   name: "Plugins / Extensions",  order: 2, summary: "Plugins, extensions, add-ons implementing the contracts",
     path_segments: [plugin, plugins, extension, extensions, addon, addons, modules, integrations],
     name_suffixes: [Plugin, Extension, Addon, Integration]}
  - {id: infrastructure, name: "Infrastructure",   order: 3, summary: "Plugin loading, registry, config, utilities",
     path_segments: [loader, registry, config, util, utils, common, internal],
     name_suffixes: [Loader, Registry, Manager, Config, Util]}
signals:
  files:
    - {match: "*plugin.json",  weight: 3}
    - {match: "manifest.json", weight: 2}
  dependencies:
    - {match: "pf4j",      weight: 5}
    - {match: "org.osgi",  weight: 4}
    - {match: "osgi",      weight: 3}
    - {match: "pluggy",    weight: 4}
    - {match: "stevedore", weight: 4}
  paths:
    - {match: "plugins",    weight: 4}
    - {match: "extensions", weight: 4}
    - {match: "plugin",     weight: 3}
    - {match: "extension",  weight: 3}
    - {match: "kernel",     weight: 4}
```

---

## Part B — Subsystem layout view (`viewer/index.html` only)

A second grouping mode. The architecture-layer bands stay the default; a new toggle
switches to module/subsystem bands. The band renderer (`layoutLayers` / `render`) is
reused verbatim — only the *grouping* that feeds it changes.

### B.1 State + persistence

- New field `state.grouping ∈ {"layer", "subsystem"}`, default `"layer"`.
- Persist with the existing `Settings` helper under key `"grouping"` (mirrors how
  `view` is persisted in `initView`).

### B.2 Topbar toggle

Add a `.toggle` group immediately after `#view-toggle`:

```html
<div class="toggle" id="group-toggle" role="group" aria-label="grouping">
  <button data-group="layer" class="active" data-i18n="group_layers">layers</button>
  <button data-group="subsystem" data-i18n="group_subsystems">subsystems</button>
</div>
```

Register `els.groupToggle`. Wire it with an `initGrouping()` IIFE that mirrors `initView`:
apply persisted value before `load()`, on click set `state.grouping`, persist, and `render()`.

### B.3 Grouping dispatch

`render()` currently calls `visibleClasses()`. Replace that call with `groupedLayers()`:

```js
function groupedLayers() {
  return state.grouping === "subsystem" ? subsystemLayers() : visibleClasses();
}
```

`visibleClasses()` (layer mode) is unchanged. Selection, edges, detail panel, core/all
filter, export, zoom all work unchanged because they key off class `id`.

### B.4 `subsystemLayers()` and the subsystem-key algorithm

1. Flatten every class from `state.raw.layers[*].classes`. If `state.view === "core"`,
   keep only `c.core` (same orthogonal filter as layer mode).
2. For each class compute normalized **path-directory** segments (path is universal across
   languages; namespace is not): `dirname(path)` → split on `/` → drop empties → lowercase.
3. Strip leading **noise** segments from each list:
   `NOISE = {src, main, java, kotlin, scala, source, sources, test, tests}`.
4. Compute the longest common leading-segment prefix shared by **all** classes' stripped
   lists and drop it (removes the shared org/root, e.g. `com/app`). Guard: never drop a
   class's *last* remaining segment — cap the strip at `len-1` per class so every class
   keeps at least one key segment (a flat single-dir project then yields one `"(root)"`
   band rather than collapsing to nothing).
5. Subsystem key = first remaining segment, or `"(root)"` if none remain.
6. Bucket classes by key. Build synthetic layers `{id: key, name: key, summary: "",
   order: i, classes: [...]}` sorted by class count **descending** (`"(root)"` sorts last).
   `id` must be unique — keys are already distinct strings.

Returned objects are the same shape `render()`/`layoutLayers()` expect, so no renderer
change. Tunables (`NOISE` set) live as a single const near the function.

### B.5 i18n

Add to both `I18N.en` and `I18N.zh`:
- `group_layers`: "layers" / "分层"
- `group_subsystems`: "subsystems" / "子系统"

`applyI18nStatic()` already applies `data-i18n` on buttons, and the lang toggle re-applies
on switch — no extra wiring beyond the two keys.

---

## Part C — Cross-cutting

- **Version**: `.claude-plugin/plugin.json` `0.3.0 → 0.4.0` (minor: new user-facing
  capability). Per CLAUDE.md this bump ships in the same push.
- **`commands/build.md`**: Phase 2 already loads templates by globbing
  `${CLAUDE_PLUGIN_ROOT}/templates/*.yml`, so no functional change is required. Optional:
  add one sentence in step 0 noting the template menu now spans 13 shapes so the AI is
  aware of the fuller set. Keep `commands/run.md` / `stop.md` untouched.
- **`README.md`**: update the template list (6 → 13) and document the Subsystems toggle.
  README is in CLAUDE.md's "skip the bump" list, so it does not drive the version, but
  ship it in sync.
- **`CLAUDE.md`**: update the "What this is" / templates references to list 13 templates
  (doc-only, no bump).

## Verification (no committed test suite — project convention)

1. **Templates / detection** — for each new template, create a throwaway fixture dir tree
   that trips its home-turf signals (e.g. `tmp/ecs-fix/systems/`, `tmp/ecs-fix/components/`
   + a `Cargo.toml` containing `bevy`), call `lib.templates.load_templates` +
   `detect_template`, and assert `chosen == <id>`. Also re-run detection against an existing
   real project to confirm no regression in the previously-chosen template. Delete fixtures
   after; nothing committed.
2. **YAML sanity** — `load_templates` parses all 13 without the "skip … missing id/layers"
   stderr warning; each `layers[]` has unique ids.
3. **Subsystem view** — `/code-map:build` an existing multi-module project, `/code-map:run`,
   toggle Subsystems: confirm bands regroup by top-level module, counts sum to the same
   total as layer mode, core/all + selection + edges still work, and the choice survives a
   reload (persistence).

## File change list

| File | Change |
|---|---|
| `templates/layered.yml` … `templates/microkernel.yml` | 7 new files (A.1–A.7) |
| `scripts/lib/templates.py` | widen `_read_manifests` with `_MANIFEST_GLOBS` (A.0) |
| `viewer/index.html` | grouping state + toggle + `groupedLayers`/`subsystemLayers` + 2 i18n keys (Part B) |
| `.claude-plugin/plugin.json` | version 0.3.0 → 0.4.0 |
| `README.md`, `CLAUDE.md` | docs: 13 templates + Subsystems view |
| `commands/build.md` | optional one-line note in step 0 |
