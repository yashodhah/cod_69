
## What Oracle Gives You Out of the Box

Oracle's data dictionary maintains a live dependency graph automatically:

```sql
-- Direct dependencies on any object
SELECT name, type, referenced_name, referenced_type
FROM dba_dependencies
WHERE referenced_name = 'FACT_ORDERS'

-- Or the classic recursive CTE for full blast radius
SELECT level, name, type, referenced_name
FROM dba_dependencies
START WITH referenced_name = 'FACT_ORDERS'
         AND referenced_owner = 'YOUR_SCHEMA'
CONNECT BY PRIOR name = referenced_name
        AND PRIOR owner = referenced_owner
```

You also have `all_dependencies`, `user_dependencies`, and for column-level granularity in newer versions, `dba_col_usage$` and `v$sql_plan` can tell you which columns are actually being accessed at runtime.

So the graph construction problem — which was the hard part in the generic SQL case — is **already solved by the database itself**.

---

## How This Reshapes the AI Engineering Problem

The bottleneck shifts entirely. You're no longer asking "how do I build a dependency graph" — that's a free query. The real problems become:

**Problem 1: The metadata tells you WHAT depends on what, not WHY or HOW**

`dba_dependencies` tells you `PROC_BILLING_CALC` depends on `FACT_ORDERS`. It doesn't tell you:
- Whether it reads `user_id` specifically or just happens to join on another column
- Whether the dependency is in a hot path or a legacy proc nobody calls
- Whether it's a hard failure or a silent wrong-result dependency

**Problem 2: Oracle tracks object-level dependencies, not column-level**

This is the critical gap. If you're changing `fact_orders.user_id`, Oracle knows every view and proc that touches `fact_orders` — but it can't natively tell you which of those actually reference `user_id` specifically vs. using `SELECT *` vs. joining on a different column entirely.

For column-level impact you'd need to combine:

```sql
-- Get all dependent objects from Oracle metadata
SELECT name, type FROM dba_dependencies 
WHERE referenced_name = 'FACT_ORDERS'

-- Then for each dependent object, pull its source
SELECT text FROM dba_source 
WHERE name = :object_name
ORDER BY line
```

And now parse that source text looking for `user_id` references — which brings you back to the text analysis problem, but on a much smaller, already-filtered set.

**Problem 3: Runtime vs. compile-time dependencies**

Oracle's dependency graph is static — it reflects what the optimizer *parsed*, not what actually executes. Dynamic SQL breaks this completely:

```sql
-- Oracle has NO idea what this depends on
EXECUTE IMMEDIATE 'SELECT * FROM ' || v_table_name || ' WHERE user_id = :id';
```

Large Oracle repos in enterprises tend to have a lot of this — dynamic SQL built from parameters, table names constructed at runtime, REF CURSORs passed around. These are invisible to `dba_dependencies`.

---

## The Revised Architecture for Oracle

Given all this, the right pipeline looks like:

```
Oracle Metadata (dba_dependencies)
    ↓
Blast radius: all objects touching FACT_ORDERS
[This is free, complete, and authoritative for static dependencies]
    ↓
dba_source: pull source text for all ~N affected objects
    ↓
Column-level filter: 
  grep/parse for 'user_id' references in those N files
  [Trivial trigram search on a small, pre-filtered set]
    ↓
Dynamic SQL detector:
  Flag any objects using EXECUTE IMMEDIATE, DBMS_SQL — 
  these are blind spots requiring manual review
    ↓
LLM Input: 
  "Here are 12 objects confirmed to reference user_id.
   Here are 4 objects with dynamic SQL that may also be affected.
   Analyze: breaking changes, risk ranking, migration approach."
```

---

## Where Copilot / LLMs Actually Add Value in This Stack

Given Oracle handles the structural layer, the LLM's job becomes much more focused and honest:

**High value tasks:**
- Reading a stored proc's source and explaining *how* it uses `user_id` — is it a join key, a filter, a return value?
- Identifying whether a type change (say, `NUMBER` → `VARCHAR2`) would cause implicit conversion issues downstream
- Ranking the 20 affected objects by business criticality based on naming and logic
- Drafting the migration script given the full blast radius

**Low value / don't bother:**
- Asking Copilot to discover the dependency graph — Oracle already did it better
- Trusting Copilot's retrieval to find all affected objects — it will miss things `dba_dependencies` wouldn't

---

## The Practical Workflow This Suggests

Rather than opening VSCode and asking Copilot, the engineering-sound approach is:

1. **Query Oracle first** — get the authoritative dependency list, takes 30 seconds
2. **Export affected source** via `dba_source` — you now have a precise, complete input set
3. **Feed that into an LLM** (Copilot, Claude, doesn't matter) with the full context explicitly in the prompt — not relying on retrieval at all
4. **Flag dynamic SQL objects separately** for manual human review

The key shift in thinking is: **Oracle's metadata is a better retrieval system for structural dependencies than any embedding or symbol index an LLM tool can build**. Use it as your retrieval layer, and let the LLM operate purely on the reasoning and interpretation layer where it's actually strong.