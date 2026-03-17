# Decisiones de arquitectura (permanentes)

> Este documento define decisiones vigentes del backend. Se deben considerar restricciones de diseño, no sugerencias.

## 1) Matrícula directa en `CONFIRMED`
La creación por `POST /api/enrollments` persiste matrícula confirmada. No se debe introducir un flujo nuevo de draft/manual confirm para el camino principal.

## 2) Transacción obligatoria en creación de matrícula
`createEnrollmentService` debe ejecutarse de forma atómica con transacción para garantizar consistencia entre:
- `Enrollment`
- `EnrollmentStudent`
- `Charge`

Si una parte falla, todo se revierte.

## 3) Matrícula no crea entidades maestras
El proceso de matrícula no debe crear:
- `Person`
- `Student`
- `Tutor`

Solo puede vincular entidades existentes y generar registros propios de matrícula/cobro.

## 4) Política de cargos por concepto
- `TUITION`: requiere calendario operativo por ciclo (`BillingSchedule`) para calcular vencimientos.
- `ENROLLMENT_FEE` y `ADMISSION_FEE`: pueden operar sin calendario obligatorio (fallback de vencimiento permitido).

## 5) Calendario escolar de pensiones
`pensionMonthlyAmounts` representa 10 meses escolares (marzo-diciembre):
- `monthIndex 0` = marzo
- `monthIndex 9` = diciembre

No se debe cambiar este contrato sin migración coordinada backend/frontend/datos.

## 6) Control de duplicidad de pensiones
No se deben duplicar cargos `TUITION` para la misma combinación:
- `studentId + cycleId + monthIndex`

Este control es obligatorio para evitar sobrefacturación.

## 7) No reintroducir flujos legacy
No reintroducir:
- quick enrollment
- legacy enrollment de dos pasos
- creación implícita de personas desde matrícula

## 8) Compatibilidad con catálogos administrativos
El backend debe mantener consistentes los contratos administrativos usados por frontend:
- `billing-concepts`
- `campuses`
- `cycles`
- `classrooms`
- `billing-schedule`

Cualquier cambio en estos contratos requiere coordinación explícita con frontend.
