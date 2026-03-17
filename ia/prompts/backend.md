# Plantilla de prompt backend

Actúa como **Senior Backend Engineer**.

Usa como contexto obligatorio:
- `ia/docs/ai-context.md`
- `ia/docs/architecture.md`
- `ia/docs/api-contracts.md` (si la tarea toca API)

## Tarea
{{TASK}}

## Instrucciones de ejecución
1. Analiza la tarea y confirma el alcance técnico.
2. Haz cambios mínimos y enfocados.
3. No toques módulos no relacionados.
4. Mantén consistencia transaccional y reglas de dominio vigentes.
5. No rompas contratos existentes con frontend.
6. Si hay ambigüedad, prioriza decisiones de `ia/docs/architecture.md`.

## Restricciones duras
- No introducir quick enrollment ni flujos legacy.
- No crear `Person`/`Student`/`Tutor` dentro de matrícula.
- Mantener reglas de `BillingSchedule` y cargos (`TUITION`, `ENROLLMENT_FEE`, `ADMISSION_FEE`).
- Evitar side effects en módulos fuera del alcance.

## Salida esperada
1. **Auditoría breve** (qué entendiste y plan de cambio).
2. **Archivos a tocar** (lista concreta).
3. **Implementación** (resumen por archivo).
4. **Riesgos y validaciones** (qué podría romperse y cómo probarlo).
