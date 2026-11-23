# backend_rueda-libre

API REST, simulador de operaciones en tiempo real y lógica de negocio para Rueda Libre (Node.js + Express + PostgreSQL/Supabase).

## Inicio rápido

```bash
npm install
cp .env.example .env      # completa DATABASE_URL y ADMIN_API_KEY
npm start                 # http://localhost:3000
npm run dev               # con reload automático
```

## Pruebas

```bash
npm test
```

El suite (`tests/`) ejecuta contra la base de datos configurada en `.env` y cubre:

- salud y catálogo (`GET /api/health`, `GET /api/catalogo`)
- validaciones de `POST /api/reservas` (fecha, cliente, plan, cantidad, sedes, selección)
- flujo de reservas completo (por `bicicleta_slug` y por `tipo_bicicleta`), cálculo de
  precios, descuento 20 % de lunes a jueves en bicicletas eléctricas, cupos de recorridos
  y consulta de reservas por código
- endpoints administrativos (requiere `x-api-key` en `ADMIN_API_KEY`): `/api/admin/reservas`
  y `/api/admin/metricas`
- stream SSE de ventas en tiempo real (`/api/stream/ventas`)

## Migraciones

`migrations/` contiene migraciones SQL aplicadas en orden:

```bash
node migrations/run.mjs
```

La migración `001_reservas_tipo_bicicleta_nullable.sql` permite `NULL` en
`reservas.tipo_bicicleta` (reservas de recorrido guiado sin bicicleta).

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/health` | Salud de la API y conexión a la base de datos |
| GET | `/api/catalogo` | Sedes, bicicletas, recorridos y promociones activas |
| POST | `/api/reservas` | Crear una reserva (formulario de la web) |
| GET | `/api/reservas/:codigo` | Consultar una reserva por código de reserva |
| GET | `/api/stream/ventas` | Stream SSE de reservas en tiempo real |
| GET | `/api/admin/reservas` | Lista de reservas (requiere API key) |
| GET | `/api/admin/metricas` | Métricas de negocio y inventario (requiere API key) |
