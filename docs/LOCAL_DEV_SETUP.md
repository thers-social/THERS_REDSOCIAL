# Guía de arranque local — THERS

**Estado:** guía operativa, **descriptiva**. Documenta cómo se levanta hoy el entorno
de desarrollo, verificado sobre el código real del repositorio (rama
`feature/frontend-feed-posts-integration`, 2026-09-02). No decide arquitectura ni
ratifica ninguna decisión: DevOps sigue siendo territorio sin documentación oficial
(`CLAUDE.md` §5/§9, `HB-001` §0). Si un paso de acá contradice un documento de
`docs/architecture/`, gana el documento de arquitectura y hay que corregir esta guía.

**Alcance:** levantar base de datos + backend + frontend en una máquina local para
probar. No cubre deploy, CI ni entornos compartidos.

Los comandos están escritos para **PowerShell en Windows** (entorno del equipo). Los
equivalentes en bash/macOS/Linux se indican donde cambian.

---

## 1. Requisitos previos

| Herramienta | Versión verificada en local | Cómo comprobarla |
|---|---|---|
| Docker Desktop | 29.6.2 | `docker --version` |
| Python | 3.14.3 | `python --version` |
| Node.js | 24.14.0 | `node --version` |
| npm | 11.12.0 | `npm --version` |

Ninguna de estas versiones es un mínimo oficialmente ratificado por el equipo — son
las observadas funcionando. CI usa Python 3.14 y Node 24 (`.github/workflows/ci.yml`).

---

## 2. Instalación (una sola vez por máquina)

### 2.1 Variables de entorno

Tres archivos `.env`, ninguno se sube al repositorio (`HB-001` §20).

```powershell
# Raíz — puerto del host para PostgreSQL
Copy-Item .env.example .env

# Backend — secreto JWT y cadena de conexión
Copy-Item backend\.env.example backend\.env

# Frontend — URL de la API (opcional: sin él, api.js usa 127.0.0.1:5000/api y avisa)
Copy-Item Frontend\.env.example Frontend\.env
```

Después de copiar, editar **`backend/.env`**:

```env
JWT_SECRET_KEY=<cualquier cadena larga aleatoria para local>
ALLOW_INSECURE_JWT_DEV_FALLBACK=1
DATABASE_URL=postgresql+psycopg://thers:changeme@localhost:5433/thers_dev
```

Puntos que no son opcionales:

- El puerto de `DATABASE_URL` **tiene que ser el mismo** que `POSTGRES_PORT` de la
  raíz (`5433` en este equipo, porque el 5432 del host ya está ocupado).
- El driver va explícito: `postgresql+psycopg://`, no `postgresql://`
  (`backend/requirements.txt` instala `psycopg` v3, no `psycopg2`). `config.py`
  reescribe la forma corta igual, pero es más claro escribirla completa.
- `thers` / `changeme` no son credenciales secretas: son las del contenedor de
  desarrollo, definidas en claro en `docker-compose.yml`. **Nunca** se reutilizan
  fuera de local.

### 2.2 Base de datos (Docker)

```powershell
docker compose up -d
docker compose ps          # esperar STATUS = healthy
```

Esto levanta `thers_postgres_dev` (PostgreSQL 16 con **PostGIS 3.5**, imagen
`postgis/postgis:16-3.5-alpine`; `ADR-040`) y crea, la primera vez que
el volumen está vacío, **dos** bases: `thers_dev` (desarrollo) y `thers_test`
(tests, vía `docker/postgres-init/01-create-test-db.sql`).

> **Si ya tenías el contenedor de antes** (`postgres:16-alpine`): al hacer `git pull` y `docker compose up -d`
> Docker descarga la imagen nueva y recrea el contenedor. **Tus datos se conservan** (viven en el volumen
> `thers_redsocial_thers_postgres_data`; la imagen nueva tiene la misma base alpine y la misma versión mayor 16).
> Sin la imagen nueva la migración de Places falla en `CREATE EXTENSION postgis`. Antes de actualizar puedes hacer un
> respaldo: `docker exec thers_postgres_dev pg_dump -U thers -d thers_dev -Fc > respaldo.dump`.
> Después aplica las migraciones en **ambas** bases (`thers_dev` y `thers_test`).

