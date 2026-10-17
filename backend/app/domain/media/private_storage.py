# Puerto de almacenamiento PRIVADO de documentos (ADR-040 fase 6: documentos de reclamo).
#
# A diferencia de `MediaStorage` (bucket público, URLs permanentes), aquí nada es público:
# lo único que sale del servidor es una URL FIRMADA de vida corta, que solo se genera para
# quien tiene permiso (moderación). La clave del objeto nunca se entrega tal cual.


class PrivateDocumentStorage:
    def save(self, key, data, content_type):
        """Guarda `data` (bytes) bajo `key`. Sobrescribe si existe."""
        raise NotImplementedError

    def delete(self, key):
        """Elimina `key`. No falla si no existe."""
        raise NotImplementedError

    def signed_url(self, key, content_type, ttl_seconds):
        """URL temporal de descarga de `key`, válida `ttl_seconds`."""
        raise NotImplementedError
