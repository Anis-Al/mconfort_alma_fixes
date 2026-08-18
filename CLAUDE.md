# mconfort_alma_fixes

Odoo 19 module. Four corrections to the Alma widget shipped by
`mconfort_alma_widgets`. Assets only — no models, no views, no data.

Depends on `mconfort_alma_widgets`, so its bundle entries load **after** the parent's and win at
equal specificity. Nothing here uses `!important` except where it must beat an inline `style`
attribute written by the parent's JS.

| File | Fixes |
|---|---|
| `static/src/scss/alma_fixes.scss` | 1 (mobile overflow), 3 (checkout card height), 4 (modal height on mobile) |
| `static/src/js/alma_qty.js` | 2 (amount follows the qty box), 5 (cart amount follows the cart qty) |

Git: repo lives in this directory, `main` tracks
`https://github.com/Anis-Al/mconfort_alma_fixes.git`. Commits carry the user's name only — no
`Co-Authored-By` trailer.

## Where the parent lives

`mconfort_alma_widgets` is in **`server/odoo/addons/`**, not `mnt/`. Both are in `addons_path`.
Read `addons/mconfort_alma_widgets/static/src/js/alma_widget.js` before touching anything here —
every fix below leans on an implementation detail of that file.

Same warning as `dt_payment_alma_min_amounts`: `dt_payment_alma` exists **twice**
(`addons/` and `mnt/`), contents identical, `addons/` wins. Edit both or they drift.

## Fix 1 — mobile overflow on the product page

`.o-alma-widget` is `flex-wrap: nowrap` with `max-width: max-content`. The parent's mobile rules
(`@media (max-width: 1199.98px)`) only ever target `#products_grid`, `.tp-product-item` and
`.s_card_style_9` — the grid cards. The **product page** widget
(`#product_details .product_price + .o-alma-widget`) and the **cart** widget are never covered, so
they keep desktop sizing at 375px.

Measured on `/shop/tablebar-valence-code-table-bar-krys-chene-606` at 375x812, before the fix:

| | x | right |
|---|---|---|
| widget border box | 15 | 360.2 |
| widget content box | 28 | 347.2 |
| `<span>12 x 16,25 €</span>` | 287.6 | **355.7** |

`.o-alma-widget__payment-info` has `overflow: hidden` so nothing spills visibly — the recap text is
just **clipped**. That's the "tiny overflow".

Fix: below 768px the product/cart widget wraps and the recap line takes `flex: 1 0 100%`. Border
radius drops from pill to `--mc-radius` because a pill around a two-line box looks wrong, and
`.is-loading` min-height goes 38px → 58px to match the new two-line height.

Content fits after the change: 319px available at 375px viewport, logo (31.5) + gap (10) +
options (208.3) = 250. `flex-wrap` on `.o-alma-widget__options` is belt-and-braces for ≤320px.

## Fix 2 — amount ignored the qty box

The parent derives its amount from `getDisplayedAmount()`, which reads the **displayed** price. On a
product page that is the unit price, so the widget said `4 x 48,75 €` whether you bought 1 or 10.

**Why not patch the parent.** `alma_widget.js` exports nothing — `renderWidget`, `getSourceNode`,
`getDisplayedAmount` are all module-private. And `createWidget()` reassigns
`widget._almaSourceNode = priceNode` on *every* remount, so overriding that property (the trick the
parent itself uses for `mountCartAlmaWidget`) gets clobbered the moment a variant or qty change
triggers `scheduleMountWidgets`.

**What we do instead.** Feed the parent a number it already knows how to read. `getDisplayedAmount`
walks these selectors in order and takes the first *visible* hit > 0:

```
.oe_price .oe_currency_value, .oe_price [itemprop='price'], .oe_price,
.d-product-price .oe_currency_value, .d-product-price, [itemprop='price']
```

`querySelectorAll` returns document order, so a `span.oe_price > span.oe_currency_value` **prepended
to `.product_price`** wins. We keep `unit × qty` in it.

Consequences that make this the cheap option:

- The parent's `attachDynamicObserver` already watches `.product_price` with
  `{childList, characterData, subtree}`. Writing our node *is* the re-render trigger. No timers, no
  assumptions about who runs first.
- The detail modal reads the same source (`openModal` → `getDisplayedAmount`), so it follows for
  free. Eligibility min/max are checked against the total too, which is what Alma actually wants.
