# Caché en memoria de rutas (ADR-040 fase 13): la misma consulta (lugar, origen REDONDEADO y
# perfil) durante una hora no vuelve a llamar al proveedor. La clave ya lleva el origen
# redondeado, así que guardarla no conserva la ubicación exacta de nadie. Es por proceso: con
# varios procesos cada uno tiene la suya (solo se gasta algo más de cupo, nunca da un dato
# equivocado).

import threading
import time
from collections import OrderedDict

from app.domain.routing import routing


class RouteCache:
    def __init__(self, ttl=routing.CACHE_TTL_SECONDS, max_entries=routing.CACHE_MAX_ENTRIES, clock=time.monotonic):
        self._ttl = ttl
        self._max = max_entries
        self._clock = clock
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return None
            stored_at, value = entry
            if self._clock() - stored_at > self._ttl:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return value

    def set(self, key, value):
        with self._lock:
            self._items[key] = (self._clock(), value)
            self._items.move_to_end(key)
            while len(self._items) > self._max:
                self._items.popitem(last=False)

    def clear(self):
        with self._lock:
            self._items.clear()
