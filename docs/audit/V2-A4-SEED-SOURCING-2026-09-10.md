# V2 · WS-A · A4·3 — Shelter & resource seed sourcing (evidence pack)

> **Status:** RESEARCH ONLY — nothing implemented. This document is the evidence base for
> `docs/features/V2-LIVE-OPS-COMMAND-PLAN.md` §2·A4 item 3 ("extend `config/shelters.json` + region
> seeds with **real published shelter/asset lists** … resources seeded per region as
> ILLUSTRATIVE-labelled rows").
> **Author:** researcher WP, 2026-09-10. **Retrieval date for every URL below: 2026-09-10.**
> **Binding rules applied:** `.claude/CLAUDE.md` §"Source policy" / §"Honest limitations" /
> §"Responsible data"; `docs/RESPONSIBLE_DATA.md` rules 4, 6, 9, 11; Constitution Art. XI/XVI.
>
> **Nothing in this document is a shelter that does not exist, and no capacity or occupancy figure
> appears here that its cited source did not publish.** Where a region has no publishable list, this
> document says so and proposes a labelled fallback rather than filling the table.

---

## §0 — Verification method and what "verified" means here

Every URL cited below was fetched from this machine on 2026-09-10 and its content inspected. Three
outcomes are recorded, and they are not interchangeable:

| Mark | Meaning |
|---|---|
| **VERIFIED ✅** | URL returned 200 and the content contains the claimed fields/rows; sample rows were extracted and are reproduced verbatim below. |
| **VERIFIED-NEGATIVE ⛔** | URL resolved but does **not** contain a usable list, or the licence forbids reuse. Recorded because an admitted gap beats a hopeful citation. |
| **UNREACHABLE ⚠️** | The host refused this environment (403/TLS). No claim is made about the content. |

Sources that failed verification are listed in §1.6 so no later agent re-walks the same dead ends.

### 0.1 Coordinate provenance is a first-class field

For every row below the lat/lon carries its own provenance, because "the source published this point"
and "we geocoded the address" are different epistemic claims:

- **`src=publisher`** — the authoritative publisher printed the coordinate pair. (us-ca, ro, es)
- **`src=geocode:osm`** — we resolved a *published site name + published address* through
  Nominatim (OSM, ODbL). The **name and address** are the agency's; the **point** is OSM's.
- **`src=geocode:wikidata`** — resolved through Wikidata (CC0).

A `geocode:*` row must never be presented as "the agency published this location".

---

## §1 — Part 1 · Shelters (REAL and CITED)

### 1.0 Summary table — how much real data exists per region

| Region | Tier-1 published list? | Machine-readable? | Capacity published? | Verdict |
|---|---|---|---|---|
| **us-ca** | **YES** — FEMA ESF#6 Shelter System (federal) | **YES** — live ArcGIS REST | **YES** (`evacuation_capacity`, `post_impact_capacity`) | **SOURCED**, high confidence |
| **ro** | **YES** — IGSU national civil-protection shelter register | Semi (137-page PDF, tabular, parses cleanly) | **YES** (`Capacitatea … Număr Persoane`) | **SOURCED**, high confidence, with a hazard-type caveat |
| **es** | **NO** national/wildfire list | Partial — one **municipal** open dataset (Barcelona) | **NO** | **FALLBACK** — designated-site reference |
| **gr** | **NO** reusable list (national platform has no licence) | **NO** | **NO** | **FALLBACK** — designated-site reference, 2 rows only |
| **ph** | **NO** national list (FOI-gated); **YES** at one LGU | **NO** (HTML table, no coords, no capacity) | **NO** | **FALLBACK** — designated-site reference |

Two of five regions can be seeded with genuinely sourced, capacity-carrying shelters. Three cannot,
and the plan text ("real published shelter/asset lists for us-ca, ro, es, gr, ph") is **not
achievable as written for es/gr/ph** — see PLAN-DELTA-1 in §5.

---

### 1.1 `us-ca` — SOURCED ✅

**Source:** FEMA ESF#6 Shelter System (formerly the FEMA National Shelter System), served live by
FEMA's public ArcGIS instance.

- **Service:** `https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer`
  — **VERIFIED ✅** HTTP 200; `serviceDescription`: *"FEMA ESF#6 Shelter System (Formerly known as the
  FEMA National Shelter System)"*; `copyrightText`: *"FEMA, Mass Care, American Red Cross"*.
- **Layers:** `0 Open Shelters`, `1 Closed Shelters`, `2 Full Shelters`, `3 Alert Shelters`,
  `4 Total Population`.
- **Counts on 2026-09-10:** layer 1 = **71,852** records nationally, **6,888 with `state='CA'`**;
  layer 0 (open) = 12 nationally, **0 in CA**.
- **Fields actually published (relevant subset):** `shelter_id, shelter_name, address_1, city,
  county_parish, state, zip, evacuation_capacity, post_impact_capacity, latitude, longitude,
  org_organization_name, shelter_status_code, facility_type, total_population, ada_compliant,
  wheelchair_accessible, generator_onsite, pet_accommodations_desc`.
- **Licence / terms:** US federal government work; FEMA GIS services are published for public use and
  US Government works are not subject to domestic copyright (17 U.S.C. §105). The `copyrightText`
  field credits *"FEMA, Mass Care, American Red Cross"* — **attribute all three**. This is the same
  data family HIFLD Open published as *National Shelter System Facilities*; the HIFLD Open dataset
  page (`hifld-geoplatform.opendata.arcgis.com/…/national-shelter-system-facilities/about`) is
  **404 as of 2026-09-10** (VERIFIED-NEGATIVE ⛔) and an archive exists at DataLumos
  (`https://portal.datarescueproject.org/datasets/hifld-open-national-shelter-system-facilities/`,
  archived 2025-08-26). **Cite the live FEMA service, not the dead HIFLD page.**
- **Responsible-data note (rule 4 — binding):** this layer also carries `org_poc_name`,
  `org_poc_phone`, `org_poc_after_hours_phone`, `org_poc_email`. **These are named-individual contact
  details and MUST NOT be copied into the seed, the DB, logs, or any export.** Copy only the nine
  fields listed in the proposed rows.

#### Proposed `us-ca` rows (verbatim from the source, 2026-09-10)

All five are `shelter_status_code = CLOSED` because **every one of the 6,888 CA records is CLOSED**
(distinct-value query returned exactly one value: `CLOSED`). That is the truth of the feed today and
the seed must say it. See PLAN-DELTA-3 for what that costs the demo.

| # | `note` (name + address, file-only) | `org` | lat / lon (`src=publisher`) | `capacity` | `occupancy` | `status` | Source ref |
|---|---|---|---|---|---|---|---|
| 1 | Sacramento Convention Center — 1400 J Street, Sacramento, CA 95814 | American Red Cross — Sacramento Sierra | 38.57882217 / −121.48787257 | **9730** | 0 | CLOSED | FEMA NSS layer 1, `shelter_id=173423` |
| 2 | American River College — 4700 College Oak Drive, Sacramento, CA 95841 | American Red Cross — Sacramento Sierra | 38.65039022 / −121.35033026 | **2720** | 0 | CLOSED | `shelter_id=169390` |
| 3 | Forest Ranch Community Center — 15807 Forest Ranch Road, Forest Ranch, Butte County, CA 95942 | American Red Cross — Three Rivers Chapter | 39.88279393 / −121.67295039 | **4999** | 0 | CLOSED | `shelter_id=171019` |
| 4 | Folsom Sports Complex — 66 Clarksville, Folsom, CA 95630 | American Red Cross — Sacramento Sierra | 38.65466678 / −121.12888694 | **2600** | 0 | CLOSED | `shelter_id=170989` |
| 5 | Sacramento City College — 3835 Freeport Blvd, Sacramento, CA 95822 | American Red Cross — Sacramento Sierra | 38.54129346 / −121.49186556 | **2348** | 0 | CLOSED | `shelter_id=173422` |

