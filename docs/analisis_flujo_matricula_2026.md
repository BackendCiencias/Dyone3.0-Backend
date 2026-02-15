# Análisis de factibilidad: carga inicial y separación de matrícula 2026

## Resumen ejecutivo

El backend **sí soporta parcialmente** el flujo solicitado, pero **no de extremo a extremo desde frontend** con la granularidad de estados requerida.

Actualmente existe base para:

- Importar alumnos y reservar vacante por ciclo con estado inicial `ABSENT` usando script batch.
- Registrar tutores principales/secundarios.
- Confirmar matrícula (estado `CONFIRMED`) para alumnos cuando el padre apoderado confirma.
- Registrar deudas como cargos (`Charge`) por alumno/ciclo.

Sin embargo, faltan capacidades clave para cumplir exactamente el flujo operativo descrito:

1. **Importación Excel vía API/frontend** (hoy es script CSV por consola).
2. **Estados de separación/matrícula específicos del negocio** ("reservado en espera", "confirmado", "trasladado/cancelado vacante") de manera explícita en una sola entidad.
3. **Acciones de transición de estado** para cambiar masivamente o por alumno entre esos estados.
4. **Vincular/guardar condiciones de pensión acordadas para 2026** en la confirmación.

## Lo que ya existe y ayuda al flujo

### 1) Carga masiva inicial (por consola)

Existe `scripts/importStudents.js` que permite cargar datos tipo padrón con:

- `internalCode` (matrícula/código),
- nombres, apellidos, DNI (opcional),
- sede, grado, sección y nivel,
- notas.

Durante la carga:

- Crea/actualiza `Person` y `Student`.
- Crea una `Family` "stub" si no existe.
- Crea `StudentCycle` en estado `ABSENT`.
- Crea `Vacancy` para reservar vacante en aula/ciclo.

Esto ya representa muy bien la idea de "separar matrícula" para todos los alumnos heredados del año anterior.

### 2) Tutores/padres

Existe `scripts/importTutors.js` para cargar tutores por `studentCod`, relación, nombres, DNI y teléfonos; además marca un tutor primario por alumno y lo vincula a la familia.

### 3) Confirmación de matrícula

El módulo de matrículas permite confirmar inscripción (quick enrollment):

- crea `Matricula` con estado `CONFIRMED`,
- actualiza `StudentCycle` a `ENROLLED`,
- mantiene/actualiza `Vacancy` activa.

Esto cubre el caso "padres vinieron y confirmaron matrícula".

### 4) Deuda

Existe modelo `Charge` con `totalAmount/outstandingAmount`, que puede representar deuda total inicial por alumno.

## Brechas frente al flujo solicitado

## A) Excel + frontend (hoy no está)

- No hay endpoint de importación batch (multipart o JSON masivo).
- Los importadores son scripts Node ejecutados manualmente y parsean texto CSV/TSV/;, no `.xlsx`.

**Qué falta**:

- Endpoint `POST /imports/students` (archivo Excel o JSON).
- Servicio transaccional de importación por lotes + reporte por fila (creados/actualizados/error).
- Estandarizar plantilla (columnas obligatorias/opcionales).

## B) Estados de negocio de separación/matrícula

El negocio pide tres estados operativos claros:

1. Reservado/en espera (separado, aún no confirmado).
2. Confirmado (matriculado 2026).
3. Trasladado/retirado (se libera/cancela vacante).

Hoy hay estados cercanos pero repartidos:

- `StudentCycle.status`: `ABSENT | ENROLLED | TRANSFERRED`.
- `Matricula.status`: `DRAFT | CONFIRMED | CANCELLED`.

No existe una capa explícita de "reserva de matrícula" con estados y trazabilidad de transición para frontend.

**Qué falta (opciones)**:

- **Opción mínima (reutilizar StudentCycle):**
  - mapear `ABSENT = reservado en espera`,
  - `ENROLLED = confirmado`,
  - `TRANSFERRED = trasladado`.
  - y exponer endpoints claros para transición + filtros.

- **Opción robusta (recomendada):**
  - crear entidad `EnrollmentReservation` (o ampliar `Matricula`) con estado:
    - `RESERVED_PENDING`,
    - `CONFIRMED`,
    - `TRANSFERRED`,
    - opcional `CANCELLED`.
  - guardar historial de cambios (`changedAt`, `changedBy`, `reason`).

## C) Confirmación con "nuevo término de pensión"

El flujo pide guardar acuerdos de pago del año (monto de pensión, fecha/ciclo de cobro, etc.) al confirmar.

Hoy:

- la creación rápida de matrícula acepta `discounts` en schema, pero no se persisten en servicio;
- no hay un modelo explícito de plan/condición de pensión asociado a la matrícula del alumno.

**Qué falta**:

- Modelo `TuitionAgreement` o extender `ContractSnapshot` con:
  - `monthlyAmount`,
  - `paymentDay`/`schedule`,
  - `discounts`,
  - `effectiveFrom`,
  - `notes`.
- Persistir este acuerdo en `createQuickEnrollmentService`.

## D) Traslado y liberación de vacante

Para "trasladado" se requiere que quede constancia y que ya no tenga vacante reservada activa.

Hoy no hay endpoint dedicado para esa transición, aunque existe `StudentCycle.status = TRANSFERRED`.

**Qué falta**:

- Endpoint de transición, por ejemplo:
  - `PATCH /enrollments/:studentId/status` con acciones `CONFIRM`, `MARK_PENDING`, `TRANSFER`.
- Al `TRANSFER`:
  - `StudentCycle.status = TRANSFERRED`,
  - `StudentCycle.transferredAt = now`,
  - cerrar vacante (`Vacancy.endDate = now`) o anular reserva,
  - dejar motivo en `notes`.

## E) Inconsistencias técnicas a corregir

En la rama legacy de matrículas se crea `Student` sin `internalCode`, pero este campo es requerido por modelo.
Debe corregirse para evitar errores en uso de esa ruta.

## Propuesta concreta para habilitarlo desde frontend

1. **Carga inicial 2026 (masiva):**
   - Endpoint de importación (Excel/CSV) con columnas:
     - Alumno: `internalCode`, `apellidos`, `nombres`, `dni?`, `campus`, `grado`, `sección`.
     - Tutor principal: `relación`, `apellidos`, `nombres`, `dni?`, `celular?`.
     - Deuda: `deudaTotal?`.
   - Resultado: `Student + Person + Family + Tutor + StudentCycle(ABSENT) + Vacancy`.

2. **Panel de seguimiento (frontend):**
   - Listado por estado de separación/matrícula con filtros.
   - Estados mostrados:
     - "Reservado en espera" (ABSENT),
     - "Confirmado" (ENROLLED/Matricula CONFIRMED),
     - "Trasladado" (TRANSFERRED).

3. **Acciones por alumno:**
   - Confirmar matrícula: crea `Matricula CONFIRMED`, pasa a `ENROLLED`, guarda acuerdo de pensión.
   - Marcar traslado: pasa a `TRANSFERRED`, cierra vacante, registra motivo.
   - Volver a pendiente (si aplica): `ABSENT`.

4. **Auditoría mínima:**
   - registrar `changedBy`, `changedAt`, `reason` en cada transición.

## Conclusión

Sí, **es viable** con la base actual y ya existe buena parte del modelo para hacerlo.

Pero para cumplir exactamente el flujo de negocio desde frontend faltan:

- importación masiva vía API (idealmente Excel),
- endpoints de transición de estado para reserva/confirmación/traslado,
- persistencia de acuerdo de pensión al confirmar,
- y pequeños ajustes de consistencia en la ruta legacy de matrícula.
