/** @odoo-module **/

/*
 * The Alma widget of `mconfort_alma_widgets` reads the *displayed* price, which
 * on a product page is the unit price. The installment amount therefore stayed
 * on "1 unit" whatever the qty box said.
 *
 * Rather than fork the parent widget (its functions are module-private and it
 * rebuilds `_almaSourceNode` on every remount), we feed it the number it
 * already knows how to read: a hidden `.oe_price > .oe_currency_value` holding
 * `unit x qty`, inserted as the FIRST candidate inside `.product_price`.
 *
 * The parent picks the first visible candidate in document order, and its
 * MutationObserver on `.product_price` re-renders the widget - and therefore
 * the detail modal, which reads the same source - on every change. No timers,
 * no ordering assumptions.
 */

const PRICE_SELECTOR = "#product_details .product_price, .tp-product-right-panel .product_price";
const QTY_SELECTOR = "input[name='add_qty']";
const TOTAL_CLASS = "mc-alma-qty-total";
const SKIP_SELECTOR = `del, .tp-compare-price, .text-muted, .tp-old-price, .${TOTAL_CLASS}`;

function parseAmount(rawText) {
    const cleaned = String(rawText || "").replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
    if (!cleaned) {
        return 0;
    }

    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");
    let normalized = cleaned;

    if (hasComma && hasDot) {
        normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
            ? cleaned.replace(/\./g, "").replace(",", ".")
            : cleaned.replace(/,/g, "");
    } else if (hasComma) {
        normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
        const parts = cleaned.split(".");
        if (parts.length > 2) {
            normalized = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
        }
    }

    const amount = Number.parseFloat(normalized);
    return Number.isFinite(amount) ? amount : 0;
}

function isVisibleNode(node) {
    if (!(node instanceof HTMLElement) || node.classList.contains("d-none")) {
        return false;
    }
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
}

// Same candidate order as the parent widget, minus our own injected node.
function getUnitAmount(priceNode) {
    const candidates = [
        ".oe_price .oe_currency_value",
        ".oe_price [itemprop='price']",
        ".oe_price",
        ".d-product-price .oe_currency_value",
        ".d-product-price",
        "[itemprop='price']",
    ].flatMap((selector) => Array.from(priceNode.querySelectorAll(selector)));

    for (const node of candidates) {
        if (node.closest(SKIP_SELECTOR) || !isVisibleNode(node)) {
            continue;
        }
        const amount = parseAmount(node.getAttribute("content") || node.textContent);
        if (amount > 0) {
            return amount;
        }
    }
    return 0;
}

function getQty(priceNode) {
    const scope = priceNode.closest("#product_details, .tp-product-right-panel, .js_product");
    const input = (scope && scope.querySelector(QTY_SELECTOR)) || document.querySelector(QTY_SELECTOR);
    const qty = input ? Number.parseFloat(String(input.value).replace(",", ".")) : 1;
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function syncPriceNode(priceNode) {
    // ponytail: never touch the DOM the website editor might serialise back into the view.
    if (document.body.classList.contains("editor_enable")) {
        return;
    }

    let node = priceNode.querySelector(`:scope > .${TOTAL_CLASS}`);
    const unit = getUnitAmount(priceNode);
    const qty = getQty(priceNode);

    if (!(unit > 0) || qty <= 1) {
        if (node) {
            node.remove(); // childList mutation -> parent re-renders on the unit price
        }
        return;
    }

    if (!node) {
        node = document.createElement("span");
        node.className = `oe_price ${TOTAL_CLASS}`;
        node.setAttribute("aria-hidden", "true");
        node.setAttribute("contenteditable", "false");
        node.setAttribute("data-oe-protected", "true");
        node.innerHTML = '<span class="oe_currency_value"></span>';
        priceNode.prepend(node);
    }

    const value = (unit * qty).toFixed(2);
    const valueNode = node.firstElementChild;
    if (valueNode.textContent !== value) {
        valueNode.textContent = value;
    }
}

function syncAll() {
    document.querySelectorAll(PRICE_SELECTOR).forEach(syncPriceNode);
}

function watchPriceNodes() {
    // Variant switches rewrite the unit price; re-derive the total from it.
    // Our own writes are idempotent (the `!==` guard above), so this cannot loop.
    const observer = new MutationObserver(() => syncAll());
    document.querySelectorAll(PRICE_SELECTOR).forEach((priceNode) => {
        observer.observe(priceNode, { childList: true, characterData: true, subtree: true });
    });
}

/*
 * Cart page. The parent mounts its cart widget from `.o_cart_total` and knows
 * how to refresh it (`mountCartAlmaWidget` rewrites its fake source node when
 * the total moved) - but nothing calls `mountWidgets` again when a cart line
 * qty changes, so the widget keeps the amount it was born with.
 *
 * The parent's body observer runs `scheduleMountWidgets` for any *added* node
 * matching `.product_price`. So we add one and remove it in the same tick: the
 * observer still sees it in `addedNodes`, `getMountScope` falls back to
 * `document` (the node is already detached), and `findPriceNodes` cannot pick
 * it up - it only looks under `#product_details` / product grids. One throwaway
 * node, no access to the parent's module-private functions.
 */

const CART_TOTAL_SELECTOR = ".o_cart_total";

// Same two-step lookup as the parent, and for the same reason: a single
// comma-separated selector returns the first node in *document order*, which
// in this block is the delivery/tax row, not the order total.
function readCartAmount(totalNode) {
    const node = totalNode.querySelector("tr[name='o_order_total'] .oe_currency_value")
        || totalNode.querySelector(".oe_currency_value");
    return node ? parseAmount(node.textContent) : 0;
}

function pokeParentMount() {
    const decoy = document.createElement("span");
    decoy.className = "product_price";
    document.body.appendChild(decoy);
    decoy.remove();
}

function watchCartTotal() {
    // `.o_cart_total` itself survives a qty update; only its rows are replaced.
    const totalNode = document.querySelector(CART_TOTAL_SELECTOR);
    if (!totalNode) {
        return;
    }
    let lastAmount = readCartAmount(totalNode);

    // Re-rendering the widget mutates the DOM *after* `.o_cart_total`, never
    // inside it, and the amount guard makes a stray notification a no-op.
    const observer = new MutationObserver(() => {
        const amount = readCartAmount(totalNode);
        if (amount > 0 && amount !== lastAmount) {
            lastAmount = amount;
            pokeParentMount();
        }
    });
    observer.observe(totalNode, { childList: true, characterData: true, subtree: true });
}

function start() {
    watchCartTotal();

    if (!document.querySelector(PRICE_SELECTOR)) {
        return;
    }
    syncAll();
    watchPriceNodes();

    // Odoo's +/- buttons write the input then fire `change`; typing fires `input`.
    ["change", "input"].forEach((type) => {
        document.addEventListener(type, (ev) => {
            const target = ev.target;
            if (target instanceof HTMLElement && target.closest(QTY_SELECTOR)) {
                syncAll();
            }
        }, true);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
    start();
}
