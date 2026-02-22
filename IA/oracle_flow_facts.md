---

## Where Direct Oracle Metadata Actually Fails

**1. The semantic gap in naming**

Oracle tracks `PROC_X` depends on `TABLE_Y`. It has zero understanding that:

```sql
-- These three procs all implement "calculate customer lifetime value"
-- but are named completely differently across teams/years
PROC_CLV_CALC        -- written by team A in 2019
GET_CUST_VALUE       -- written by team B in 2021  
GENERATE_LTV_REPORT  -- written by team C in 2023
```

If you're trying to understand the *business impact* of a change — not just the object dependency graph — you need to know these are functionally related. `dba_dependencies` will never tell you that. An embedding index over proc source text might surface that these three live in the same semantic neighborhood.

**2. Comments and documentation are invisible to the dependency graph**

Large Oracle repos often have business logic *documented in comments* that describes intent, not just structure:

```sql
-- This proc is called nightly by the IFRS9 compliance job
-- Any changes here must be reviewed by Finance Risk team
CREATE OR REPLACE PROCEDURE CALC_PROVISION_RATE AS
```

`dba_dependencies` ignores this entirely. Retrieval over source text would surface it. When doing impact analysis, knowing *who owns* and *what compliance process governs* an object is often as important as knowing the structural dependency.

**3. Dead code and stale dependencies**

Oracle's dependency graph is optimistic — it records everything that was ever compiled and linked. It doesn't know:

- That `PROC_LEGACY_MIGRATION` has not been called since 2018
- That a view is technically dependent but only used in a deprecated reporting path
- That an object is in a `INVALID` state and already broken

```sql
SELECT status FROM dba_objects WHERE object_name = 'PROC_X'
-- Returns INVALID -- object is already broken, 
-- flagging it as blast radius is noise
```

A retrieval system trained on git history or execution logs would weight recently-touched, frequently-executed objects higher. Pure metadata treats a proc called daily and a proc called never identically.

**4. Synonyms and database links break the graph**

```sql
-- Oracle sees this as depending on LOCAL_ALIAS, not REMOTE_TABLE
SELECT * FROM LOCAL_ALIAS@DBLINK_PROD
```

Cross-database dependencies via DB links, synonyms pointing to remote objects, materialized views refreshed from external sources — `dba_dependencies` either misrepresents these or loses them entirely. The actual impact of a change might be in a completely different Oracle instance that metadata can't see.

**5. The implicit contract problem**

Structural dependency is not the same as behavioral dependency. Consider:

```sql
-- VIEW_A is structurally dependent on FACT_ORDERS
-- But its WHERE clause assumes user_id is never NULL
CREATE VIEW VIEW_A AS
SELECT * FROM FACT_ORDERS WHERE user_id IS NOT NULL

-- DOWNSTREAM_PROC reads VIEW_A
-- It was written assuming every row has a user_id
-- It has no structural dependency on FACT_ORDERS at all
```

If you change `user_id` to be nullable, `DOWNSTREAM_PROC` breaks — but `dba_dependencies` won't put it in your blast radius because it depends on `VIEW_A`, not on the specific column constraint of `FACT_ORDERS`. The structural graph is correct but insufficient.

This is arguably where retrieval over source text genuinely wins — embedding similarity might surface `DOWNSTREAM_PROC` because its source text is semantically dense with `user_id` assumptions, even though the metadata graph doesn't connect it.

---

## The Honest Summary

| Failure Mode | Metadata Blind? | Retrieval Helps? |
|---|---|---|
| Object-level structural deps | No — metadata is complete | Retrieval adds nothing |
| Column-level specificity | Partially | Text search wins |
| Semantic/functional grouping | Yes | Embeddings help |
| Dead code / stale deps | Yes | Git history helps more |
| Cross-DB / synonym deps | Yes | Retrieval also blind |
| Implicit behavioral contracts | Yes | Embeddings may help |
| Comment-embedded business context | Yes | Retrieval wins clearly |

So the accurate framing is: **metadata gives you a complete structural graph but an incomplete semantic and behavioral picture**. Retrieval fills the gaps metadata structurally cannot — but it fills them fuzzily, with recall rather than precision.

The real engineering answer is that neither alone is sufficient for a high-stakes change in a critical Oracle system. You use metadata for the authoritative structural layer, and retrieval specifically to hunt for the classes of gaps metadata is known to miss.