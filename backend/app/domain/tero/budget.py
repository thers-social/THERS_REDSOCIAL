# Costo y tope de gasto de Tero (ADR-041 §8.2). Enteros en micro-USD (1 USD = 1_000_000) para
# que sumar miles de mensajes no acumule error de coma flotante.

MICRO = 1_000_000


def usd_to_micro(usd):
    return int(round(float(usd) * MICRO))


def cost_micro_usd(input_tokens, output_tokens, price_in_micro_per_mtok, price_out_micro_per_mtok):
    """Redondeo hacia arriba: mejor sobrestimar el gasto que quedarse corto del tope."""
    total = input_tokens * price_in_micro_per_mtok + output_tokens * price_out_micro_per_mtok
    return -(-total // MICRO)


def period_for(moment):
    """Mes calendario UTC `YYYY-MM` de un `datetime`."""
    return moment.strftime("%Y-%m")
