# Tests de Asistencia

Esta carpeta agrupa los tests del feature de asistencia.

## Criterio de organizacion

- un archivo por area critica o servicio
- nombres explicitos y enfocados
- tests pequenos, con pocos mocks y comportamiento observable

## Orden sugerido de crecimiento

1. `attendance.schemas.test.js`
2. `attendance-open-session.service.test.js`
3. `attendance-scan.service.test.js`
4. `attendance-close-session.service.test.js`
5. `attendance-justification.service.test.js`
6. `attendance-monthly-summary.service.test.js`

## Nota

La idea es mantener esta carpeta como el punto unico de referencia para la cobertura backend del modulo `attendance`.
