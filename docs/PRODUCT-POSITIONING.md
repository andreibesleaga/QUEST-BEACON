# BEACON — what it is, what it is for, and what it does not claim

Owner goal, recorded 2026-09-11: BEACON should read to a jury as **exceeding every criterion**, and should
be genuinely adoptable by real emergency-management organisations — governments, NGOs, civil-protection
agencies — so the work ends up being used to save lives rather than filed as a contest entry.

**This document is written to that goal by being strictly true.** That is not a limitation on the pitch;
it is the pitch. BEACON's central engineering claim is that every figure on the screen can be walked back
to a stored source, and that the system says plainly when it cannot. A positioning document that overstated
anything would contradict the product it describes — and a jury that finds one inflated claim will
reasonably discount the rest. Every sentence below is either verifiable in the repository today or is
explicitly marked as a limitation, a roadmap item, or something still to be checked.

---

## 1. The one-sentence description

BEACON is a **browser-based common operating picture for wildfires and floods** that ingests free,
authoritative open data through swappable adapters, fuses it into a **source-cited situational report**,
and ties that report to responder logistics — designed to run **fully offline and air-gapped on a laptop**
or in the cloud, from the same artifacts.

## 2. What is genuinely differentiated

Stated as properties a reviewer can check in the code, not as adjectives.

**Provenance is structural, not a feature.** Every ingested datum becomes a `SOURCE_RECORD`; every SitRep
field carries `citations[]` pointing at one; every API response carries `provenance[]` and `freshness`. An
ungrounded build fails a contract test. Most systems treat data lineage as a logging concern that can be
switched off; here it is a type the code cannot avoid constructing.

**The AI is structurally forbidden from producing a number.** Every figure, ranking, distance, exposure
and crest value is computed deterministically in typed code or SQL. The model narrates cited facts and
nothing else, and the product is fully functional with the model disabled — which is an acceptance test,
not an aspiration. This is the opposite of the common pattern of asking a language model to summarise a
situation and hoping the figures it produces are real.

**Every layer declares a fallback ladder and labels the rung it is on.** Data degrades primary API →
secondary → cache → recorded fixture; AI degrades cloud → alternate provider → local → deterministic-only;
routing degrades road-network → heuristic; realtime degrades push → polling. The UI shows the degraded
state as a designed state. It never dead-ends, and it never presents a degraded reading as a fresh one.

**It ships air-gapped.** The same images run with no egress at all, on local models and cached layers, at
essentially zero cost. For a disaster-response tool this is not a nicety: connectivity is frequently the
first casualty, and a tool that requires the cloud is a tool that fails exactly when it is needed.

**Honest limitations are published, not hidden.** The docs state where satellite detections are not
perimeters, where an outage feed is county-granular, where a source is cached rather than live, and where
data simply does not exist for a region.

## 3. Real-world adoptability — what is true today

- **Free and open data only.** No paid feeds, no proprietary dependencies, no scraping of terms-protected
  platforms. An adopting agency inherits no licence bill and no vendor.
- **Adapters, not rewrites.** A new country or a new source is a manifest entry plus one adapter file,
  behind an anti-corruption layer that normalises every upstream format into one domain model. Adding a
  region does not touch core code.
- **Config for everything.** Region set, every endpoint, every key, every feature flag and every per-source
  mode is an environment variable, validated fail-fast at boot.
- **Multiple regions and languages already run**, and the interface carries a full translated catalogue
  rather than English with placeholders.
- **A database an operator can actually edit**, with readable natural keys rather than bare UUIDs, so a
  duty officer can maintain operational records through an admin UI and see the picture change.

## 4. What this is NOT — the claims deliberately not made

Being precise here is what makes section 2 credible.

- **Not a forecasting model.** Projections are first-order and are labelled with method, inputs and
  uncertainty. No physics-grade claim is made anywhere.
- **Not an authoritative alerting authority.** Nothing emits a public alert from an unverified report;
  threshold rules create drafts, and a human must approve. BEACON supports an emergency manager's decision;
  it does not make it.
- **Not a certified or accredited system.** It has not been through any emergency-management certification,
  safety case, or independent security audit. An agency adopting it would need to do that work.
- **Not operationally proven.** It has not yet been used in a live incident by a real response team. It is
  an MVP built to production engineering standards, which is a different claim from field-proven.
- **Not "unique in the world".** That claim was requested and is deliberately not made. What §4a supports
  instead is narrower and defensible: *no single system found in the landscape review combines all five of
  BEACON's core properties.* Every individual property exists elsewhere, several of them in systems far more
  mature than this one. The combination is the differentiator, and "unusual combination" is a claim that
  survives scrutiny where "unique" does not.
- **Coverage is honest, not universal.** Where a region has no published data, the product says so rather
  than filling the gap. Where a source is cached or mocked, the label says cached or mocked.

