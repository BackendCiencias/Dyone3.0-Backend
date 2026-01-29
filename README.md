# School Backend

Este proyecto implementa una plataforma de gestión escolar multi‑sede en **Node.js**, **Express** y **MongoDB**. Está diseñado para los colegios CIMAS, Ciencias Primaria y Ciencias Secundaria en Perú y sigue una arquitectura modular robusta.

## Estructura

El código se organiza en módulos dentro de `src/modules` y modelos compartidos en `src/models`. La aplicación carga variables de entorno desde un archivo `.env` (ver `.env.example`).

### Scripts útiles

- `npm install` – instala todas las dependencias.
- `npm run dev` – inicia el servidor en modo desarrollo con reinicio automático usando **nodemon**.
- `npm start` – inicia el servidor en modo producción.

## Configuración

1. Copie el archivo `.env.example` a `.env` y configure las variables según su entorno:
   ```bash
   cp .env.example .env
   ```
2. Edite `.env` para ajustar la cadena de conexión a MongoDB (`MONGODB_URI`), el puerto (`PORT`) y la clave secreta JWT (`JWT_SECRET`).

## Uso

Para iniciar el servidor en desarrollo:

```bash
npm install
npm run dev
```

La API expone endpoints bajo el prefijo `/api` (por ejemplo, `/api/auth/login`, `/api/admin/campuses`). Los módulos implementados incluyen autenticación, catálogo de datos, familias, estudiantes, pagos y matrículas administrativas.

## Licencia

Este proyecto se distribuye bajo la licencia MIT.