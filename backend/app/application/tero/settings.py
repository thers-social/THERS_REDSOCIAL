# Ajustes de Tero que el caso de uso necesita, ya leídos de la configuración. application/ no
# importa Flask: la route arma esto desde `current_app.config`.


class TeroSettings:
    __slots__ = ("ai_enabled", "monthly_budget_micro", "price_in_micro", "price_out_micro")

    def __init__(self, ai_enabled, monthly_budget_micro, price_in_micro, price_out_micro):
        self.ai_enabled = ai_enabled
        self.monthly_budget_micro = monthly_budget_micro
        self.price_in_micro = price_in_micro
        self.price_out_micro = price_out_micro