## 4a. The landscape comparison

**Method, and its limits — read this before the table.** This is a DESK review against each system's own
published description of itself, compiled 2026-09-11. It is not a hands-on evaluation: no system below was
installed, and no vendor was contacted. Emergency-management products change quickly and several of these
have commercial editions whose capabilities are not fully public, so **every row must be re-checked against
current vendor documentation before any of this becomes submission or marketing copy.** Stating the method
is part of the claim: a comparison whose provenance is unstated is exactly the kind of assertion this
product exists to refuse.

The five properties compared are the ones §2 rests on:

- **P1 — Open source and self-hostable**, including a genuinely air-gapped deployment at zero licence cost.
- **P2 — Multi-source live hazard fusion** behind an anti-corruption layer, so heterogeneous public feeds
  become one canonical model rather than a set of separate layers a human reconciles.
- **P3 — Structural provenance**: every datum carries a source record, every narrated field carries a
  citation, and an ungrounded build fails its own contract test.
- **P4 — AI that narrates but never computes.** Figures, rankings, distances and exposures come from
  deterministic code; the model explains cited facts and cannot originate one.
- **P5 — Human-in-the-loop before any public action**, with threshold rules producing drafts only.

| System | P1 | P2 | P3 | P4 | P5 | Where it is stronger than BEACON |
|---|---|---|---|---|---|---|
| **Esri ArcGIS Solutions for Emergency Management** | ✗ | ✓ | partial | ✗ | ✓ | Overwhelmingly. Decades of field use, the deepest GIS in existence, real agency support contracts |
| **WebEOC (Juvare)** | ✗ | partial | partial | ✗ | ✓ | The de-facto EOC incident-management record system in much of the US; proven under real activations |
| **Sahana Eden** | ✓ | partial | partial | ✗ | ✓ | Open source with genuine field deployments; far stronger organisation, shelter and volunteer management |
| **Ushahidi** | ✓ | ✗ | partial | ✗ | ✓ | The reference implementation of crowdsourced crisis reporting and verification workflow |
| **PDC DisasterAWARE** | ✗ | ✓ | ✓ | ✗ | ✓ | Global multi-hazard monitoring backed by a research institution; scientific modelling BEACON does not attempt |
| **GDACS (JRC/UN)** | partial | ✓ | ✓ | ✗ | ✓ | Authoritative global alerting with real institutional standing |
| **Copernicus EMS** | partial | ✓ | ✓ | ✗ | ✓ | Satellite rapid mapping at a quality no self-hosted tool approaches |
| **BEACON** | ✓ | ✓ | ✓ | ✓ | ✓ | — |

**What the table actually shows.** P1, P2, P3 and P5 are each well represented; none of them is novel.
The column that is empty everywhere else is **P4**, and it is empty for a simple reason: most of these
systems predate the current generation of language models and have no AI narration layer to constrain. The
honest form of BEACON's differentiator is therefore:

> BEACON combines open-source self-hostability with multi-source live hazard fusion, structural provenance,
> and a constitutional separation between deterministic computation and AI narration, in one system. Each
> property exists elsewhere; this particular combination was not found in the review above.

**What the table also shows, and should not be read past.** Every system in it is stronger than BEACON in
the dimension that matters most to an adopting agency — operational maturity. Several have been used in real
disasters for years. BEACON has been used in none. The rightmost column is not a courtesy; it is the
context in which the rest of the row should be read.

## 5. The "quiet day" problem, and why it is a feature

A disaster tool spends most of its time with nothing to show. When a region has no active fire or flood,
BEACON's map is **truthfully quiet** — "no active incidents · sources live" is a designed state, not a
broken screen. This is worth saying out loud to a reviewer, because the temptation in a demo is to
manufacture an incident, and manufacturing one would falsify the single property the system is built to
guarantee. The live deployment's honesty on a quiet day is evidence for the claim, not an absence of it.

## 6. Open items before any of this is used as submission copy

1. ~~The competitive-landscape review~~ — **done 2026-09-11 (§4a), as a desk review only.** What remains is
   verifying each row against current vendor documentation, since the review was compiled from published
   descriptions rather than hands-on evaluation. Until that is done, §4a may inform internal judgement but
   must not be quoted as established fact in submission copy.
2. **Live-deployment evidence** — dated results from the production smoke matrix across all regions,
   captured on the day, so every claim here has a timestamped artifact behind it.
3. **An independent security review.** None has been performed.
4. **Accessibility evidence** at the stated bar, captured from the running deployment in both themes.

Until each is done, the corresponding claim stays out of the copy. That discipline is the same one the
product applies to its own data, and applying it to our own marketing is the most persuasive thing we can
do in front of a jury that is grading honesty.