### 2.3 Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1          # bash: source venv/Scripts/activate
pip install -r requirements-dev.txt  # incluye requirements.txt + pytest
pip install python-dotenv            # ver §8, deuda conocida
```

Usar **`venv/`**, no `.venv/` — es el nombre que cubre `backend/.gitignore` y el que
documenta `CLAUDE.md` §11. (En esta máquina existen las dos carpetas y están
desincronizadas: ver §8.)

Aplicar las migraciones a **las dos** bases:

```powershell
$env:FLASK_APP = "run.py"

# thers_dev (toma DATABASE_URL de backend/.env)
python -m flask db upgrade

# thers_test — hay que apuntar DATABASE_URL a mano, la de .env apunta a dev
$env:DATABASE_URL = "postgresql+psycopg://thers:changeme@localhost:5433/thers_test"
python -m flask db upgrade
Remove-Item Env:\DATABASE_URL        # limpiar para no arrastrarla a la sesión
```

Olvidar la segunda es el error más común: los tests fallan con tablas inexistentes
aunque la app funcione perfecto.

### 2.4 Frontend

```powershell
cd Frontend
npm ci
```

---

## 3. Arranque diario

### 3.1 Camino rápido: scripts

`scripts/` automatiza exactamente los pasos manuales de §3.2 — no hace nada distinto
ni instala nada por su cuenta. Desde la raíz del repositorio:

```powershell
.\scripts\dev-up.ps1        # base de datos + migraciones + backend + frontend
.\scripts\dev-test.ps1      # pytest (agregar -Frontend para lint + build)
.\scripts\dev-down.ps1      # detiene la base de datos
```

`dev-up.ps1` verifica los requisitos, levanta PostgreSQL y espera a que esté
`healthy`, aplica las migraciones a **las dos** bases y abre una ventana para el
backend y otra para el frontend. Las ventanas heredan las variables de
`backend/.env` cargadas por el script, así que el backend arranca aunque
`python-dotenv` no esté instalado (§8, punto 1).

Opciones útiles:

| Comando | Qué hace |
|---|---|
| `.\scripts\dev-up.ps1 -NoServers` | Solo base de datos y migraciones, sin abrir ventanas |
| `.\scripts\dev-up.ps1 -SkipMigrations` | Salta las migraciones |
| `.\scripts\dev-up.ps1 -BackendOnly` | Abre solo la ventana del backend |
| `.\scripts\dev-test.ps1 -Frontend` | pytest + eslint + vite build |
| `.\scripts\dev-test.ps1 -PytestArgs "-k","posts"` | Pasa argumentos a pytest |
| `.\scripts\dev-down.ps1 -Purge` | **Destructivo**: borra el volumen de datos (pide confirmación escrita) |

Los scripts derivan la conexión a `thers_test` de la `DATABASE_URL` de
`backend/.env` en vez de asumir un puerto, así que resuelven solos los dos errores
más comunes de §7 (puerto 5432 vs 5433 y `thers_test` sin migrar).

Detalle de cada parámetro: `Get-Help .\scripts\dev-up.ps1 -Full`.

### 3.2 A mano: tres terminales

Ninguna depende del orden salvo que el backend necesita la base arriba.

**Terminal 1 — base de datos** (una vez; el contenedor tiene `restart: unless-stopped`,
así que normalmente ya está arriba):

```powershell
docker compose up -d
```

**Terminal 2 — backend** (`http://127.0.0.1:5000`):

```powershell
cd backend
.\venv\Scripts\Activate.ps1
$env:FLASK_APP = "run.py"
python -m flask run
```

> Usar `flask run`, **no** `python run.py`. `run.py` no llama a `load_dotenv()`, así
> que no lee `backend/.env` y la app aborta con
> `RuntimeError: JWT_SECRET_KEY no está definida`. El CLI de Flask sí carga el `.env`
> automáticamente, siempre que `python-dotenv` esté instalado (§2.3). Alternativa sin
> esa dependencia, en §6.

