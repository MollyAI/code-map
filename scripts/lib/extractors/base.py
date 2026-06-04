"""
Extractor protocol — the only contract the orchestrator depends on.

A language module must define module-level:
    name: str                      # short identifier, e.g. "kotlin"
    extensions: tuple[str, ...]    # file suffixes it handles
    grammar_package: str           # PyPI distribution name to ensure-install
    parse(path, src, project_root) -> ParseResult

That's the entire surface. The framework does NOT know about tree-sitter,
Kotlin grammars, or anything language-specific. Adding a language means
adding one file under extractors/.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class Declaration:
    """An architecturally significant named declaration."""
    name: str                                    # short name: "OrderService"
    namespace: Optional[str]                     # package/module/crate path
    kind: str                                    # language-namespaced kind
    path: str                                    # path relative to project root
    line: int                                    # 1-indexed source line
    supertypes: list[str] = field(default_factory=list)
    refs: list[str] = field(default_factory=list)     # raw identifier names for edge resolution
    confidence: str = "high"                     # "high" | "low" | "ai-inferred"
    visibility: str = "public"                   # "public" | "private" (file-local, e.g. C `static`); used to disambiguate same-name edges
    tags: list[str] = field(default_factory=list)
    language: str = ""                           # set by the framework
    loc: int = 0                                 # lines of code = end_line - start_line + 1
    signature: str = ""                          # full function header (params + return); "" for non-functions
    method_count: int = 0                        # number of methods inside (classes only; best-effort for Go/Rust)

    @property
    def qualified_name(self) -> str:
        return f"{self.namespace}.{self.name}" if self.namespace else self.name


@dataclass
class ImportSpec:
    """A resolved import statement — used to turn raw refs into qualified names."""
    raw: str                                     # what the source literally says
    qualified: Optional[str] = None              # best guess at FQN
    alias: Optional[str] = None                  # local-scope alias for the raw → qualified resolution


@dataclass
class ParseResult:
    declarations: list[Declaration]
    imports: list[ImportSpec] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