`capacity` uses the source's **`evacuation_capacity`** (the pre-impact figure). The source also
publishes `post_impact_capacity` (roughly half); BEACON's schema has one capacity column, so the
choice must be recorded — see §4.6.

**Row 3 (Forest Ranch, Butte County) is the demo-relevant one**: the CA scenario's resources sit at
`[-121.55, 39.72]` / `[-121.4, 39.75]` (`src/main/feature-seed.ts`), i.e. Butte County wildfire
country. Rows 1–2 replace the two hand-made rows currently in `config/shelters.json`
(`…0b01` "Sacramento" and `…0b02` "Fresno"). Row 1 sits ~250 m from the existing hand-made
`…0b01` point (−121.49 / 38.58), so it is a like-for-like upgrade to a cited row.

**Honest gap:** the "Fresno" replacement was not found. The query
`county_parish IN ('SACRAMENTO','FRESNO','BUTTE') AND evacuation_capacity>300` returned no FRESNO rows
in the top 15 by capacity. Fresno shelters may exist below that threshold. **The implementer must
re-query before retiring `…0b02`, and must not invent a Fresno row.**

---

### 1.2 `ro` — SOURCED ✅

**Source:** Inspectoratul General pentru Situații de Urgență (IGSU), *"Situația adăposturilor de
protecție civilă"* — the national register of civil-protection shelters.

- **Landing page:** `https://igsu.ro/adaposturi-de-protectie-civila` — **VERIFIED ✅**; page text reads
  *"Situația adăposturilor de protecție civilă · 10 iulie 2026 · Documente · Situația adăposturilor de
  protecție civilă iunie 2026"*.
- **Document:** `https://igsu.ro/resources/cb307076-fbd5-4c1d-a24b-1331e601af47.pdf` — **VERIFIED ✅**,
  `application/pdf`, 5,423,206 bytes, **137 pages**. Downloaded and text-extracted on 2026-09-10.
- **Publication date:** 10 July 2026, for **June 2026** data.
- ⚠️ **The URL commonly cited in the press**
  (`igsu.ro/Resources/Documente_Generale/Situatia_adaposturilor_de_protectie_civila.pdf`) **is dead** —
  it returns the IGSU error page *"Cererea nu a putut fi procesată!"* (VERIFIED-NEGATIVE ⛔). Use the
  resource GUID URL above, and re-derive it from the landing page if it rotates.
- **Columns published (verbatim header):** `Nr. Crt. | Județ | Localitate | Adresa adăpostului |
  Tipul adăpostului (privat/public) | Coordonate GPS: Latitudine, Logitudine | Capacitatea adăpostului
  (Număr Persoane) | Starea de funcționalitate`.
- **Extraction result:** 5,500 rows parsed cleanly across 42 counties (decimal comma → point).
  Distribution: `Privat` 3,257 / `Public` 2,243; `Parțial-funcțional` 2,724 / `Nefuncțional` 1,899 /
  `Funcțional` 877.
- **Licence / terms:** Romanian public-authority document published for public information under
  Law 544/2001 (liberal access to public-interest information). **No explicit open licence is
  attached.** Treat as *public-sector information, attribution required, no licence declared* — cite
  IGSU by name, link the source, and state the extraction date. This is weaker than CC-BY; record it
  as such rather than claiming an open licence the publisher did not grant.

#### Two caveats that MUST reach the operator

1. **Hazard-type mismatch.** These are *civil-protection shelters* (protected/hardened spaces for
   armed-conflict and CBRN sheltering, administered by local councils or by private owners). They are
   **not flood evacuation centres**, and Romania's demo scenario is a Danube/Siret flood
   (Copernicus EMSR758, Galați/Vaslui). Presenting them as flood shelters would be exactly the
   fabricated-context failure this WP exists to prevent.
2. **Bucharest has zero public shelters in the register.** All **1,539** București (`Județ = B`) rows
   are `Privat` — 1,142 `Parțial-funcțional`, 315 `Funcțional`, 82 `Nefuncțional`; **`Public`
   count = 0**. The current seed row `…0b03` ("Bucharest", `org: "IGSU (Romania)"`, capacity 200) is
   therefore **not supported by the national register as a public shelter** and should be retired,
   not re-cited.

#### Proposed `ro` rows (verbatim from the register)

Only `Public` + a definite functionality state are proposed — private premises are not
population-accessible and `Parțial-funcțional` has no honest home in BEACON's status enum (§4.4).

| # | `note` (address + locality, file-only) | `org` | lat / lon (`src=publisher`) | `capacity` | `occupancy` | `status` | Register row |
|---|---|---|---|---|---|---|---|
| 1 | PRIMĂRIA MUNICIPIULUI GALAŢI, Str. Domnească nr. 54, Galați (Public, Funcțional) | IGSU — ISU Galați | 45.440264 / 28.056828 | **195** | 0 | OPEN | Nr. crt. 2403 |
| 2 | PRIMĂRIA NICOREȘTI, Str. Anton Cincu nr. 97, Nicorești, jud. Galați (Public, Funcțional) | IGSU — ISU Galați | 45.932785 / 27.305042 | **70** | 0 | OPEN | Nr. crt. 2449 |
| 3 | Sediu Primărie, sat Hoceni, jud. Vaslui (Public, Funcțional) | IGSU — ISU Vaslui | 46.53953 / 28.00656 | **50** | 0 | OPEN | Nr. crt. 4171 |
| 4 | UNIVERSITATEA DUNĂREA DE JOS, Str. Gării nr. 61-63, Campus Gară, Galați (Public, Nefuncțional) | IGSU — ISU Galați | 45.443361 / 28.051164 | **430** | 0 | CLOSED | Nr. crt. 2413 |

Rows 1–3 land squarely in the EMSR758 demo geography (Galați / Vaslui). Row 4 is included
deliberately: it is a **large but non-functional** shelter, and seeding it as `CLOSED` proves the
status enum is carrying a published fact rather than decoration.

`org` is set to the county inspectorate (`ISU Galați` / `ISU Vaslui`) because the register attributes
administration to local councils under IGSU oversight; it does **not** claim IGSU staffs the site.

---

### 1.3 `es` — NO PUBLISHED WILDFIRE SHELTER LIST; FALLBACK PROPOSED ⛔→

**What was looked for and not found:**

- No national Spanish shelter/evacuation-centre register. `datos.gob.es` civil-protection holdings are
  fragmentary and municipality-scoped (e.g. a Badajoz-province civil-protection centres set); nothing
  resembling a national evacuation-centre roster with coordinates and capacity.
  (`https://datos.gob.es/en/sectors/security` — VERIFIED ✅ as a portal, VERIFIED-NEGATIVE ⛔ for the
  dataset we need.)
- **UME does not operate shelters.** UME is an intervention force; sheltering is the responsibility of
  the autonomous communities and municipalities. Seeding a "UME shelter" would be a category error.
