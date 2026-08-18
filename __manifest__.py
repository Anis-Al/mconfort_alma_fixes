{
    "name": "mconfort Alma Widgets - Fixes",
    "summary": "Overflow mobile fiche produit et panier, montant Alma suivant la quantite (fiche et panier), cartes checkout uniformes",
    "category": "Website/eCommerce",
    "author": "Anis Alim",
    "license": "LGPL-3",
    "version": "19.0.1.0.0",
    "depends": [
        "mconfort_alma_widgets",
    ],
    "data": [
        "views/checkout_1x_badge.xml",
        "views/checkout_1x_logo.xml",
        "views/checkout_credit_badge.xml",
    ],
    "assets": {
        "web.assets_frontend": [
            "mconfort_alma_fixes/static/src/scss/alma_fixes.scss",
            "mconfort_alma_fixes/static/src/js/alma_qty.js",
        ],
    },
    "installable": True,
    "application": False,
}