- Survives remounts: `createWidget` resets `_almaSourceNode` to `.product_price`, and our node lives
  *inside* it.

### Traps

- **The node must stay "visible."** `isVisibleNode()` rejects `display:none`, `visibility:hidden`
  and `.d-none`. So `.mc-alma-qty-total` hides with `position:absolute; width:0; height:0;
  overflow:hidden; opacity:0`. Do not "simplify" that to `display:none` — the fix silently dies.
- **It must not sit inside a skip container.** `getDisplayedAmount` ignores anything under
  `del, .tp-compare-price, .text-muted, .tp-old-price`. Prepend to `.product_price` itself.
- **Removed at qty ≤ 1**, so the unaltered unit price is used. The removal is a `childList`
  mutation, which re-renders — that's deliberate, not a leak.
- **No write when the value is unchanged.** That `!==` guard is what stops our own
  MutationObserver (we watch `.product_price` to catch variant switches) from looping.
- **Skipped when `body.editor_enable`.** Otherwise the website editor can serialise our injected
  span into the saved view arch. `contenteditable="false"` + `data-oe-protected="true"` are a second
  belt.

## Fix 3 — the oversized alma_1x card at checkout

**Written blind — never seen rendered.** Reaching `/shop/payment` needs a delivery address, and
filling one was declined. Verify before trusting it.

The reasoning: `consolidateAlmaCheckoutOptions()` collapses every Alma option whose plan count is
1–4 into a single `li`, sorted ascending, and picks `grouped[0]` when nothing is checked — that is
**alma_1x**, whose radio it then force-checks. That one `li` carries, on top of the normal label +
logo row:

- `.o-mconfort-alma-plan-switch` — the injected `1x 2x 3x 4x` button row
- `[name='alma_description']` — the full installment schedule, un-hidden by
  `syncAlmaDescriptionVisibility()` via an inline `style="display:block"`

The schedule panel is the height. `10x` / `12x` are **not** grouped (`buildAlmaGroup` filters
`count <= 4`) and render as one compact row plus a badge.

Fix hides the schedule on the grouped card only, and gives the plan switch explicit compact styling.
`!important` is required — it beats the inline `display:block` the parent's JS writes.

`10x` / `12x` keep their schedule on purpose: those are credit plans and the panel carries the fee
disclosure. Do not widen the selector to all `.o-mconfort-alma-option` without checking that.

If exact height parity is wanted, hide `.o-mconfort-alma-plan-switch` too and move the plan choice
into the label. Marked `ponytail:` in the SCSS.

Note `alma_1x` gets **no** badge — `mconfort_alma_checkout_badges` matches
`installments_count >= 2` (free) or `>= 5` (credit); 1 falls through both.

## Fix 4 — the 10x/12x modal ate the whole mobile viewport

`renderModalSchedule()` emits **one `.o-alma-modal__schedule-row` per installment**, so 12x means 12
rows (~33px each) stacked under the title, the three steps, the `alma` wordmark and the plan pills,
with the total/fees block below. At 375x812 the dialog reached **696px** — 86% of the screen.

From the **6th row on**, the schedule scrolls inside its own box (`max-height: 32vh`,
`overscroll-behavior: contain`) instead of stretching the dialog; rows and the surrounding blocks
also tighten. 2x/3x/4x are untouched.

The row count is exposed nowhere as a class or dataset attribute, so the condition is
`:has(> .o-alma-modal__schedule-row:nth-child(6))`. Without `:has()` support the rule simply never
matches and the old behaviour (whole dialog scrolls) remains — no JS, no row counter.

Measured at 375x812 with 12 rows: dialog **696 → 578px**, schedule 260px for a 378px scroll height,
summary bottom at 780px, dialog itself not scrollable. At 375x667: dialog 532px, total still on
screen. With 4 rows the cap does not apply (`max-height: none`).

**The real 12x rows never rendered.** `/mconfort/alma/widget/schedule` answered
`Donnees indisponibles` and the total stayed `-` — that endpoint calls the Alma API and this box
can't reach it, so the rows above were **injected by hand** in the console to exercise the CSS.
Selectors and geometry are real; a live credit schedule has never been seen.

## Fix 5 — the cart amount stayed on the qty the page loaded with

