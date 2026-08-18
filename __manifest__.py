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
    "assets": {
        "web.assets_frontend": [
            "mconfort_alma_fixes/static/src/scss/alma_fixes.scss",
            "mconfort_alma_fixes/static/src/js/alma_qty.js",
        ],
    },
    "installable": True,
    "application": False,
}
