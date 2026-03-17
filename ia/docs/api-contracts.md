# API Contracts clave (Backend ↔ Frontend)

> Contratos sensibles para coordinación. Basados en rutas/controllers/schemas actuales.

## 1) `POST /api/enrollments`
Crea matrícula en estado confirmado y genera cargos dentro de transacción.

### Request (body)
```json
{
  "familyId": "ObjectId",
  "campusId": "ObjectId",
  "cycleId": "ObjectId",
  "enrollmentStudents": [
    {
      "studentId": "ObjectId",
      "classroomId": "ObjectId",
      "admissionFee": {
        "applies": true,
        "isExempt": false,
        "amount": 0,
        "reason": "string"
      },
      "enrollmentFee": {
        "isExempt": false,
        "amount": 0,
        "reason": "string"
      },
      "pensionMonthlyAmounts": [0,0,0,0,0,0,0,0,0,0],
      "previousSchoolType": "string",
      "notes": "string opcional"
    }
  ],
  "notes": "string opcional"
}
```

### Validaciones funcionales relevantes
- `enrollmentStudents` mínimo 1.
- `pensionMonthlyAmounts` longitud obligatoria de 10.
- `studentId + cycleId + monthIndex` no debe duplicar pensiones existentes (`TUITION`).
- Deben existir `BillingConcept`: `ADMISSION_FEE`, `ENROLLMENT_FEE`, `TUITION`.
- Debe existir calendario de `TUITION` en `BillingSchedule` para el `cycleId`.

### Response esperada
- `201 Created`
- Objeto `Enrollment` persistido, con `familyId`, `cycleId`, `campusId` y `enrollmentStudents` poblados.

---

## 2) `GET /api/admin/billing-schedule`
Consulta calendario de vencimientos por ciclo/concepto.

### Request (query)
```json
{
  "cycleId": "ObjectId string (requerido)",
  "conceptCode": "string opcional, default TUITION"
}
```

### Response
```json
{
  "cycleId": "ObjectId",
  "conceptCode": "TUITION|...",
  "items": [
    {
      "monthIndex": 0,
      "label": "string",
      "dueDate": "ISODate"
    }
  ]
}
```

---

## 3) `POST /api/admin/billing-schedule`
Crea/reemplaza calendario por `cycleId + conceptCode`.

### Request (body)
```json
{
  "cycleId": "ObjectId",
  "conceptCode": "TUITION",
  "items": [
    {
      "monthIndex": 0,
      "label": "Marzo",
      "dueDate": "2026-03-31"
    }
  ]
}
```

### Reglas
- `items` mínimo 1.
- `monthIndex`: `0..9` o `null`.
- No se permite `monthIndex` duplicado dentro del mismo payload.

### Response
- `201 Created`
```json
{
  "cycleId": "ObjectId",
  "conceptCode": "TUITION",
  "items": [
    {
      "monthIndex": 0,
      "label": "Marzo",
      "dueDate": "ISODate"
    }
  ]
}
```

---

## 4) `PATCH /api/families/:id`
Actualiza datos base de familia.

### Request
- Params:
```json
{ "id": "ObjectId" }
```
- Body (al menos un campo):
```json
{
  "address": "string opcional",
  "notes": "string opcional"
}
```

### Response esperada
```json
{
  "familyId": "ObjectId",
  "address": "string|null",
  "notes": "string|null",
  "students": [],
  "primaryTutor": {},
  "otherTutors": []
}
```

---

## 5) `POST /api/students/print-cards`
Obtiene dataset para impresión de carnets.

### Request (body)
```json
{
  "studentIds": ["ObjectId"],
  "filters": {
    "q": "string opcional",
    "campus": "CIENCIAS|CIMAS|CIENCIAS_APLICADAS|''",
    "level": "INITIAL|PRIMARY|SECONDARY|''",
    "grade": "string|number opcional",
    "section": "string opcional"
  }
}
```

### Response
```json
{
  "items": [
    {
      "studentId": "ObjectId",
      "internalCode": "string|null",
      "names": "string",
      "lastNames": "string",
      "dni": "string|null",
      "campusCode": "string|null",
      "grade": "string|null",
      "section": "string|null",
      "classroomLabel": "string|null"
    }
  ]
}
```
