# Herramientas de lectura de Tero (ADR-041 §6.1). Solo tipos nativos de Python: domain/ no importa
# Flask ni SQLAlchemy.
#
# Reglas que este módulo hace cumplir (fase 6: hay además herramientas que solo PROPONEN):
#   · Cada herramienta declara un esquema estricto (sin propiedades extra, todo tipado). La
#     validación se repite SIEMPRE en el servidor: el esquema que ve el modelo es una guía, no una
#     garantía (el modelo puede equivocarse, y un texto malicioso puede empujarlo a hacerlo).
#   · Ninguna herramienta ejecuta un cambio. Las de lectura consultan; las `propose_*` solo crean una
#     acción pendiente que exige confirmación humana aparte. Se prueba que no cambian datos.
#   · Los nombres usan guion bajo (`profile_read`): la API del proveedor no admite puntos.

import re

#: Vueltas modelo → herramientas → modelo permitidas por mensaje, y llamadas por vuelta.
MAX_TOOL_ROUNDS = 3
MAX_TOOL_CALLS_PER_ROUND = 4

#: `read` consulta datos. `propose` NO ejecuta nada: guarda una acción pendiente y devuelve una
#: tarjeta; solo la persona, con una llamada aparte, la confirma (ADR-041 §6.2).
RISK_READ = "read"
RISK_PROPOSE = "propose"

_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class ToolInputError(Exception):
    """Los argumentos no cumplen el esquema. El mensaje se devuelve al modelo (para que corrija),
    así que nunca debe incluir datos de nadie."""


class ToolSpec:
    __slots__ = ("name", "description", "properties", "required", "risk")

    def __init__(self, name, description, properties=None, required=(), risk=RISK_READ):
        self.name = name
        self.description = description
        self.properties = properties or {}
        self.required = tuple(required)
        self.risk = risk

    def input_schema(self):
        return {
            "type": "object",
            "properties": self.properties,
            "required": list(self.required),
            "additionalProperties": False,
        }

    def to_definition(self):
        """Lo que se envía al proveedor."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema(),
        }


def string_prop(description, min_length=1, max_length=100):
    return {
        "type": "string", "description": description,
        "minLength": min_length, "maxLength": max_length,
    }


def uuid_prop(description):
    return {"type": "string", "description": description, "format": "uuid"}


def integer_prop(description, minimum, maximum):
    return {"type": "integer", "description": description, "minimum": minimum, "maximum": maximum}


def validate_arguments(spec, arguments):
    """Devuelve los argumentos limpios o lanza `ToolInputError`. Estricto: una propiedad que el
    esquema no declara se rechaza en vez de ignorarse."""
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        raise ToolInputError("Los argumentos deben ser un objeto")
    unknown = set(arguments) - set(spec.properties)
    if unknown:
        raise ToolInputError("Argumentos no permitidos: " + ", ".join(sorted(unknown)))
    for name in spec.required:
        if name not in arguments:
            raise ToolInputError(f"Falta el argumento {name}")

    clean = {}
    for name, value in arguments.items():
        clean[name] = _validate_value(name, spec.properties[name], value)
    return clean


def _validate_value(name, schema, value):
    kind = schema["type"]
    if kind == "string":
        if not isinstance(value, str):
            raise ToolInputError(f"{name} debe ser texto")
        text = " ".join(value.split())
        if _CONTROL.search(value):
            raise ToolInputError(f"{name} tiene caracteres no permitidos")
        if len(text) < schema.get("minLength", 0):
            raise ToolInputError(f"{name} es demasiado corto")
        if len(text) > schema.get("maxLength", 1000):
            raise ToolInputError(f"{name} es demasiado largo")
        if schema.get("format") == "uuid" and not _UUID.match(text):
            raise ToolInputError(f"{name} no es un identificador válido")
        return text
    if kind == "integer":
        # `bool` es subclase de `int` en Python: `True` no es un número aquí.
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolInputError(f"{name} debe ser un número entero")
        if value < schema["minimum"] or value > schema["maximum"]:
            raise ToolInputError(f"{name} está fuera de rango")
        return value
    raise ToolInputError(f"Tipo no soportado en {name}")
