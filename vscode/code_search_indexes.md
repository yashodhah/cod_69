# Code Search Indexes: Key Findings

## The Core Problem

"Finding code" is not one problem — it's three distinct problems that require different index structures:

- **Lexical**: find the string "authentication" somewhere in the codebase
- **Structural**: find the function that *is* the auth system, even if it's called `SessionManager`
- **Semantic**: find all code that *participates* in auth, including code that doesn't know it's related

Most search tools only solve the first. Good code intelligence tools solve all three with a layered index architecture.

-----

## The Three Index Primitives

### 1. Inverted / Trigram Index

The foundation of grep, ripgrep, and basic code search. It tokenizes source code and builds a term-to-document mapping. A trigram variant indexes all 3-character substrings, enabling fast partial and fuzzy matches.

**Strengths:** Exact symbol lookup, zero false negatives for known terms, very fast at scale.

**Weakness:** No understanding of relationships. It cannot know that `refreshCredentials` and `handleTokenRefresh` are the same concept, or that one calls the other.

-----

### 2. Symbol / Graph Index (what GitHub Blackbird is)

Built on a proper parse of the code — not just tokenization — to extract the AST and understand code structure. It tracks:

- **Definitions**: where a symbol is declared
- **References**: where it is called or accessed
- **Relationships**: what it calls, what calls it, what it implements

The result is a graph where nodes are symbols and edges are structural relationships (calls, imports, implements, extends).

Blackbird specifically adds **syntax-awareness** to this — it distinguishes between a symbol appearing as a definition, a reference, a comment, or a string literal. This is critical: when searching for a symbol, you want the definition and its callers, not unrelated string occurrences.

**Strengths:** Highly precise, supports call graph traversal (finding all code involved in a feature, not just its entry point), fast.

**Weakness:** Requires the code to be parsed and indexed in advance. Uncommitted local changes won't be in it. Also doesn't handle conceptual synonyms — it won't connect `SessionManager.renew()` to "session expiry" unless there's a lexical overlap somewhere.

-----

### 3. Embedding / Vector Index (semantic search)

Chunks code into units, embeds each chunk into a high-dimensional vector, and stores in a vector database. At query time, the question is embedded and nearest-neighbor search finds semantically similar chunks.

The **chunking strategy is critical**. Naive token-window chunking produces incoherent chunks (half a function body, a closing brace). AST-aware chunking — embedding complete functions and classes — produces meaningful units with coherent embeddings.

Code-specific embedding models (CodeBERT, UniXcoder) significantly outperform general text embedding models because they learn functional equivalence patterns from code structure, not linguistic co-occurrence from prose.

**Strengths:** Handles conceptual queries with no lexical overlap with the answer. Bridges naming convention variation across codebases. Best for new developers who don't know the codebase's terminology.

**Weakness:** Unreliable for symbol-precise queries. High-dimensional vector spaces tend toward uniform distances (the curse of dimensionality), making it imprecise compared to a symbol index for well-defined lookups. Also slow to build and query at scale.

-----

## How Copilot Composes These Layers

```
Query: "how does session expiry work?"
         │
         ▼
┌──────────────────────────────────────┐
│  GitHub Blackbird (Symbol Index)     │
│  Primary path for committed code     │
│  → Extract candidate symbols         │
│  → Look up definitions + callers     │
│  → Traverse call graph 1-2 hops      │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Local Diff (Embedding + TF-IDF)     │
│  Covers uncommitted changes only     │
│  → Embeddings if diff < 300 files    │
│  → Falls back to TF-IDF              │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Re-ranking                          │
│  → Filter top 65% by embedding score │
│  → Removes symbol matches that are   │
│    lexically relevant but            │
│    semantically off-topic            │
└──────────────────────────────────────┘
```

The re-ranking step is the clever part: Blackbird gives high-precision symbol matches (it won't miss anything containing "session"), but those matches may include dead code, test files, and documentation. The embedding score acts as a **semantic relevance filter** to trim Blackbird results to the ones that are actually about the concept being asked about.

-----

## Why Symbol-First Is the Right Priority Order

When developers ask about code, they almost always use terms that exist as real identifiers in the codebase — even if approximate. The symbol index handles this case more precisely and faster than embeddings.

Embedding search adds genuine value in narrower scenarios:

- Queries from developers unfamiliar with the codebase's naming conventions
- Behavioral queries where the concept is distributed across many unrelated symbol names (e.g., "where does the timeout get set?" when the variable is `REQUEST_DEADLINE_MS`)
- Cross-cutting concerns with no single entry point

This is why local embedding search is correctly placed as the fallback for uncommitted content — not as the primary retrieval path.

-----

## Index Trade-off Summary

| Index Type         | Build Cost            | Query Speed | Handles Synonyms | Best For                          |
|--------------------|-----------------------|-------------|------------------|-----------------------------------|
| Inverted / Trigram | Low                   | Very fast   | No               | Known symbol lookup               |
| Symbol / Graph     | High (requires parse) | Fast        | Partially        | Structural traversal, call graphs |
| Embedding / Vector | Medium                | Medium      | Yes              | Conceptual / behavioral queries   |

-----

## What Would Actually Improve Code Semantic Search

1. **AST-level chunking** — embed functions and classes, not arbitrary token windows
1. **Code-specific embedding models** — models trained on code structure, not prose
1. **Graph-augmented retrieval** — combine embeddings with the call graph so a match also surfaces callers and callees
1. **Query expansion** — use an LLM to rewrite vague questions into concrete symbol-name candidates before hitting the index

Copilot's architecture is doing a pragmatic version of points 3 and 4 through Blackbird's graph-awareness and the LLM-based re-ranker in the search panel.