`mountCartAlmaWidget()` builds a **fake source node** (`span.product_price > .oe_price >
.oe_currency_value`) holding the cart total and hangs it on `widget._almaSourceNode`. It already
knows how to refresh: called a second time it rewrites that value, clears `almaRendered` /
`almaLastAmountKey` and re-renders. **Nothing ever calls it again.** `mountWidgets()` runs from
`scheduleMountWidgets`, which fires on DOMContentLoaded, on `.js_product` change/click (variants),
and from the body observer on an *added* `.product_price` / `.d-product-price` node. A cart line
qty change produces none of those — `/shop/cart/update_json` replaces the rows inside
`.o_cart_total` and stops there.

Measured at 375x812, product at 195,00 €, added at qty 2 then bumped to 4 in the cart:

| | value |
|---|---|
| `.o_cart_total` total | 780,00 € |
| widget recap | `4 x 146,25 €` (= 585, the qty-3 total) |
| `widget._almaSourceNode` | `390` (the qty-2 total it was born with) |

**The poke.** Same spirit as fix 2 — hand the parent a trigger it already listens for. On a total
change we append a bare `span.product_price` to `<body>` and remove it in the same tick:

- the body observer still sees it in `addedNodes` (removal happens before the callback runs);
- `getMountScope(node)` calls `closest()` on a node that is already detached → `null` → `document`;
- `findPriceNodes(document)` cannot pick it up — it only looks under `#products_grid`,
  `.tp-product-item`, `.s_d_products_snippet_wrapper`, `#product_details`,
  `.tp-product-right-panel` — so no stray widget is mounted on the decoy.

Net effect: `mountWidgets(document)` → `mountCartAlmaWidget()` → fresh total. Verified
`document.querySelectorAll('body > .product_price').length === 0` after every poke.

`isShopPage()` would nuke every widget in `mountWidgets`, but it needs `#products_grid` **and** no
`#product_details`; `/shop/cart` has neither, so it returns false.

### Traps

- **There are two `.o_cart_total` blocks** on the cart page (and two `.js_quantity` inputs). The
  element itself survives a qty update — only its rows are replaced — so observing the first with
  `{childList, characterData, subtree}` is enough.
- **`querySelector("a, b")` returns the first match in *document order*, not the first selector's
  match.** The first `.oe_currency_value` under `.o_cart_total` is the delivery/tax row, which
  reads `0,00`. `readCartAmount` therefore does two `querySelector` calls with `||`, exactly like
  the parent. The first version of this fix used one combined selector, read `0`, and **silently
  never fired** — the `amount > 0` guard swallowed it.
- **No loop.** The widget is inserted *after* `.o_cart_total`, never inside it, and the
  `amount !== lastAmount` guard makes a stray notification a no-op.

The detail modal follows for free — it reads the same `_almaSourceNode`.

## Fix 5b — the cart card was half-centred on mobile

The parent gives `.o-alma-cart-widget` `justify-content: center`. Fine while the card is one line;
once fix 1 wraps it at ≤767.98px the logo and the plan pills stay centred while the recap line,
being `flex: 1 0 100%`, sits flush left. Measured at 375x812: logo `x=81`, recap `x=28`.

`justify-content: flex-start` in the same media query, so the card reads like the product-page one.
Desktop keeps the centred pill — verified unchanged at 1280x800 (`center` / `nowrap`, 34px tall).

## Rejected — product-page card redesign (2026-08-17, 16:0x)

A full restyle of the product-page card (white card, `1px #e6e6e6`, wordmark **Alma** via
`text-transform: capitalize`, options as plain bold text instead of pills, active = underline) was
built, measured, then **scrapped at the user's request**. Fix 1's wrap-the-recap patch is what
ships. Do not re-propose it unless asked.

## Verification status (2026-08-17, 17:2x)

| Fix | Status |
|---|---|
| 1 | Overflow **measured** before the fix; after the fix, measured in the *redesigned* card only — the reverted version's result is **not** re-measured. |
| 2 | Logic **not** exercised in a browser. |
| 3 | **Blind.** No rendered checkout was ever inspected. |
| 4 | Geometry **measured** at 375x812 and 375x667 — but on **injected** rows, not a live Alma credit schedule. |

### 2026-08-18

