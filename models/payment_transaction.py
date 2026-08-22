import logging

from werkzeug import urls

from alma_client import Client
from odoo import _, api, models
from odoo.addons.payment import utils as payment_utils
from odoo.addons.dt_payment_alma.controllers.main import AlmaController
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

class PaymentTransaction(models.Model):
    _inherit = 'payment.transaction'

    def _alma_safe_get_language_code(self, user_lang):
        if not user_lang or not isinstance(user_lang, str):
            return 'fr'
        available_languages = ['fr', 'en', 'it', 'es', 'de', 'nl', 'nl_BE']
        simplified_lang = user_lang.split('_')[0]
        if user_lang == 'nl_BE':
            return 'nl_BE'
        if simplified_lang in available_languages:
            return simplified_lang
        return 'fr'

    def _alma_safe_format_address(self, partner, fallback_country='FR'):
        if not partner:
            return None
        first_name, last_name = payment_utils.split_partner_name(partner.name or "")
        country_code = partner.country_id.code if partner.country_id else fallback_country
        company = getattr(partner, 'commercial_company_name', None) or getattr(partner, 'company_name', None) or None
        phone = partner.phone or getattr(partner, 'mobile', None) or None
        addr = {
            'city': partner.city or None,
            'company': company,
            'country': country_code,
            'email': partner.email or None,
            'first_name': first_name or None,
            'last_name': last_name or None,
            'line1': partner.street or None,
            'line2': partner.street2 or None,
            'phone': phone,
            'postal_code': partner.zip or None,
        }
        if any(v for k, v in addr.items() if k not in ('country', 'company')):
            return addr
        return None

    def _get_specific_rendering_values(self, processing_values):
        if self.provider_code != 'alma':
            return super()._get_specific_rendering_values(processing_values)

        api_key = self.provider_id._alma_get_api_key()
        alma_client = Client.with_api_key(api_key)
        installments_count = self.payment_method_id.installments_count if self.payment_method_id else 3

        base_url = self.provider_id.get_base_url()
        return_url = urls.url_join(base_url, AlmaController._return_url)
        ipn_url = urls.url_join(base_url, AlmaController._ipn_url)
        cancel_url = urls.url_join(base_url, '/shop/payment')

        order = self.sale_order_ids[:1] if 'sale_order_ids' in self._fields and self.sale_order_ids else self.env['sale.order']
        inv_partner = order.partner_invoice_id if order else self.env['res.partner']
        ship_partner = order.partner_shipping_id if order else self.env['res.partner']

        partner_name = self.partner_name or inv_partner.name or self.partner_id.name or ""
        first_name, last_name = payment_utils.split_partner_name(partner_name)

        partner_email = self.partner_email or inv_partner.email or self.partner_id.email or None
        partner_phone = self.partner_phone or inv_partner.phone or getattr(inv_partner, 'mobile', None) or self.partner_id.phone or getattr(self.partner_id, 'mobile', None) or None

        lang = self.env.context.get('lang') or self.partner_id.lang or self.env.lang or 'fr_FR'
        locale = self._alma_safe_get_language_code(lang)

        billing_address = self._alma_safe_format_address(inv_partner or self.partner_id)
        shipping_address = self._alma_safe_format_address(ship_partner or self.partner_id)

        addresses = []
        if billing_address:
            addresses.append(billing_address)
        if shipping_address and shipping_address != billing_address:
            addresses.append(shipping_address)

        payment_payload = {
            "purchase_amount": self.get_amount(processing_values['amount']),
            "installments_count": installments_count,
            "return_url": return_url,
            "ipn_callback_url": ipn_url,
            "customer_cancel_url": cancel_url,
            "locale": locale,
        }
        if billing_address:
            payment_payload["billing_address"] = billing_address
        if shipping_address:
            payment_payload["shipping_address"] = shipping_address

        customer_payload = {
            "email": partner_email,
            "first_name": first_name or None,
            "last_name": last_name or None,
            "phone": partner_phone,
        }
        if addresses:
            customer_payload["addresses"] = addresses

        payment_data = {
            "payment": payment_payload,
            "customer": customer_payload,
            "orders": [{
                "merchant_reference": processing_values['reference'],
            }],
        }

        try:
            eligibility = alma_client.payments.eligibility(payment_data)
        except Exception as e:
            _logger.exception("Alma eligibility check failed for transaction %s", self.reference)
            raise ValidationError(_("Unable to verify Alma eligibility: %s") % str(e))

        if not eligibility.eligible:
            reasons_dict = getattr(eligibility, 'reasons', {}) or {}
            reasons_msg = ", ".join(f"{k}: {v}" for k, v in reasons_dict.items()) if reasons_dict else _("Payment plan not available for this purchase.")
            _logger.warning("Alma payment not eligible for transaction %s: %s", self.reference, reasons_msg)
            raise ValidationError(_("This payment cannot be processed with Alma: %s") % reasons_msg)

        try:
            payment = alma_client.payments.create(payment_data)
        except Exception as e:
            _logger.exception("Alma payment creation failed for transaction %s", self.reference)
            raise ValidationError(_("Failed to initiate Alma payment: %s") % str(e))

        if not payment or not getattr(payment, 'url', None):
            _logger.error("Alma did not return a payment URL for transaction %s", self.reference)
            raise ValidationError(_("Alma did not return a valid payment URL."))

        processing_values.update({
            'api_url': payment.url,
        })

        return processing_values