Para recarga automática al editar: `python -m flask run --debug`.

**Terminal 3 — frontend** (`http://localhost:5173`):

```powershell
cd Frontend
npm run dev
```

---

## 4. Verificación rápida (smoke test)

Con backend y frontend arriba:

```powershell
# 1. La API responde y protege lo que tiene que proteger
curl.exe -s -o NUL -w "GET /api/posts sin token -> %{http_code}\n" http://127.0.0.1:5000/api/posts
# esperado: 401

# 2. El endpoint público valida la entrada
curl.exe -s -X POST -H "Content-Type: application/json" -d "{}" -o NUL -w "POST /api/login vacio -> %{http_code}\n" http://127.0.0.1:5000/api/login
# esperado: 400
```

Flujo completo en el navegador: `http://localhost:5173` → registrarse → iniciar
sesión → publicar un post en el feed. Si el registro devuelve error de red, el
backend no está arriba o `VITE_API_URL` apunta a otro puerto.

Endpoints implementados hoy (fuente única del contrato:
`docs/architecture/API_CONTRACT.md`):

| Método | Endpoint | Auth |
|---|---|---|
| POST | `/api/register` | No |
| POST | `/api/login` | No |
| GET | `/api/users/me` | JWT |
| PATCH | `/api/users/me` | JWT |
| POST | `/api/posts` | JWT |
| GET | `/api/posts` | JWT |

---

## 5. Tests y verificaciones

Camino rápido: `.\scripts\dev-test.ps1` (agregar `-Frontend` para incluir lint y
build). Migra `thers_test` y resuelve `TEST_DATABASE_URL` solo. Los pasos manuales
equivalentes son estos:

**Backend — pytest (75 pruebas, ~20 s, contra PostgreSQL real, sin mocks):**

```powershell
cd backend
.\venv\Scripts\Activate.ps1
$env:TEST_DATABASE_URL = "postgresql+psycopg://thers:changeme@localhost:5433/thers_test"
python -m pytest -q
```

`TEST_DATABASE_URL` es obligatoria en este equipo: `backend/tests/conftest.py` asume
el puerto **5432** por defecto y acá PostgreSQL está publicado en el **5433**. Sin
esa variable, los tests fallan por conexión rechazada.

Los tests truncan `posts` y `users` de `thers_test` entre casos — nunca tocan
`thers_dev`: `conftest.py` fija la conexión a mano precisamente para eso.

**Frontend:**

```powershell
cd Frontend
npm run lint     # eslint, hoy en verde
npm run build    # vite build, hoy en verde
```

---

## 6. Referencia rápida

| Qué | Valor |
|---|---|
| Frontend (dev) | http://localhost:5173 |
| Backend | http://127.0.0.1:5000 (prefijo `/api`) |
| PostgreSQL (host) | `localhost:5433` (configurable con `POSTGRES_PORT`) |
| Base de desarrollo | `thers_dev` |
| Base de tests | `thers_test` |
| Usuario/clave de desarrollo | `thers` / `changeme` (solo local, en claro en `docker-compose.yml`) |
| Contenedor | `thers_postgres_dev` |
| Migración cabeza actual | `f3a8c1d9e274` (create posts table) |

**Comandos de mantenimiento:**

```powershell
# Estado y logs de la base
docker compose ps
docker compose logs -f postgres

# Consola SQL contra la base de desarrollo
docker exec -it thers_postgres_dev psql -U thers -d thers_dev

# Ver qué migración tiene aplicada cada base
docker exec thers_postgres_dev psql -U thers -d thers_dev  -c "select * from alembic_version;"
docker exec thers_postgres_dev psql -U thers -d thers_test -c "select * from alembic_version;"

# Parar la base conservando los datos
docker compose stop
```

**Arrancar el backend sin `python-dotenv`** (carga `backend/.env` en la sesión de
PowerShell y usa el punto de entrada documentado en `CLAUDE.md` §11):

```powershell
cd backend
Get-Content .env | Where-Object { $_ -match '^\s*[A-Z_]+\s*=' } | ForEach-Object {
  $p = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($p[0].Trim(), $p[1].Trim(), 'Process')
}
python run.py
```

