# DYONE 3.0 Backend — AI Context

## ¿Qué es DYONE?
DYONE 3.0 es el backend administrativo/académico para gestión escolar (familias, estudiantes, matrículas, cobros, pagos, aulas y ciclos).

## Stack técnico
- Node.js + Express
- MongoDB + Mongoose
- Validación de entrada con Zod
- Flujo crítico de matrícula con transacciones (`session.startTransaction()`)

## Entidades principales de negocio
- `Family`
- `Student`
- `Enrollment`
- `EnrollmentStudent`
- `Charge`
- `BillingConcept`
- `BillingSchedule`
- `Campus`
- `Cycle`
- `Classroom`

## Flujo de matrícula en backend (estado actual)
- Endpoint clave: `POST /api/enrollments`.
- La matrícula se crea directamente en estado `CONFIRMED`.
- No existe flujo de matrícula en dos pasos como camino principal.
- La matrícula **no** crea `Person`, `Student` ni `Tutor`.
- La matrícula consume entidades existentes y genera:
  - `Enrollment`
  - `EnrollmentStudent`
  - `Charge` (admisión, matrícula y pensiones)
- Todo el proceso debe ejecutarse de forma atómica dentro de transacción.

## Reglas de dominio críticas
- `pensionMonthlyAmounts` debe tener longitud **10**.
- Mapeo de meses escolares:
  - `monthIndex = 0` → Marzo
  - `monthIndex = 9` → Diciembre
- Se evita duplicación de pensiones por combinación única:
  - `studentId + cycleId + monthIndex`
- Billing concepts esperados:
  - `ADMISSION_FEE`
  - `ENROLLMENT_FEE`
  - `TUITION`

## Reglas de cargos
- `TUITION` usa `BillingSchedule` para resolver `dueDate` por `monthIndex`.
- `ENROLLMENT_FEE` y `ADMISSION_FEE` no dependen obligatoriamente de `BillingSchedule`:
  - pueden usar fecha inmediata/fallback cuando no hay fila configurada.
- Si no existe calendario para `TUITION` en el ciclo, la matrícula debe fallar para evitar inconsistencias.

## BillingSchedule en el sistema
- Modelo dedicado: `BillingSchedule`.
- Endpoints relevantes:
  - `GET /api/admin/billing-schedule`
  - `POST /api/admin/billing-schedule`
- Uso principal: coordinar vencimientos de cobros (especialmente pensiones `TUITION`) por ciclo.

## Uso combinado Backend + Frontend
- Frontend debe crear/editar entidades base (familia, alumno, etc.) antes de matricular.
- Frontend consume catálogos (`campuses`, `cycles`, `classrooms`, `billing-concepts`, `billing-schedule`) para construir formularios y validaciones.
- Para coordinación, tomar como fuente de verdad:
  1. esquemas Zod (`*.schemas.js`),
  2. rutas (`*.routes.js`),
  3. contratos funcionales en este directorio `/ia/docs`.
