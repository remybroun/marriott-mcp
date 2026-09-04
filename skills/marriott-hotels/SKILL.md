---
name: marriott-hotels
description: Search Marriott hotels for live prices and availability with marriott-mcp. Use when picking or comparing hotels in a city, finding the cheapest night or date to travel, pricing a corporate/cluster rate code or a points redemption, or planning a multi-night stay across several properties.
---

# Marriott hotel search

Two front ends over one engine. Use whichever is present:

- **MCP tools**, when the `marriott` server is connected: `search_hotels`, `scan_dates`,
  `plan_stay`, `suggest_places`, `brand_tiers`, `session_status`, `graphql_raw`.
- **CLI** otherwise: `npx -y -p github:remybroun/marriott-mcp marriott <command>`.
  `marriott --help` is the authority on flags.

The first live call starts Chrome and waits out Akamai's bot challenge: 30-60 seconds.
Later calls are fast. Say so before making it, rather than letting it look hung.

## Answering a hotel question

1. Pin the trip: destination, check-in, nights, adults and rooms. Ask only for what would
   change the search; default to 1 adult and 1 room and say which defaults you used.
   Resolve a vague or ambiguous destination with `suggest_places` (`marriott places`)
   before searching on a guess.
2. Set `currency` on any search that could span currencies. Without it, prices in
   different currencies are compared as bare numbers and "cheapest" means nothing.
3. Search. `order_by: "value"` (`--by value`) ranks all-in price per brand-tier point,
   which is what people usually mean by "the best deal"; `price` is for the literally
   cheapest room.
4. Read the result against the traps below before reporting anything.
5. Report a shortlist, each row carrying its currency, and state what you priced: dates,
   guests, and which rate applied.

## Traps

**A multi-night price is an average.** A multi-night search reports the average per night,
not each night. One spike night lifts the whole figure. Before calling a week expensive,
price single nights across it with `scan_dates` (`--scan`): the average hides which nights
carry the cost.

**A rate code that does not apply comes back silently as the ordinary standard rate.**
Those rows are marked `!`. The marker means "code unavailable here", not a price. Drop
those rows or call them out; ranking them against real coded rows is wrong.

**Tier grades are this tool's own editorial ranking, not Marriott's.** Say so whenever you
present them.

**A failure wants a diagnosis, not a retry.** Call `session_status` (`marriott debug`)
first. Repeated retries against an Akamai challenge escalate it into a hard block.

## Rate codes

The user's corporate/cluster code lives in `~/.marriott-mcp/config.json` and applies to
every search unless overridden. Pass the *saved name* (`code: "work"`, `--code work`) so
the code itself stays out of the conversation, and leave masked codes (`A****3`) masked in
what you report. `no_code: true` / `--no-code` ignores the stored default for one search;
`rate: "points"` prices a redemption instead. Points and a cluster code are mutually
exclusive.

## Multi-night stays

`plan_stay` / `marriott plan` finds the cheapest path *through* hotels, because prices
move independently per property. It builds the path from one-night prices, then re-prices
each multi-night block as the booking you would actually make, and reports both. Set `tolerance`,
how much cheaper a move must be to be worth making (default 0.1), higher when the user
would rather not move. It costs roughly one search per night, so set
`currency` and expect it to run for a while.