---

## 7. Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| `RuntimeError: JWT_SECRET_KEY no está definida` al arrancar | Se usó `python run.py`, que no lee `backend/.env` | Usar `python -m flask run`, o cargar el `.env` en la sesión (§6) |
| `connection refused` / `could not connect to server` | Puerto equivocado: `DATABASE_URL` dice 5432 y el contenedor publica 5433 (o al revés) | Alinear `POSTGRES_PORT` (`.env` de la raíz) con el puerto de `DATABASE_URL` (`backend/.env`) |
| `Ports are not available: address already in use` en `docker compose up` | Hay un PostgreSQL nativo ocupando el 5432 del host | Definir `POSTGRES_PORT=5433` en el `.env` de la raíz y ajustar `DATABASE_URL` |
| `docker compose up` publica en 5432 aunque esperabas 5433 | Falta el `.env` en la **raíz** del repo (no el de `backend/`) | `Copy-Item .env.example .env` en la raíz |
| Tests fallan con `relation "posts" does not exist` | `thers_test` quedó atrás en migraciones | Correr `flask db upgrade` con `DATABASE_URL` apuntando a `thers_test` (§2.3) |
| Tests fallan por conexión, pero la app funciona | Falta `TEST_DATABASE_URL` (conftest asume 5432) | Definirla antes de `pytest` (§5) |
| La app arranca pero toda operación con datos falla | `DATABASE_URL` vacía: `config.py` avisa por stderr y sigue igual | Definirla en `backend/.env` |
| `[api] VITE_API_URL no está definida` en la consola del navegador | No existe `Frontend/.env` | Es solo un aviso; el fallback `http://127.0.0.1:5000/api` es correcto en local. Copiar el `.env.example` para silenciarlo |
| Errores de CORS | El backend no está arriba (`CORS(app)` está abierto, no filtra orígenes) | Levantar el backend |
| `flask db upgrade` no encuentra la app | Falta `FLASK_APP` | `$env:FLASK_APP = "run.py"` desde `backend/` |

---

## 8. Deuda detectada (no resuelta en esta guía)

Puntos que hoy hacen falta para que el arranque sea reproducible en cualquier
máquina, y que exceden lo que una guía operativa puede decidir por su cuenta —
corresponde llevarlos al equipo:

1. **`python-dotenv` no está en `requirements.txt` ni en `requirements-dev.txt`**,
   pero `flask run` depende de él para leer `backend/.env`. Hoy funciona solo en las
   máquinas donde alguien lo instaló a mano. `scripts/dev-up.ps1` esquiva el problema
   (carga el `.env` él mismo y lo hereda la ventana del backend), pero quien arranque
   a mano sigue expuesto. Opciones: agregarlo a `requirements-dev.txt`, o llamar a
   `load_dotenv()` explícitamente en `config.py`.
2. **`python run.py` no lee `backend/.env`**, pese a estar documentado como el punto
   de entrada en `CLAUDE.md` §11 y en el `README.md`. Contradice el flujo real.
3. **`backend/tests/conftest.py` asume el puerto 5432** en su valor por defecto. En
   una instalación con el 5432 ocupado, `pytest` no corre sin variable extra.
4. **Dos entornos virtuales en `backend/`**: `venv/` (tiene `pytest` y
   `python-dotenv`, no tiene `gunicorn`) y `.venv/` (tiene `gunicorn`, no tiene
   `pytest`). `backend/.gitignore` solo cubre `venv/`. Conviene consolidar en uno.
5. **`CLAUDE.md` §11 y `README.md` §Instalación local están desactualizados**: hablan
   de 27 tests (hoy son 75), de que no hay persistencia real ni endpoint de registro,
   y de que `Frontend/package.json` no tiene script `lint` (sí lo tiene, y pasa).
6. **Dos workflows de CI se solapan**: `ci.yml` (job `backend`) y `backend-tests.yml`
   corren la misma suite con configuraciones distintas (Python 3.14 vs 3.12,
   credenciales `postgres` vs `thers`). Nadie ratificó cuál es el oficial.