| Fix | Status |
|---|---|
| 2 | Now **measured** on the product page: 195,00 € at qty 2 gives `.mc-alma-qty-total` = `390.00` and the recap `12 x 32,50 €`. |
| 5 | **Measured** on `/shop/cart` at 375x812 and 1280x800: qty 4→5→6 moved the total 780 → 975 → 1 170 and the recap followed (`4 x 195,00` → `4 x 243,75` → `4 x 292,50`); the minus button back to 5 followed too. No stray `body > .product_price`. The modal read `Total 975,00 €`. |
| 5b | **Measured** at 375x812 (logo and recap both at `x=28`) and 1280x800 (unchanged). |

Also observed on 2026-08-18: `/mconfort/alma/widget/schedule` **did** answer — the 2x modal
rendered a real two-line schedule with `Total 975,00 €` / `Dont frais 0,00 €`. The "endpoint
unreachable from this box" note under fix 4 is no longer true for the non-credit plans at least.

`mconfort` was restored and the module upgraded clean at 16:04:29 (`Registry loaded in 15.169s`,
no traceback), and again at 17:25:49 for fix 4. Both bundles build:
`web.assets_frontend.min.css` 200 (`5218789`, then `597a61d` after the redesign revert) and
`web.assets_frontend_lazy.min.js` 200, 3.63 MB, containing both the parent widget and
`mc-alma-qty-total`. The earlier "JS bundle has never built" note was the dropped-db 500, not a
code error.

Fetch bundles **from the browser**, not curl — curl has no session so the db is unknown and the
hashed asset URL 404s.

**`mconfort` was dropped at 11:21:29** by a `POST /web/database/drop` from the database manager,
taking the module's `ir_module_module` row with it. Files on disk are untouched. Reinstall after
restoring. `odoo.log` shows the same drop five times on 2026-08-17 (08:32, 09:34, 09:38, 09:42,
11:21) — if a module here looks uninstalled, check that first.

## Commands

Install / upgrade:

```bash
"C:/Program Files/Odoo 19.0.20260724/python/python.exe" "C:/Program Files/Odoo 19.0.20260724/server/odoo-bin" -c "C:/Program Files/Odoo 19.0.20260724/server/odoo.conf" -d mconfort -u mconfort_alma_fixes --no-http --stop-after-init
```

The running service picks the change up through ORM registry signaling; no `Restart-Service`
needed (it would need an elevated shell anyway).

Check it landed:

```bash
psql -U odoo -h localhost -d mconfort -tAc "select name, state, latest_version from ir_module_module where name='mconfort_alma_fixes';"
```

`odoo.conf` has no `db_name` and no `dbfilter`, so a browser hits the db selector first. Pick the
database once via `/odoo?db=mconfort`, then normal URLs work for that session.

### Checking fix 1 and 2 by hand

Product page, viewport 375x812:

```js
const w = document.querySelector('#product_details .js-alma-widget');
const info = w.querySelector('.o-alma-widget__payment-info');
// fix 1: nothing may extend past the widget's content box
[...info.children].map(n => n.getBoundingClientRect().right).concat(w.getBoundingClientRect().right)

// fix 2: set qty, then read the recap line
const q = document.querySelector("input[name='add_qty']");
q.value = '3'; q.dispatchEvent(new Event('change', {bubbles: true}));
setTimeout(() => console.log(document.querySelector('.mc-alma-qty-total')?.textContent, info.textContent), 300);
```

At 195,00 € × 3 the recap must read `12 x 48,75 €`, and `.mc-alma-qty-total` must hold `585.00`.

### Checking fix 4 by hand

Open the modal on any plan, then fake a long schedule — the Alma endpoint is unreachable from this
box, so 12x renders `Donnees indisponibles` on its own. Viewport 375x812:

```js
document.querySelector('.js-alma-widget .o-alma-widget__option:not(.is-disabled)').click();
const s = document.querySelector('.o-alma-modal__schedule');
const d = document.querySelector('.o-alma-modal__dialog');
s.innerHTML = Array.from({length: 12}, (_, i) =>
    `<div class="o-alma-modal__schedule-row"><span>ligne ${i + 1}</span><span>14,63 €</span></div>`).join('');
[getComputedStyle(s).maxHeight, s.scrollHeight, Math.round(d.getBoundingClientRect().height)]
```

Expect roughly `["259.84px", 378, 578]` — cap at 32vh, list overflowing it, dialog well under the
812px viewport. Drop to 4 rows and `max-height` must read `none`.
