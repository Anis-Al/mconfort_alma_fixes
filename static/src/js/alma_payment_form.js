/** @odoo-module **/

import { PaymentForm } from "@payment/interactions/payment_form";
import { patch } from "@web/core/utils/patch";

patch(PaymentForm.prototype, {
    async willStart() {
        await super.willStart(...arguments);

        const checkedRadio = document.querySelector('input[name="o_payment_radio"]:checked');
        if (checkedRadio && this._getProviderCode(checkedRadio) === "alma") {
            const container = checkedRadio.closest('[name="o_payment_option"]');
            const desc = container?.querySelector('[name="alma_description"]');
            if (desc) {
                desc.style.display = "block";
            }
        }
    },


    async selectPaymentOption(ev) {
        await super.selectPaymentOption(...arguments);

        document.querySelectorAll('[name="alma_description"]').forEach((el) => {
            el.style.display = "none";
        });

        const checkedRadio = ev.target;
        if (this._getProviderCode(checkedRadio) === "alma") {
            const container = checkedRadio.closest('[name="o_payment_option"]');
            const desc = container?.querySelector('[name="alma_description"]');
            if (desc) {
                desc.style.display = "block";
            }
        }
    },
});
