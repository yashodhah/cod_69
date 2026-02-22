

## The Core Problem with SQL Repos Specifically

SQL is structurally different from application code in ways that break standard retrieval:

**The dependency graph runs sideways.** In Python, `foo()` calls `bar()` — the call graph is explicit in the AST. In SQL, a view references a table, a stored proc references a view, a downstream ETL reads that proc, a report queries that ETL — and **none of these express the dependency explicitly as a call**. They're just string references to object names scattered across files.

So when you ask "what's the impact of changing column `user_id` in `fact_orders`?", the answer lives in:
- Views that `SELECT` from `fact_orders`
- Stored procs that `JOIN` against it
- Other tables with foreign keys (if enforced)
- ETL scripts that reference it by column name
- Downstream views built on top of *those* views

This is a **multi-hop dependency traversal** problem, and Copilot's default behavior is poorly suited for it.

---

## Why the Naive Copilot Approach Fails Here

Going back to the document's index types:

**What Copilot's local index will do:** It builds a symbol + trigram index over your open files and recently viewed context. When you ask "what's the impact of changing `user_id` in `fact_orders`?", it will:

1. Find lexical occurrences of `fact_orders` and `user_id` — this gives you direct references
2. Maybe surface 1-2 hops via symbol graph if the LSP has SQL support (most don't)
3. Miss everything beyond that — views on views, downstream procs, cross-schema references

The embedding layer won't save you either. "Impact of changing user_id" semantically matches *concepts about user identity*, not the specific SQL files that happen to reference the column three joins deep.

**The failure mode is silent.** Copilot will give you a confident-sounding answer about the files it found, with no signal that it missed 60% of the dependency chain.

---

## How to Think About It from First Principles

The real engineering problem has three layers:

**Layer 1: Graph Construction (the thing Copilot skips)**

Before any retrieval, you need to build an actual SQL dependency graph. This means:

```
For every SQL file:
  Parse → extract:
    - Object defined (CREATE VIEW x, CREATE TABLE y, CREATE PROC z)
    - Objects referenced (FROM clause, JOIN clause, EXEC calls, INSERT INTO)
  
Build directed graph:
  view_A → references → table_B
  proc_C → references → view_A
  etl_D  → references → proc_C
```

Tools like `sqlfluff`, `sqlglot`, or `dbt`'s built-in lineage do this. This is not a retrieval problem — it's a **static analysis problem** that has to happen before retrieval.

**Layer 2: Impact Traversal (the query is a graph walk, not a search)**

Once you have the graph, "impact of changing X" is:

```
Start node: fact_orders.user_id
Traverse: all edges pointing TO this node (reverse dependency)
Expand: recursively to N hops
Result: the full blast radius subgraph
```

This is deterministic and complete. No embedding, no LLM needed for this step. A simple BFS/DFS on the dependency graph gives you the ground truth impact set.

**Layer 3: LLM for Interpretation (where AI actually adds value)**

Now that you have the precise set of affected objects from the graph walk, you feed *those specific files* to the LLM and ask:

- "Given these are all affected, which ones are highest risk?"
- "What would break at runtime vs. just need a column rename?"
- "Are there any implicit assumptions about data type or nullability?"

The LLM earns its place here because it can reason about *semantics* — whether a downstream proc will silently return wrong results vs. hard fail, whether a type change is compatible, etc.

---

## The Right Architecture for This Problem

```
SQL Repo
    ↓
Static Parser (sqlglot / sqlfluff)
    ↓
Dependency Graph (nodes = SQL objects, edges = references)
    ↓
Impact Query: "what does fact_orders.user_id affect?"
    ↓
Graph Traversal → Blast Radius (deterministic, complete)
    ↓
Retrieve full text of affected objects
    ↓
LLM: "Here are the 23 objects in the blast radius. 
       Analyze risk, breaking changes, migration steps."
```

The key insight is that **retrieval is the wrong primitive for this problem**. You don't want "files similar to the changed file" — you want "files causally downstream of the changed file." That's a graph problem, not a search problem.

---

## Why This Matters for Critical Business Functions

In a large repo with critical business logic, the failure modes of the naive approach are asymmetric:

- Copilot finding 80% of affected files feels like success
- But the 20% it misses might be the revenue reporting proc or the compliance audit view
- You won't know what's missing because the tool has no way to express its own incompleteness

The engineering answer is to treat the dependency graph as a **first-class artifact** — something you build, version, and query explicitly — rather than something you hope emerges from a fuzzy search. The LLM then operates on a complete, verified input set rather than a sampled one.