/** @odoo-module **/

const PRICE_SELECTOR = "#product_details .product_price, .tp-product-right-panel .product_price";
const QTY_SELECTOR = "input[name='add_qty']";
const TOTAL_CLASS = "mc-alma-qty-total";
const SKIP_SELECTOR = `del, .tp-compare-price, .text-muted, .tp-old-price, .${TOTAL_CLASS}`;
const CART_TOTAL_SELECTOR = ".o_cart_total";
const ALMA_GROUP_SELECTOR = "li[name='o_payment_option'].o-mconfort-alma-option.o-mconfort-alma-group-current";

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
    if (document.body.classList.contains("editor_enable")) {
        return;
    }

    let node = priceNode.querySelector(`:scope > .${TOTAL_CLASS}`);
    const unit = getUnitAmount(priceNode);
    const qty = getQty(priceNode);

    if (!(unit > 0) || qty <= 1) {
        if (node) {
            node.remove();
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
    const observer = new MutationObserver(() => syncAll());
    document.querySelectorAll(PRICE_SELECTOR).forEach((priceNode) => {
        observer.observe(priceNode, { childList: true, characterData: true, subtree: true });
    });
}

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
    const totalNode = document.querySelector(CART_TOTAL_SELECTOR);
    if (!totalNode) {
        return;
    }
    let lastAmount = readCartAmount(totalNode);

    const observer = new MutationObserver(() => {
        const amount = readCartAmount(totalNode);
        if (amount > 0 && amount !== lastAmount) {
            lastAmount = amount;
            pokeParentMount();
        }
    });
    observer.observe(totalNode, { childList: true, characterData: true, subtree: true });
}

function syncAlmaGroupLabel() {
    document.querySelectorAll(ALMA_GROUP_SELECTOR).forEach((option) => {
        const label = option.querySelector(".o_payment_option_label");
        const count = Number(option.dataset.mconfortAlmaPlanCount || 0);
        if (!label || !count) {
            return;
        }
        const text = count === 1
            ? "Paiement en 1 fois avec Alma"
            : "Paiement en plusieurs fois avec Alma";
        if (label.textContent !== text) {
            label.textContent = text;
        }
    });
}

function watchAlmaGroupLabel() {
    const forms = document.querySelectorAll(".o_payment_form");
    if (!forms.length) {
        return;
    }
    const observer = new MutationObserver(() => syncAlmaGroupLabel());
    forms.forEach((form) => observer.observe(form, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
    }));
    syncAlmaGroupLabel();
}

function start() {
    watchCartTotal();
    watchAlmaGroupLabel();

    if (!document.querySelector(PRICE_SELECTOR)) {
        return;
    }
    syncAll();
    watchPriceNodes();

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
