# 07 — Brand Grading: sources and reasoning

Validation pass for `src/brands.js`, done 2026-08-29 against six independent sources.

The table has two axes so nothing ties:

- `grade` — coarse tier (`SS` … `C`)
- `rank` — strict total order, 1–40, **no two brands share a rank**

---

## Sources

| # | Source | What it gives | Weight |
|---|---|---|---|
| 1 | [J.D. Power 2026 NA Hotel Guest Satisfaction Study](https://www.jdpower.com/business/press-releases/2026-north-america-hotel-guest-satisfaction-study/) | 44,787 guests, 104 brands, 9 segments. Measured satisfaction. | **Highest** — real sample, not opinion |
| 2 | [The Points Guy, Marriott brands overview](https://thepointsguy.com/hotel/marriott-hotel-brands/) | Per-brand positioning + Bonvoy base-points earn rate | High — earn rate is objective |
| 3 | [SilverSky, Bonvoy brand ladder](https://silversky.travel/the-marriott-bonvoy-brand-ladder-what-each-tier-actually-delivers/) | Ultra-luxury vs core-luxury split | Medium |
| 4 | [SilverSky, Ritz-Carlton vs St. Regis](https://silversky.travel/ritz-carlton-vs-st-regis-marriott-luxury/) + [Bonvoy award pricing](https://awardtravelfinder.com/award-charts/marriott-bonvoy) | Direct head-to-head; dynamic award ceilings | Medium-high — pricing is revealed preference |
| 5 | [STR / CoStar chain scale](https://www.costar.com/products/str-benchmark/resources/glossary) | Industry segmentation by actual room rate | High — the industry's own yardstick |
| 6 | [Forbes Travel Guide 2026 Star Awards](https://stories.forbestravelguide.com/forbes-travel-guides-2026-star-award-winners-including-the-worlds-first-five-star-cruise) | Five-Star property counts | Medium |

---

## The St. Regis vs Ritz-Carlton question

Asked directly, because the prior assumption was "St. Regis is slightly better". **The
evidence splits, and which one is 'better' depends entirely on which axis you measure.**

| Axis | Winner | Evidence |
|---|---|---|
| Measured guest satisfaction | **Ritz-Carlton** | J.D. Power 2026: #1 in Luxury at **785**, second consecutive year. St. Regis does not appear in the reported top four (Waldorf 776, Four Seasons 767, Luxury Collection 758). |
| Peak positioning / ceiling | **St. Regis** | Dynamic award pricing runs to **~220,000 pts/night** (St. Regis Maldives Vommuli) vs Ritz-Carlton typically 50–120k, NoMad peaking ~160k. |
| Service model | **St. Regis** | Butler service on every property — genuinely distinguishes it from every other Marriott luxury brand. Sabrage, afternoon tea, marquee addresses. |
| Consistency | **Ritz-Carlton** | Described as more consistent across properties; broader estate with strong resorts and club lounges. |
| Industry recognition | Tie | Forbes 2026: both added new Five-Star properties. Marriott's Luxury Group ≈30% of new Five-Star hotels. |

Two sources describe them as **co-equal**: The Points Guy calls St. Regis "one of the top
two Marriott brands, competing for the top spot with the Ritz-Carlton", and SilverSky
concludes it is not that one is objectively more prestigious but that they "serve
different types of luxury".

### Verdict encoded in the table

**St. Regis is ranked #2, Ritz-Carlton #3 — both `SS`.**

St. Regis edges ahead on the axis a tier list actually encodes: ceiling, exclusivity and
service model. Ritz-Carlton is genuinely the better bet for a *predictable* stay, and if
the table graded consistency it would flip. The one-rank gap is deliberate and narrow;
treating them as interchangeable at the top is defensible too.

**Bulgari is #1**, above both — the smallest, most exclusive and highest-ADR portfolio in
the group. This is the one luxury ordering none of the sources dispute.

---

## Where the sources produced hard separation

The complaint that drove this pass was too many ties. These findings broke the clumps:

**Bonvoy base-points earn rate is an objective tiering signal.** Most brands earn 10x per
dollar. These do not:

| Earn rate | Brands | Implication |
|---|---|---|
| 5x | City Express, Four Points Flex, Protea, Element, Residence Inn, Apartments, Homes & Villas | Economy or extended-stay economics |
| 4x, **no elite night credits** | StudioRes | Floor of the entire portfolio → rank 40 |
| 2.5x, 1 elite night per 3 | Marriott Executive Apartments | Corporate housing, not a hotel |

**Explicit relative statements** from source 2, used directly:

- Delta Hotels — "relatively basic compared to other premium Marriott brands" → demoted
  to `B+` #18 despite carrying a Premium badge.
- TownePlace Suites — "usually a step below Residence Inn properties" → #33 vs RI #20.
- StudioRes — "the most basic extended-stay option" → #40.
- Moxy — won TPG Best Affordable Hotel Brand 2023, but rooms "often surprisingly small".
- SpringHill Suites — "slightly larger rooms with desks, couches" + breakfast → above
  Fairfield.
- AC Hotels — "often feel sparse but are usually functional".
- Luxury Collection — "no consistent brand standard" → flagged `variable`.

**STR chain scale** anchors the mid-tier objectively: Marriott Hotels and Le Méridien are
Upper Upscale, Courtyard is Upscale, Fairfield is Upper Midscale. That is a rate-based
industry classification, not opinion, and it sets the `A`/`B+`/`B-` boundaries.

**W Hotels demoted to `A+` #7**, out of the top luxury block. It is priced as luxury but
positioned as "energetic, design-forward, bar-centric" — the service model is not
luxury-tier, and it is the most polarising brand in the portfolio.

---

## Known limitations

- **J.D. Power is North America only.** It carries real weight for US stays and much less
  for, say, a Sheraton in Istanbul.
- **Award pricing is dynamic**, so the St. Regis ceiling reflects a handful of trophy
  resorts rather than the brand average.
- **Soft brands cannot be graded meaningfully.** Autograph, Tribute, Luxury Collection,
  Design Hotels, MGM, Homes & Villas, Sonder, Series and Outdoor are collections of
  independent properties. `variable: true` marks them and the CLI prints `*`. For these
  the property's own review score matters far more than the tier.
- **citizenM has thin coverage** — TPG's overview does not cover it, so its `B+` rests on
  general reputation rather than a cited source. Lowest-confidence entry in the table.
- Ranks are a **total order across segments**, which forces comparisons that are not
  strictly like-for-like (a Residence Inn against a Courtyard). Segment is retained on
  every row so you can ignore cross-segment ranking where it is not meaningful.