- No Castilla y León / Zamora wildfire assembly-point dataset was found — Zamora is the ES demo
  geography (`src/main/scenario-inputs.ts`: *"Sierra de la Culebra, Zamora: real fire country,
  illustrative event"*).

**Honest fallback — designated-site reference (municipal, open-licensed):**

**Source:** *Xarxa de refugis climàtics a la ciutat de Barcelona* (Climate shelters network in the
city of Barcelona), Ajuntament de Barcelona.

- **Dataset:** `https://opendata-ajuntament.barcelona.cat/data/en/dataset/xarxa-refugis-climatics`
  — **VERIFIED ✅** via the portal's CKAN API (`package_search?q=refugis+climatics`).
- **Licence: Creative Commons Attribution 4.0 (`CC-BY-4.0`, https://creativecommons.org/licenses/by/4.0/)**
  — declared in the CKAN metadata. This is the cleanest licence of any source in this document.
- **Last modified:** 2025-09-23. **Resources:** CSV + JSON.
- **CSV downloaded and parsed:** 536 distinct refuges, **all 536 carry `geo_epgs_4326_lat` /
  `geo_epgs_4326_lon`**.
- **Capacity: NOT PUBLISHED.** The dataset's `values_attribute_name` column contains only
  `E-mail` (326), `Web` (134), a web blurb (30), `Tel.` (25), `Instagram` (4), `Informació` (2),
  `Any inauguració` (1) and a few one-offs. **There is no aforament / capacity attribute.**
- **Responsible-data note (rule 4):** the `E-mail` / `Tel.` attributes are institutional contact
  details, not personal, but they are not needed by the shelter schema — **do not copy them.**

**Two caveats that MUST reach the operator:**

1. **Wrong hazard.** This is a **heat-refuge** network (air-conditioned public buildings open during
   heatwaves), designated by the city for climate adaptation. It is **not** a wildfire evacuation
   roster, and it is not activated by a fire.
2. **Wrong place for the demo.** Barcelona (41.4 N, 2.2 E) is ~600 km from the ES scenario in Zamora.
   It is inside the `es` bbox (`[-9.31, 35.99, 4.33, 43.8]`), so it is legitimate for the region, but
   it will not appear near the demo incident.

#### Proposed `es` rows (name + address + coordinates all from the publisher)

| # | `note` (file-only) | `org` | lat / lon (`src=publisher`) | `capacity` | `occupancy` | `status` |
|---|---|---|---|---|---|---|
| 1 | Parc de la Ciutadella — Passeig de Picasso 21, Ciutat Vella (designated climate refuge) | Ajuntament de Barcelona | 41.38633657544665 / 2.185381778970792 | **not published** | 0 | OPEN |
| 2 | Biblioteca Jaume Fuster — Plaça de Lesseps 20, Gràcia (designated climate refuge) | Ajuntament de Barcelona | 41.407490969397124 / 2.149775202551298 | **not published** | 0 | OPEN |
| 3 | Centre Cívic Casa Golferichs — Gran Via de les Corts Catalanes 491, Eixample (designated climate refuge) | Ajuntament de Barcelona | 41.3808491471351 / 2.1564074948215346 | **not published** | 0 | OPEN |
| 4 | Biblioteca Francesca Bonnemaison — C/ de Sant Pere Més Baix 7, Ciutat Vella (designated climate refuge) | Ajuntament de Barcelona | 41.38696803670603 / 2.17580760715867 | **not published** | 0 | OPEN |
| 5 | Centre Esportiu Municipal Parc de la Ciutadella — Pg. de Circumval·lació 1, Ciutat Vella (designated climate refuge) | Ajuntament de Barcelona | 41.38552732576981 / 2.1864100992429276 | **not published** | 0 | OPEN |

**"not published" is not expressible in the current config schema.** See §4.2 — this is the single
most consequential fit finding in this document.

---

### 1.4 `gr` — NO REUSABLE LIST; FALLBACK PROPOSED (2 rows only) ⛔→

**What was looked for and not found:**

- **`mysafetyplan.gov.gr`** (Ministry of Digital Governance + National Observatory of Athens) is the
  official national map of approved temporary citizen-accommodation sites — reportedly **2,892
  assembly points**. It is **unusable for this seed** and that is a licence finding, not a technical
  one: the OSM community thread
  `https://community.openstreetmap.org/t/x-mysafetyplan/131425` — **VERIFIED ✅** — records that the
  licence is *"Δεν δηλώνεται πουθενά ξεκάθαρα"* ("not clearly declared anywhere"), that an OSM import
  was **refused** on exactly that basis (*"We cannot import mySafetyPlan data without a compatible
  ODbL licence or written permission from the central government"*), and that participants doubted
  whether the points are true assembly points or approximate proposed sites.
  **`.claude/CLAUDE.md` §Source policy ("free/open data with compatible terms") forbids using it.**
- `geodata.gov.gr` — **UNREACHABLE ⚠️** from this environment (TLS handshake failure). Not assessed.
- `data.gov.gr` API — 404 on the probed path. Not assessed further.
- OSM Overpass for `emergency=assembly_point` in the GR bbox — **UNREACHABLE ⚠️**: the primary
  endpoint failed TLS and the `kumi` mirror returned empty replies for GR and PH (it did answer for
  ES: **625** assembly points in the ES bbox, if an ODbL route is ever wanted).
- No published assembly-point list was found for **North Evia**, which is the GR demo geography
  (`src/main/scenario-inputs.ts`: *"Northern Evia (Euboea): real fire country, illustrative event"*).

**Honest fallback — designated-site reference from an official municipal wildfire plan:**

**Source:** Δήμος Βόλου (Municipality of Volos), Γραφείο Πολιτικής Προστασίας —
*"ΜΝΗΜΟΝΙΟ ΕΝΕΡΓΕΙΩΝ ΓΙΑ ΤΗΝ ΑΝΤΙΜΕΤΩΠΙΣΗ ΚΙΝΔΥΝΩΝ ΛΟΓΩ ΔΑΣΙΚΩΝ ΠΥΡΚΑΓΙΩΝ 2020"*
(Memorandum of actions for wildfire risk), **Παράρτημα Α — Οργανωμένη Απομάκρυνση Πολιτών ·
Χώροι Συγκέντρωσης Πολιτών**.

- **URL:** `https://www.dimosvolos.gr/sites/default/files/ΜΝΗΜΟΝΙΟ ΕΝΕΡΓΕΙΩΝ ΓΙΑ ΤΗΝ ΑΝΤΙΜΕΤΩΠΙΣΗ ΚΙΝΔΥΝΩΝ ΛΟΓΩ ΔΑΣΙΚΩΝ ΠΥΡΚΑΓΙΩΝ 2020_1.pdf`
  (URL-encoded in the original) — **VERIFIED ✅**, PDF retrieved and text-extracted; Annex A found and
  read in full.
- **What it publishes:** a per-municipal-unit list of named wildfire assembly points. Verbatim policy
  line: *"Ως χώροι συγκέντρωσης του πληθυσμού, σε περίπτωση πυρκαγιάς, θα είναι προαύλια σχολείων,
  προαύλια ιερών ναών, πλατείες και πάρκα των Δ.Ε., γήπεδα ποδοσφαίρου … τουλάχιστον 500 μέτρα [από
  το μέτωπο]"*. Named sites include **Πανθεσσαλικό Στάδιο**, **Διαδημοτικό Αθλητικό Κέντρο
  Πορταριάς–Μακρυνίτσας (ΔΑΚ)**, **Δημαρχείο Αγριάς**, **2ο Δημοτικό Σχολείο Αγριάς
  «Γεωργιάδειο»**, **Κεντρική Πλατεία Μακρυνίτσας**, **Πλατεία Διμηνίου**, and others.
- **No coordinates. No capacities.** The document names sites; it does not locate or size them.
- **Licence:** Greek municipal public document, published on the municipality's own site. No open
  licence declared — same treatment as the IGSU register: attribution + link + date, no open-licence
  claim.
- **Geography:** Volos (39.4 N, 22.9 E) is inside the `gr` bbox `[19.36, 34.79, 29.65, 41.76]`, but it
  is **not** North Evia. Like Barcelona for ES, it is region-valid and demo-distant.

#### Proposed `gr` rows — only what could actually be located

| # | `note` (file-only) | `org` | lat / lon | coordinate provenance | `capacity` | `status` |
|---|---|---|---|---|---|---|
| 1 | Πανθεσσαλικό Στάδιο (Panthessaliko Stadium), Νέα Ιωνία, Βόλος — designated wildfire assembly point, Δ.Ε. Βόλου & Δ.Ε. Νέας Ιωνίας | Δήμος Βόλου — Πολιτική Προστασία | 39.387511 / 22.931067 | **`src=geocode:wikidata`** (Q930369, CC0) | **not published** | OPEN |
| 2 | Κεντρική Πλατεία Μακρυνίτσας (Makrinitsa central square) — designated wildfire assembly point, Δ.Ε. Πορταριάς–Ιωλκού–Μακρινίτσας, item 15 | Δήμος Βόλου — Πολιτική Προστασία | 39.4018624 / 22.9862653 | **`src=geocode:osm`** (Nominatim, way 586470654, ODbL) | **not published** | OPEN |

**Only two rows, and this is deliberate.** Geocoding was attempted for *Δημαρχείο Αγριάς*,
*Αθλητικό Κέντρο Πορταριάς Μακρινίτσας*, *Δημοτικό Στάδιο Αγριάς* and *Γυμνάσιο Κάτω Λεχωνίων* —
**all returned NO RESULT** from Nominatim. Rather than place those named sites at guessed points, they
are **excluded**. A later agent with a better geocoder (or a Greek cadastral source) can add them;
inventing their coordinates now would violate exactly the rule this WP is enforcing.

**Greece is the weakest region in this pack, and the seed should say so out loud.**

---

### 1.5 `ph` — NO NATIONAL LIST; ONE LGU DIRECTORY; FALLBACK PROPOSED ⛔→

**What was looked for and not found:**

- **The national master list is not public.** The DSWD FOI response record
  *"Master List of Evacuation Centers in the Philippines as of 2024"*
  (`https://www.foi.gov.ph/agencies/dswd/master-list-of-evacuation-centers-in-the-philippines-as-of-2024/`)
  is **UNREACHABLE ⚠️ from this environment (Cloudflare 403)**, so its text is **not** quoted here.
  Search-result summaries indicate DSWD treats the list as internal and refers requesters to DILG, and
  a parallel DILG FOI record exists
  (`https://www.foi.gov.ph/agencies/dilg/updated-master-list-of-evacuation-center-in-the-philippines-dilg-902947380736/`).
  **Recorded as an unverified lead, not as a citable fact.** What *is* verified is the absence: no
  downloadable national evacuation-centre dataset with coordinates or capacity was located.
- **HDX is a dead end.** *"Philippines - Existing Evacuation Centers and Relocation sites (TS Washi
  Emergency)"* (`https://data.humdata.org/dataset/philippines-other-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0-0`)
  — **VERIFIED-NEGATIVE ⛔** via the HDX CKAN API: `"archived": true`, `"isopen": false`,
  `"license_id": "hdx-other"` (legacy HRinfo terms), `"has_geodata": false`,
  `"dataset_date": "2012-03-26"`. Archived, non-open, 14 years stale, no geodata. **Do not use.**
- `https://dreamb.dswd.gov.ph/complete-permanent-evacuation-center/` — **VERIFIED-NEGATIVE ⛔**,
  HTTP 500 (*"There has been a critical error on this website"*).
- OSM Overpass for the PH bbox — **UNREACHABLE ⚠️** (mirror returned empty replies).

**Honest fallback — an official LGU directory:**

**Source:** Quezon City Government / QCDRRMO — *"QC Evacuation Centers for Flood and Fire"*.

- **URL:** `https://quezoncity.gov.ph/qcitizen-guides/quezon-city-evacuation-centers/` —
  **VERIFIED ✅** HTTP 200; HTML table parsed: **503 rows** (1 header + 502 entries).
- **Page last updated:** 2026-09-10 (today) — the freshest source in this pack.
- **Columns published (verbatim header):** `BARANGAY | LOCATION NAME | ADDRESS | EVACUATION CENTER TYPE`.
- **`EVACUATION CENTER TYPE`** takes `Temporary` / `Semi-permanent` / `Permanent`. Only **2** of 502
  entries are `Permanent`.
- **No coordinates. No capacity.** Neither is published.
- **Licence:** Philippine LGU public information page; no open licence declared. Attribution + link +
  retrieval date.
- **Responsible-data note:** the page also publishes a QCDRRMO helpline, an office e-mail and office
  phone numbers. These are institutional, but they are not shelter-schema fields — **do not copy.**
- **Geography:** Quezon City (14.65 N, 121.05 E) is inside the `ph` bbox
  `[116.87, 4.4, 126.62, 21.14]`, but the PH scenario is a **Maguindanao / Mindanao** river flood
  (`src/main/seed.ts`). Region-valid, demo-distant — the same caveat as ES and GR.

#### Proposed `ph` rows

| # | `note` (file-only) | `org` | lat / lon | coordinate provenance | `capacity` | `status` | Directory entry (verbatim) |
|---|---|---|---|---|---|---|---|
| 1 | Bagong Silangan Evacuation Center — Gen. Geronimo St, Brgy. Bagong Silangan, Quezon City (type: Permanent) | Quezon City DRRMO | 14.6974783 / 121.1103232 | **`src=geocode:osm`** (Nominatim, way 279718237, ODbL) | **not published** | OPEN | `Bagong Silangan \| Bagong Silangan Evacuation Center \| Gen. Geronimo \| Permanent` |
| 2 | Alicia Barangay Hall — #02 Batangas Street, Brgy. Alicia, Quezon City (type: Temporary) | Quezon City DRRMO | 14.6601167 / 121.0257820 | **`src=geocode:osm`** (Nominatim, way 1303235492, ODbL) | **not published** | OPEN | `Alicia \| Alicia Barangay Hall \| # 02 Batangas Street \| Temporary` |

**Row 1 is independently cross-confirmed:** OSM carries the same facility tagged `amenity=shelter` at
that point, so the agency's *name* and OSM's *point* agree on the same object. Row 2's OSM match
("Bahay Pamahalaan ng Barangay Alicia, **Batangas Street**, Alicia") matches the directory's published
street exactly.

**Rejected:** *Sta. Lucia Multipurpose Hall* (the other `Permanent` entry) — Nominatim returned
**0 results**; not proposed. *Bahay Toro Basketball Court* — the nearest OSM match was the **Barangay
Hall on Road 12**, while the directory lists the **Basketball Court on Road 11 Street**. Different
object; **not proposed**. Both exclusions are deliberate: a wrong point is worse than a missing row.

---

### 1.6 Sources checked and rejected (so nobody re-walks them)

| Source | URL | Outcome |
|---|---|---|
| HIFLD Open — National Shelter System Facilities | `hifld-geoplatform.opendata.arcgis.com/datasets/geoplatform::national-shelter-system-facilities/about` | ⛔ **404** — portal page gone; superseded by the live FEMA service |
| IGSU shelter PDF (press-cited path) | `igsu.ro/Resources/Documente_Generale/Situatia_adaposturilor_de_protectie_civila.pdf` | ⛔ IGSU error page — use the GUID URL in §1.2 |
| ISU București-Ilfov shelter list | `isubif.ro/local/lista-adaposturi/` | ⚠️ DNS timeout (`ETIMEOUT`); the `isubif.igsu.ro` path resolved but the national register in §1.2 supersedes it |
| Greece — mysafetyplan.gov.gr | `mysafetyplan.gov.gr` | ⛔ **licence not declared**; OSM import refused; forbidden by §Source policy |
| Greece — geodata.gov.gr | `geodata.gov.gr/api/3/action/package_search` | ⚠️ TLS failure from this environment |
| PH — HDX TS Washi evacuation centres | `data.humdata.org/dataset/philippines-other-0-0-…` | ⛔ archived, `isopen:false`, 2012, no geodata |
| PH — DSWD permanent evacuation centres | `dreamb.dswd.gov.ph/complete-permanent-evacuation-center/` | ⛔ HTTP 500 |
| PH — DSWD/DILG FOI master list | `foi.gov.ph/agencies/dswd/…` · `foi.gov.ph/agencies/dilg/…` | ⚠️ Cloudflare 403 — lead only, not cited as fact |
| CAL FIRE fleet/organisation figures | `fire.ca.gov/about-us`, `/about-us/organization`, `osfm.fire.ca.gov` | ⚠️ **403 (Akamai edge)** from this environment — see §2.2 |
| OSM Overpass (GR, PH) | `overpass-api.de`, `overpass.kumi.systems`, `lz4.overpass-api.de` | ⚠️ TLS failure / empty replies / 406. ES answered: 625 `emergency=assembly_point` in bbox |

---

## §2 — Part 2 · Resources (ILLUSTRATIVE, and labelled as such)

> **The governing statement, which must appear in the seed and reach the operator:**
> **These rows do NOT assert that the named organisation has committed that asset.** They are a
> plausible capability mix, placed so the logistics, tasking and pre-positioning features have
> something realistic to reason over. They are named after real organisations because a demo that
> tasks "Agency A, Engine 1" teaches a judge nothing about interoperability — **not** because those
> organisations have supplied, endorsed, or committed anything to BEACON.

The two categories below are kept **visibly separate** and must stay separate in the seed.

### 2.1 SOURCED — a published organisational fact backs the row

Exactly **one** organisation's structure was verified from its own primary source within this WP.

| Region | `org` | `kind` | Published fact backing it | Source (VERIFIED ✅) |
|---|---|---|---|---|
| `es` | **UME — BIEM V** (Quinto Batallón de Intervención en Emergencias) | `CREW` ×2, `ENGINE` ×1 | UME's own organisation page states BIEM V is based at **San Andrés de Rabanedo (León)** — the battalion whose area covers Castilla y León, i.e. the Zamora demo geography — and that **each BIEM comprises** *"Mando y Plana Mayor, Compañía de Plana Mayor y Servicios, **dos Compañías de Intervención en Emergencias Naturales (CIEN)** y **una Compañía de Ingenieros (CING)**"*. The ×2 `CREW` / ×1 `ENGINE` mix mirrors that published 2-CIEN + 1-CING structure. | `https://ume.defensa.gob.es/LA_UME_POR_DENTRO/organizacion/` |

**Even this row is sourced only as to *structure and basing*.** UME has not committed these units to
anything. The row is therefore `SOURCED-STRUCTURE`, never "UME is standing by".

### 2.2 ILLUSTRATIVE — no published figure was verified

| Region | `org` (real organisation, correct jurisdiction) | Proposed `kind` mix | Why illustrative |
|---|---|---|---|
| `us-ca` | **CAL FIRE** (California Department of Forestry and Fire Protection) | `ENGINE` ×2, `CREW` ×1, `AIRCRAFT` ×1 | CAL FIRE genuinely operates engines, hand crews and an air programme, but **`fire.ca.gov` is edge-blocked (403) from this environment**, so no fleet figure could be verified. Numbers are a plausible incident-scale allotment, not a published fleet. |
| `us-ca` | **Cal OES** (California Governor's Office of Emergency Services) | `SUPPLY` ×1 | Cal OES coordinates mass care with CDSS and the Red Cross (Cal OES publishes shelter announcements at `news.caloes.ca.gov`), but no published asset inventory was located. |
| `ro` | **IGSU / ISU Galați** | `MEDICAL` ×1, `CREW` ×1, `SUPPLY` ×1 | IGSU is the correct national authority and ISU Galați the correct county inspectorate for the EMSR758 demo, but no per-inspectorate fleet figure was verified. |
| `gr` | **Πυροσβεστικό Σώμα Ελλάδος (Hellenic Fire Corps)** | `ENGINE` ×2, `CREW` ×1 | The Fire Corps site (`fireservice.gr`) resolved but no headline vehicle/personnel figure was extracted within this WP's budget. |
| `ph` | **NDRRMC** (National Disaster Risk Reduction and Management Council) — with **Quezon City DRRMO** as the local operator on the shelter rows | `SUPPLY` ×2, `MEDICAL` ×1 | NDRRMC is a *coordinating council*, not an asset-holding operator; assigning it engines would misdescribe it. Supply/medical is the honest shape, and it is still illustrative. |

**A note the implementer must not skip:** `RESOURCE_KINDS` is `CREW | ENGINE | AIRCRAFT | MEDICAL |
SUPPLY | TEAM` and a `Resource` carries only `id, kind, status, orgId?, geom?`. There is **no
capability, count, callsign, or provenance field**, so "2× CIEN" can only be expressed as two rows —
and **there is nowhere on a resource row to write the word ILLUSTRATIVE except `org`.** See §4.5 and
PLAN-DELTA-4.

**Upgrade path (for a later agent, not this WP):** CAL FIRE and Hellenic Fire Corps figures are almost
certainly published; they were simply not reachable here. Any row in §2.2 may be promoted to §2.1
*only* by citing the operator's own primary publication — never a news article, never an encyclopaedia.

---

## §3 — Part 3 · The honesty wording (deliverable)

### 3.1 Exact header comment for `config/shelters.json`

Replaces the existing `$comment`. Written as a single JSON string (the schema allows `$comment` at the
root and per-region-group `$comment` is **not** allowed — `additionalProperties: false` on
`regionGroup` — so all of this lives at the root; see §4.7).

```
"$comment": "Agency-seeded shelters, edited by hand (docs/OPERATOR_GUIDE.md). Apply with `npm run db:seed` (idempotent, keyed by id). Mid-incident corrections go straight to the DB: UPDATE shelter SET occupancy = <n> WHERE id = '<id>'. ── PROVENANCE (binding, docs/RESPONSIBLE_DATA.md rules 6 & 11; evidence pack: docs/audit/V2-A4-SEED-SOURCING-2026-09-10.md). Every row below is a REAL, PUBLICLY-LISTED site. No shelter here was invented, and NO capacity or occupancy figure appears that its source did not publish. Rows fall into exactly two classes, and the class is stated in each row's `note`: (A) SOURCED — the named authority publishes this site AND its capacity, and the row reproduces both verbatim; (B) DESIGNATED-SITE REFERENCE — the named authority publishes this site as a designated assembly/reception/refuge point but publishes NO capacity, so capacity is recorded as 0, which means UNKNOWN and NOT 'this building holds nobody'. A capacity of 0 makes the shelter ineligible as an evacuation destination (src/adapters/logistics/shelter-ranking.ts: OPEN and capacity-occupancy>0), which is the intended, honest behaviour: BEACON will not route people to a building nobody has counted. NONE of these rows is a live shelter roster. `status` reproduces what the source published at the retrieval date and is NOT a real-time availability signal. ── SOURCES, retrieved 2026-09-10: us-ca = FEMA ESF#6 Shelter System (formerly the National Shelter System), https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer layer 1 `Closed Shelters` — credit 'FEMA, Mass Care, American Red Cross'; US Government work, 17 U.S.C. 105; POC name/phone/e-mail fields deliberately NOT copied (RESPONSIBLE_DATA rule 4). ro = IGSU, 'Situatia adaposturilor de protectie civila' (June 2026 data, published 10 July 2026), https://igsu.ro/adaposturi-de-protectie-civila — Romanian public-authority document, attribution required, no open licence declared; these are CIVIL-PROTECTION shelters, NOT flood evacuation centres. es = Ajuntament de Barcelona, 'Xarxa de refugis climatics', https://opendata-ajuntament.barcelona.cat/data/en/dataset/xarxa-refugis-climatics — CC BY 4.0, updated 2025-09-23; this is a HEAT-refuge network, NOT a wildfire evacuation roster, and it publishes no capacity. gr = Dimos Volou, Grafeio Politikis Prostasias, wildfire memorandum 2020, Annex A 'Choroi Sygkentrosis Politon' — municipal public document, no open licence declared, no capacity published; coordinates are NOT from the municipality (Panthessaliko Stadium: Wikidata Q930369, CC0; Makrinitsa central square: OpenStreetMap way 586470654, ODbL). ph = Quezon City Government / QCDRRMO, 'QC Evacuation Centers for Flood and Fire', https://quezoncity.gov.ph/qcitizen-guides/quezon-city-evacuation-centers/ — LGU public directory, page updated 2026-09-10, no capacity and no coordinates published; coordinates are from OpenStreetMap via Nominatim (ODbL), matched on the directory's own published street address. ── KNOWN GAPS, stated rather than filled: Greece's national assembly-point platform (mysafetyplan.gov.gr) declares NO licence and is therefore NOT used; the Philippine national master list is not publicly released; Bucharest has ZERO public shelters in the IGSU register (all 1,539 Bucharest entries are private), so no Bucharest row is seeded; the es/gr/ph sites are region-valid but geographically distant from those regions' demo incidents."
```

### 3.2 Exact per-row `note` prefixes

`note` is file-only (never persisted — the `Shelter` entity has no name field, finding F-406), so it
is where the per-row class and citation live. **Every row's `note` starts with one of exactly two
tokens:**

```
"note": "[SOURCED · FEMA NSS 173423] Sacramento Convention Center — 1400 J Street, Sacramento CA 95814. capacity=evacuation_capacity as published; status as published 2026-09-10."
"note": "[SOURCED · IGSU 2403] Primaria Municipiului Galati, Str. Domneasca nr. 54 — Public, Functional; capacity 195 persons as published (June 2026)."
"note": "[DESIGNATED-SITE · Ajuntament de Barcelona] Parc de la Ciutadella, Pg. de Picasso 21 — designated CLIMATE refuge (heat), not a wildfire evacuation centre. NO capacity published: capacity 0 means UNKNOWN."
"note": "[DESIGNATED-SITE · Dimos Volou wildfire memorandum 2020, Annex A] Panthessaliko Stadium, Nea Ionia, Volos — named assembly point. NO capacity published: capacity 0 means UNKNOWN. Coordinate: Wikidata Q930369 (CC0), NOT published by the municipality."
"note": "[DESIGNATED-SITE · QCDRRMO directory, page updated 2026-09-10] Bagong Silangan Evacuation Center, Gen. Geronimo St — type 'Permanent'. NO capacity published: capacity 0 means UNKNOWN. Coordinate: OSM way 279718237 (ODbL), NOT published by the LGU."
```

### 3.3 Exact operator-facing label text (this is what reaches the screen)

The requirement is that the distinction reaches the **operator**, not only a code comment. There are
two existing surfaces that already emit shelter provenance prose, and the wording below is drafted to
drop into them.

**(a) Shelter board provenance line** — replaces the string built in
`src/application/coordination/shelter-status.ts` (currently:
`"MOCK/seeded shelter data from ${sourceLabel} — illustrative, NOT an operational feed (${asOf})."`):

> **Seeded shelter reference — not a live roster.** These sites are real and publicly listed by the
> authority named on each row, as published on {asOf}. **{n} of {total} carry a capacity that the
> authority actually published**; the remainder are **designated assembly/refuge points with no
> published capacity**, shown with capacity unknown and therefore never offered as an evacuation
> destination. Occupancy is not live. BEACON has no shelter-status feed for any of these regions.

**(b) Illustrative-resource banner** — the label for the resource list / tasking board:

> **Illustrative response resources.** These units are named after organisations that genuinely
> operate in this region — {orgs} — so the coordination workflow can be exercised against realistic
> agencies. **They are not a real order of battle: no organisation named here has committed any asset
> to BEACON, and none of these units is being tracked.** Where a row's capability mix reflects a
> figure the organisation itself has published, the row is marked **Sourced**; every other row is
> marked **Illustrative**.

**(c) Per-row badge text** (the shortest form, for a table cell or chip):

| Class | Badge | Tooltip |
|---|---|---|
| Shelter, capacity published | `Sourced` | "Site and capacity published by {org} on {date}. Not a live availability feed." |
| Shelter, no capacity published | `Designated site` | "Published by {org} as a designated assembly/refuge point. Capacity unknown — not offered as a destination." |
| Resource, structure published | `Sourced structure` | "Unit structure published by {org}. Not an asset commitment." |
| Resource, no figure | `Illustrative` | "Plausible unit named after a real agency. Not a commitment, not tracked." |

**(d) The one-line version for the demo narration / judge-facing README:**

> Shelters are real, published sites with their publishers' own capacities where those exist;
> response resources are illustrative units named after the real agencies that cover each region.
> BEACON does not claim a live shelter or resource feed anywhere.

---

## §4 — Part 4 · Fit check against the domain factory and schemas

Read: `src/domain/shelter.ts` (`makeShelter`), `src/domain/resource.ts` (`makeResource`),
`schemas/shelters.schema.json`, `src/adapters/persistence/shelter-registry.ts`,
`src/adapters/persistence/mappers.ts`, `src/adapters/persistence/schema/logistics-tables.ts`,
`src/adapters/logistics/shelter-ranking.ts`, `src/application/impact/shelter-demand.ts`.

### 4.1 Invariants every proposed shelter row satisfies

| Invariant (`makeShelter`) | Status for all 16 proposed rows |
|---|---|
| `geom` is a GeoJSON `Point` with a valid `[lon,lat]` position | ✅ all rows have finite lon/lat inside their region bbox (spot-checked against `config/regions.json`) |
| `capacity` is a non-negative integer | ✅ — 9730/2720/4999/2600/2348 (us-ca); 195/70/50/430 (ro); **0** for all es/gr/ph rows (see §4.2) |
| `occupancy` is a non-negative integer, defaults 0 | ✅ all rows propose `occupancy: 0`; **no occupancy figure is invented** — FEMA's `total_population` was null or 0 on every proposed CA row, and no other source publishes occupancy at all |
| `occupancy <= capacity` | ✅ 0 ≤ every capacity, including 0 ≤ 0 |
| `status ∈ {OPEN, FULL, CLOSED}` | ✅ only OPEN and CLOSED are proposed; **no row is FULL** |
| `status === 'FULL' ⇒ occupancy === capacity` | ✅ vacuously — no FULL rows |
| JSON-Schema: `required: [id, lon, lat, capacity]`, `additionalProperties: false` | ✅ every row supplies all four; `id` will be a fresh lowercase-hex UUID matching the pattern; only `id/note/org/lon/lat/capacity/occupancy/status` are used |
| Loader `assertUniqueIds` across region groups | ✅ new ids must not collide with `…0b01`/`…0b02`/`…0b03`; trivially satisfiable |

**No proposed row violates any invariant.**

### 4.2 🔴 FINDING F-A4-1 — "capacity not published" cannot be expressed in config

This is the most consequential fit finding, and it affects **11 of 16** proposed rows (all of es, gr, ph).

The **persistence layer already models unknown capacity**:

- `logistics-tables.ts`: `capacity: integer('capacity')` — **nullable**, and
  `chk_shelter_occupancy_le_capacity` is written `capacity IS NULL OR occupancy <= capacity`.
- `mappers.ts::shelterMapper.fromRow` carries the intent explicitly:
  > *"`capacity` is NULLABLE in the DDL while the domain requires a number. NULL means 'nobody has
  > counted this building', and it hydrates to 0 — which makes the shelter INELIGIBLE for matching
  > rather than a destination with an invented headroom (Art. XVI: degrade honestly, never fabricate a
  > figure)."*

The **config layer does not**:

- `schemas/shelters.schema.json` → `"required": ["id", "lon", "lat", "capacity"]`.
- `shelter-registry.ts::parseShelter` → `capacity: requireNumber(raw.capacity, 'capacity')` — throws
  `PARSE_ERROR` if absent.
- `MakeShelterInput.capacity: number` — not optional; `makeShelter` asserts `Number.isInteger`.

So an operator can put "capacity unknown" in the **database** but cannot put it in the **file that is
supposed to be the reproducible starting state**. That asymmetry is a real defect.

**Two ways forward, both honest, and the choice is the owner's:**

- **(A) Zero-code, available today: seed `capacity: 0`.** It validates, it passes `makeShelter`, and
  it produces *exactly the behaviour the codebase already documents for NULL*: `hasSpareCapacity` is
  `OPEN && capacity - occupancy > 0` → false → the site is never offered as a destination;
  `shelter-demand.ts` sums `max(0, capacity - occupancy)` → contributes 0, so headroom is understated
  rather than inflated. There is even a precedent fixture case
  (`fixtures/coordination/shelters.json`: *"one zero-capacity OPEN (the ratio-with-no-denominator
  case)"*). **Cost:** on the wire and in the DB, `0` reads as the assertion "this building holds zero
  people", which is not what the source said. The §3.1/§3.2 wording is what repairs that, and it only
  repairs it for a reader who sees the label.
- **(B) Small, clean schema change (recommended): make `capacity` optional end-to-end.** Drop
  `capacity` from `required` in `shelters.schema.json`; make `MakeShelterInput.capacity?: number` with
  the invariants applying only when present; have `parseShelter` omit it when absent;
  have `shelterMapper.toRow` write `NULL`. `fromRow` already handles NULL→0. This makes the file able
  to say what the database can already store, and removes the "0 = unknown" ambiguity from the data
  itself instead of only from the prose. **Cost:** it touches the domain factory, so it needs its own
  gate (unit tests for absent-capacity + a round-trip test), and `Shelter.capacity` consumers
  (`shelter-ranking`, `shelter-demand`, `incident-summary`) must be re-read.

**Recommendation: (B), with (A) as the fallback if the owner will not open the domain factory.**
Whichever is chosen, the §3 wording must state the convention explicitly, because a bare `0` in a JSON
file is indistinguishable from a real zero.

### 4.3 🟠 FINDING F-A4-2 — the shelter NAME never reaches the operator

`note` is documented as file-only and `parseShelter` deliberately does not read it:

> *"`note` is not read here on purpose: it is an operator comment in the file, and the Shelter entity
> has no name field to carry it (finding F-406 — a label no column can keep true is worse than none)."*

Consequence for this WP: **"Sacramento Convention Center", "Πανθεσσαλικό Στάδιο" and "Bagong Silangan
Evacuation Center" — the very facts that make these rows real — never leave `config/shelters.json`.**
The operator sees a point, a capacity, a status and an `org` string. The credibility of the sourcing
is therefore invisible at exactly the moment a judge would want to check it.

`org` is the **only** per-row string that reaches the DB and the UI (`shelter.org`, via
`orgId`). That makes `org` load-bearing for honesty, and it is why the §1 tables set `org` to the real
publishing/operating authority (e.g. `"American Red Cross — Sacramento Sierra"`,
`"Ajuntament de Barcelona"`, `"Δήμος Βόλου — Πολιτική Προστασία"`) rather than a generic label.

**This is not fixed by wording.** Either the schema gains a name/provenance column, or the board
label in §3.3(a) has to carry the whole claim at aggregate level. Flagged as PLAN-DELTA-2.

### 4.4 🟠 FINDING F-A4-3 — Romania's `Parțial-funcțional` has no honest status

`SHELTER_STATUSES = ['OPEN','FULL','CLOSED']`. The IGSU register's third state,
**`Parțial-funcțional` (2,724 of 5,500 rows — the largest bucket)**, maps to neither: `OPEN`
overstates it, `CLOSED` understates it.

**Resolution taken in §1.2: do not seed partial rows at all.** Only `Funcțional` → `OPEN` and
`Nefuncțional` → `CLOSED` are proposed. This keeps every seeded status a faithful reproduction of a
published fact with **zero schema change**, at the cost of ignoring half the register. That trade is
the right one and should be stated in the seed comment (it is, in §3.1, by implication of "status
reproduces what the source published").

### 4.5 🔴 FINDING F-A4-4 — there is no config surface for resources at all

`config/` contains `shelters.json` (+ `schemas/shelters.schema.json`) but **no `resources.json` and no
resource schema**. Resources exist only as TypeScript literals in `src/main/feature-seed.ts`:

```
makeResource({ id: asId<ResourceId>('ca-engine-1'), kind: 'ENGINE', status: 'AVAILABLE', orgId: CA_ORG, geom: point([-121.55, 39.72]) }),
makeResource({ id: asId<ResourceId>('ca-crew-1'),   kind: 'CREW',   status: 'AVAILABLE', orgId: CA_ORG }),
makeResource({ id: asId<ResourceId>('ro-medical-1'),kind: 'MEDICAL',status: 'AVAILABLE', orgId: RO_ORG, geom: point([28.05, 45.43]) }),
```
with `CA_ORG = 'cal-fire'`, `RO_ORG = 'isu-ro'`, and `src/adapters/persistence/seed.ts` inserting **no
resource rows whatsoever** (it inserts regions, source records, app users, shelters — that is all).

So A4·3's *"resources seeded per region as ILLUSTRATIVE-labelled rows"* currently means **editing
application code**, which contradicts the ADR-012 "config for everything" posture that shelters
already follow. And under `FEATURE_STORE=postgres` the resource table is simply **empty**.

Further, `Resource` has fields `id, kind, status, orgId?, geom?` only — **no capability, count,
callsign, or provenance field** — so:

- "BIEM V = 2× CIEN + 1× CING" can only be expressed as three rows;
- **there is nowhere on a resource row to write "ILLUSTRATIVE" except `orgId`.** Encoding the label
  into `org` (e.g. `"UME BIEM V (illustrative)"`) would poison a real organisation's name with a
  BEACON-internal qualifier and would show up wherever `org` is rendered. **Do not do that.** The
  label must be a UI-level banner (§3.3(b)) plus, if resources become config, a file-level `$comment`
  and a per-row `note` mirroring the shelter pattern.

Flagged as PLAN-DELTA-4.

### 4.6 🟡 FINDING F-A4-5 — FEMA publishes two capacities; BEACON has one column

`evacuation_capacity` (pre-impact, people sheltered before the hazard arrives) and
`post_impact_capacity` (roughly half — sustained sheltering after impact) are **both** published.
BEACON's `shelter.capacity` is a single integer. §1.1 proposes `evacuation_capacity`, which is the
larger and matches BEACON's evacuation-destination use case, but the choice is a modelling decision
and **must be recorded in the seed comment** (it is, in §3.2's per-row `note`). Seeding the larger
figure without saying which one it is would be a quiet overstatement of headroom.

### 4.7 🟡 FINDING F-A4-6 — per-region provenance has nowhere to live in the schema

`schemas/shelters.schema.json` sets `additionalProperties: false` on `regionGroup`, whose only allowed
keys are `region_id` and `shelters`. There is **no `$comment` on a region group**, so the five
different licences and five different caveats (§3.1) all have to be crammed into the single root
`$comment` — producing the very long string in §3.1. It is correct but hard to read, and an operator
editing the `gr` group sees no local reminder that those coordinates are OSM-derived.

**Low-cost fix:** add `"$comment": { "type": "string" }` to `regionGroup.properties` (the loader
already ignores unknown keys it does not read, but `additionalProperties: false` makes the *schema*
reject it, so the schema must be edited). Then each region group carries its own provenance
paragraph. Flagged as PLAN-DELTA-5.

### 4.8 Resource rows — fit check

| Invariant (`makeResource`) | Status |
|---|---|
| `kind ∈ {CREW, ENGINE, AIRCRAFT, MEDICAL, SUPPLY, TEAM}` | ✅ only CREW/ENGINE/AIRCRAFT/MEDICAL/SUPPLY proposed |
| `status ∈ {AVAILABLE, ASSIGNED, OOS}` | ✅ all proposed rows are `AVAILABLE` |
| `geom` optional; if present a valid `Point` | ✅ — where a resource is given a point it sits inside its region bbox; **rows without a defensible location are proposed with no `geom` at all** rather than a guessed one (the factory permits absent `geom`) |
| `orgId` optional free text → `resource.org` | ✅ carries the real organisation name |

### 4.9 Rows that will NOT fit the current schema — the short list

| # | Row / need | Blocked by | Severity |
|---|---|---|---|
| 1 | 11 rows (all es/gr/ph) whose source publishes **no capacity** | `capacity` required in schema + loader + `MakeShelterInput` | 🔴 must be decided before implementation (§4.2) |
| 2 | The published shelter **name** for every row | `Shelter` has no name field (F-406); `note` is file-only | 🟠 honesty is invisible to the operator (§4.3) |
| 3 | Romania's **`Parțial-funcțional`** (2,724 register rows) | `SHELTER_STATUSES` has three values, none of which fits | 🟠 sidestepped by not seeding them (§4.4) |
| 4 | **Any** resource row, for any region | No `config/resources.json`, no resource schema, no resource rows in `seed.ts` | 🔴 A4·3 cannot be delivered as config without new surface (§4.5) |
| 5 | The **ILLUSTRATIVE** label on a resource row | `Resource` has no note/provenance field; `org` must not be abused | 🔴 needs a UI banner, not a data field (§4.5) |
| 6 | FEMA's **second** capacity (`post_impact_capacity`) | one `capacity` column | 🟡 record the choice (§4.6) |
| 7 | **Per-region** provenance/licence text | `regionGroup` is `additionalProperties: false` with no `$comment` | 🟡 one-line schema addition (§4.7) |

---

## §5 — PLAN-DELTAs

**PLAN-DELTA-1 — A4·3's premise does not hold for three of five regions.**
The plan says *"extend `config/shelters.json` + region seeds with **real published shelter/asset
lists** for us-ca, ro, es, gr, ph"*. Real published lists exist for **us-ca and ro only**. For
**es/gr/ph** there is no publishable shelter roster: Greece's national platform declares no licence
(and OSM refused an import on that basis), the Philippine national master list is not publicly
released, and Spain has no national or wildfire-scoped equivalent. The plan line should be amended to
*"real published shelter lists where they exist (us-ca, ro), and clearly-labelled designated-site
references where they do not (es, gr, ph)"* — otherwise a later agent will read the plan as licence to
manufacture the missing rows.

**PLAN-DELTA-2 — "cited in the seed file header" is necessary but not sufficient.**
The plan asks for citation *in the seed file header*. Because `note` is never persisted and the
`Shelter` entity has no name field (§4.3), a header citation is invisible to anyone who is not reading
the repository — including a judge looking at the running demo. A4 should additionally require the
operator-facing wording of §3.3 to be **rendered**, not only committed. This is a small addition to
A4's gate: *"the shelter board renders the sourced-vs-designated provenance line, and the resource
board renders the illustrative banner."*

**PLAN-DELTA-3 — honest CA seeding leaves the demo with no OPEN shelter.**
Every one of the 6,888 California records in FEMA's feed is `CLOSED` (§1.1). Seeding them faithfully
means CA has **zero** shelters with spare capacity, so `hasSpareCapacity` filters them all out and the
evacuation-destination ranking has nothing to offer. Three options, in descending order of honesty:
**(a)** accept it and let the demo show the honest state ("no shelter with spare capacity in this
region — BEACON has no shelter-status feed"); **(b)** keep the CA rows `CLOSED` and add **one**
explicitly-labelled exercise row (`org: "BEACON exercise — not a real shelter"`, `note` beginning
`[EXERCISE]`) so the routing feature has a destination; **(c)** flip real rows to `OPEN` — **this is
forbidden**, it would assert an availability FEMA did not publish. The owner must choose (a) or (b).
Romania does **not** have this problem: three `Funcțional` public shelters seed as `OPEN` with real
capacities, so the evacuation flow can be demonstrated on the `ro` region truthfully.

**PLAN-DELTA-4 — resources need a config surface before they can be "seeded per region".**
There is no `config/resources.json`, no resource schema, no resource rows in
`src/adapters/persistence/seed.ts`, and no field on `Resource` that can hold the ILLUSTRATIVE label
(§4.5). Delivering A4·3's resource half therefore requires a new WP mirroring the shelter registry:
`config/resources.json` + `schemas/resources.schema.json` + a `resource-registry.ts` loader running
`makeResource` at load + `seed.ts` inserting the rows. That is real work and is **not** currently
scoped in A4. Either scope it, or restate A4·3 as "resources remain code-seeded in
`src/main/feature-seed.ts`, extended to five regions and labelled in the UI".

**PLAN-DELTA-5 — two small schema edits unblock honest seeding.**
(i) `capacity` optional in `schemas/shelters.schema.json` + `MakeShelterInput` + `parseShelter` +
`shelterMapper.toRow` (the DB column and `fromRow` already support it) — §4.2 option (B);
(ii) allow `$comment` on `regionGroup` so per-region licence text lives next to the rows it governs —
§4.7. Both are additive and neither changes behaviour at existing values.

**PLAN-DELTA-6 — the es/gr/ph shelters are region-valid but demo-distant.**
Barcelona (ES), Volos (GR) and Quezon City (PH) are all inside their regions' bboxes but hundreds of
kilometres from those regions' seeded incidents (Zamora, North Evia, Maguindanao). The shelters will
render on the map but will not cluster near the incident. This is a *presentation* consequence of
refusing to invent local rows, and it is the correct trade — but it should be stated in
`DEMO_SCRIPT.md` so it is not discovered live on camera.

---

## §6 — Appendix · Reproduction commands

Every claim above is reproducible. These are read-only.

```bash
# us-ca — FEMA ESF#6 Shelter System: service metadata, CA count, and the five proposed rows
curl -s "https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer?f=pjson"
curl -s -G "https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer/1/query" \
  --data-urlencode "where=state='CA'" --data-urlencode "returnCountOnly=true" --data-urlencode "f=pjson"
curl -s -G "https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer/1/query" \
  --data-urlencode "where=shelter_id IN (173423,169390,171019,170989,173422)" \
  --data-urlencode "outFields=shelter_id,shelter_name,address_1,city,county_parish,zip,evacuation_capacity,post_impact_capacity,latitude,longitude,org_organization_name,shelter_status_code" \
  --data-urlencode "returnGeometry=false" --data-urlencode "f=pjson"

# ro — IGSU register (find the current GUID on the landing page, then fetch + extract)
curl -sL "https://igsu.ro/adaposturi-de-protectie-civila" | grep -oE 'href="[^"]*\.pdf"'
curl -sL -o ro.pdf "https://igsu.ro/resources/cb307076-fbd5-4c1d-a24b-1331e601af47.pdf" && pdftotext -layout ro.pdf ro.txt
grep -E '^\s*(2403|2449|4171|2413)\s' ro.txt

# es — Barcelona climate shelters (CC BY 4.0); note the CSV is UTF-16
curl -s "https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_search?q=refugis+climatics"

# gr — Volos wildfire memorandum, Annex A (assembly points); and the two coordinates
#   (URL must be percent-encoded; see §1.4)
curl -s "https://www.wikidata.org/wiki/Special:EntityData/Q930369.json"   # Panthessaliko Stadium, CC0

# ph — Quezon City DRRMO directory (503 table rows, 2 of type 'Permanent')
curl -s "https://quezoncity.gov.ph/qcitizen-guides/quezon-city-evacuation-centers/" | grep -c '<tr'

# es resources — UME organisation (BIEM V, San Andrés de Rabanedo; 2 CIEN + 1 CING per BIEM)
curl -s "https://ume.defensa.gob.es/LA_UME_POR_DENTRO/organizacion/"
```

---

*End of evidence pack. No file other than this one was created or modified by this work package.*
