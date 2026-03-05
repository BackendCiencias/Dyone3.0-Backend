# Backend module architecture

- **Controller**: valida input, llama al service y retorna la respuesta HTTP.
- **Service**: orquesta casos de uso, combina repositorios y aplica reglas de negocio.
- **Repository**: solo acceso a datos (Mongoose find/aggregate/populate), sin shape final de endpoint.
- **Presenter/DTO**: normaliza el shape de respuesta para frontend.
- **Shared services**: utilidades cross-módulo (search utils, normalización de términos, score), no deben devolver el shape final de endpoints.

## Regla de ubicación de búsqueda

- Si el endpoint pertenece a un módulo, la búsqueda vive en su módulo:
  - `modules/families/services/families.search.service.js`
  - `modules/students/services/unassignedStudents.search.service.js`
  - `modules/enrollments/services/intake.search.service.js`
- `modules/_shared/search/search.utils.js` contiene solo utilidades genéricas.
